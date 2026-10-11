// Drives export-identity.mjs against a stub /v1/register on 127.0.0.1.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname
const { createAuth } = await import(
  pathToFileURL(join(root, 'plugins/agentic-sdlc/scripts/export-identity.mjs')).href
)
const { repoId } = await import(
  pathToFileURL(join(root, 'plugins/agentic-sdlc/scripts/repo-id.mjs')).href
)

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'export-identity-')))
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' })
function mkrepo(dir) {
  git(tmp, 'init', '-q', dir)
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  return dir
}

// One stub per test so request counts never bleed between cases.
async function stub(respond) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body })
      respond(req, res, requests.length)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    requests,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      // A hung request would otherwise keep close() waiting forever.
      server.closeAllConnections()
      return new Promise((r) => server.close(r))
    },
  }
}
const issue = (_req, res) => {
  res.writeHead(201, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ token: randomBytes(32).toString('base64url') }))
}

const tests = []
const test = (name, fn) => tests.push([name, fn])

test('first registration posts the repo ID and stores a 0600 token in the git common dir', async () => {
  const repo = mkrepo(join(tmp, 'first'))
  const s = await stub(issue)
  try {
    const tok = await createAuth({ cwd: repo, baseUrl: s.baseUrl, timeoutMs: 2000 }).token()
    assert.match(tok, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(s.requests.length, 1)
    assert.equal(s.requests[0].method, 'POST')
    assert.equal(s.requests[0].url, '/v1/register')
    assert.deepEqual(JSON.parse(s.requests[0].body), { repo_id: repoId({ cwd: repo }) })
    const file = join(repo, '.git', 'agentic-sdlc', 'export', 'token.json')
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).token, tok)
    assert.equal(statSync(file).mode & 0o777, 0o600)
  } finally {
    await s.close()
  }
})

test('a stored token is reused by a later auth without calling /register again', async () => {
  const repo = mkrepo(join(tmp, 'reuse'))
  const s = await stub(issue)
  try {
    const first = await createAuth({ cwd: repo, baseUrl: s.baseUrl, timeoutMs: 2000 }).token()
    const again = await createAuth({ cwd: repo, baseUrl: s.baseUrl, timeoutMs: 2000 }).token()
    const same = createAuth({ cwd: repo, baseUrl: s.baseUrl, timeoutMs: 2000 })
    assert.equal(await same.token(), first)
    assert.equal(await same.token(), first)
    assert.equal(again, first)
    assert.equal(s.requests.length, 1)
  } finally {
    await s.close()
  }
})

test('invalidate drops the stored token so the next call registers exactly once more', async () => {
  const repo = mkrepo(join(tmp, 'invalidate'))
  const s = await stub(issue)
  try {
    const auth = createAuth({ cwd: repo, baseUrl: s.baseUrl, timeoutMs: 2000 })
    const old = await auth.token()
    await auth.invalidate()
    await auth.invalidate()
    const fresh = await auth.token()
    assert.notEqual(fresh, old)
    assert.equal(await auth.token(), fresh)
    assert.equal(s.requests.length, 2)
  } finally {
    await s.close()
  }
})

const failures = {
  'a 500': (_req, res) => {
    res.writeHead(500)
    res.end('boom')
  },
  'a 429': (_req, res) => {
    res.writeHead(429, { 'retry-after': '60' })
    res.end()
  },
  'a 503 kill switch': (_req, res) => {
    res.writeHead(503, { 'retry-after': '60', 'content-type': 'application/json' })
    res.end(JSON.stringify({ stop: true }))
  },
  'a 201 with a malformed token': (_req, res) => {
    res.writeHead(201, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ token: 'short' }))
  },
  'a 201 with a non-JSON body': (_req, res) => {
    res.writeHead(201)
    res.end('<html>')
  },
  'a 201 with a 43-char token that is not base64url': (_req, res) => {
    res.writeHead(201, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ token: '+'.repeat(43) }))
  },
  'a server that never answers': () => {},
}
for (const [label, respond] of Object.entries(failures)) {
  test(`registration against ${label} yields null, stores nothing and never throws`, async () => {
    const repo = mkrepo(join(tmp, `fail-${label.replace(/\W+/g, '-')}`))
    const s = await stub(respond)
    try {
      const tok = await createAuth({ cwd: repo, baseUrl: s.baseUrl, timeoutMs: 300 }).token()
      assert.equal(tok, null)
      assert.equal(existsSync(join(repo, '.git', 'agentic-sdlc', 'export', 'token.json')), false)
    } finally {
      await s.close()
    }
  })
}

test('registration with nothing listening yields null', async () => {
  const repo = mkrepo(join(tmp, 'refused'))
  const s = await stub(issue)
  const baseUrl = s.baseUrl
  await s.close()
  assert.equal(await createAuth({ cwd: repo, baseUrl, timeoutMs: 300 }).token(), null)
})

test('a failed registration cools down: a later auth makes no further /register call', async () => {
  const repo = mkrepo(join(tmp, 'cooldown-default'))
  const s = await stub((_req, res) => {
    res.writeHead(500)
    res.end()
  })
  try {
    assert.equal(await createAuth({ cwd: repo, baseUrl: s.baseUrl, timeoutMs: 300 }).token(), null)
    assert.equal(await createAuth({ cwd: repo, baseUrl: s.baseUrl, timeoutMs: 300 }).token(), null)
    assert.equal(s.requests.length, 1)
  } finally {
    await s.close()
  }
})

test('a Retry-After longer than the default cooldown is honoured', async () => {
  const repo = mkrepo(join(tmp, 'cooldown-retry-after'))
  const s = await stub((_req, res) => {
    res.writeHead(429, { 'retry-after': '3600' })
    res.end()
  })
  try {
    await createAuth({ cwd: repo, baseUrl: s.baseUrl, timeoutMs: 300 }).token()
    const file = join(repo, '.git', 'agentic-sdlc', 'export')
    assert.equal(existsSync(join(file, 'token.json')), false)
    assert.equal(await createAuth({ cwd: repo, baseUrl: s.baseUrl, timeoutMs: 300 }).token(), null)
    assert.equal(s.requests.length, 1)
  } finally {
    await s.close()
  }
})

test('once Retry-After elapses the next call registers and stores a token', async () => {
  const repo = mkrepo(join(tmp, 'cooldown-expiry'))
  const s = await stub((req, res, n) => {
    if (n === 1) {
      res.writeHead(429, { 'retry-after': '1' })
      res.end()
    } else issue(req, res)
  })
  try {
    const auth = createAuth({ cwd: repo, baseUrl: s.baseUrl, timeoutMs: 1000 })
    assert.equal(await auth.token(), null)
    assert.equal(await auth.token(), null)
    assert.equal(s.requests.length, 1)
    await new Promise((r) => setTimeout(r, 1200))
    assert.match(await auth.token(), /^[A-Za-z0-9_-]{43}$/)
    assert.equal(s.requests.length, 2)
  } finally {
    await s.close()
  }
})

let failed = 0
for (const [name, fn] of tests) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.error(`  ✗ ${name}\n    ${e.message}`)
  }
}
if (failed) {
  console.error('\nexport-identity tests failed')
  process.exit(1)
}
console.log('\nexport-identity tests passed')
