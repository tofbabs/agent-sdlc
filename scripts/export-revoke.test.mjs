// Client revoke: local state is dropped only once the server confirms (204) or
// says the token is already gone (401); anything else must stay retryable.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname
const { createAuth } = await import(
  pathToFileURL(join(root, 'plugins/agentic-sdlc/scripts/export-identity.mjs')).href
)

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'export-revoke-')))
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' })

// A clone that already registered and has one report waiting to upload.
function enrolledRepo(name) {
  const dir = join(tmp, name)
  git(tmp, 'init', '-q', dir)
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  const exp = join(dir, '.git', 'agentic-sdlc', 'export')
  mkdirSync(join(exp, 'queue'), { recursive: true })
  const token = randomBytes(32).toString('base64url')
  writeFileSync(join(exp, 'token.json'), JSON.stringify({ token, created_at: new Date().toISOString() }))
  writeFileSync(join(exp, 'queue', 'r1.json'), '{}')
  return { dir, token, tokenFile: join(exp, 'token.json'), queueDir: join(exp, 'queue') }
}

async function stub(respond) {
  const requests = []
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization })
    req.resume()
    req.on('end', () => respond(res))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    requests,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections()
      return new Promise((r) => server.close(r))
    },
  }
}
const status = (code) => (res) => {
  res.writeHead(code)
  res.end()
}

const tests = []
const test = (name, fn) => tests.push([name, fn])

test('204 sends the bearer DELETE and removes the token and the queue', async () => {
  const c = enrolledRepo('ok')
  const s = await stub(status(204))
  try {
    const out = await createAuth({ cwd: c.dir, baseUrl: s.baseUrl, timeoutMs: 2000 }).revoke()
    assert.equal(out, 'done')
    assert.equal(s.requests.length, 1)
    assert.equal(s.requests[0].method, 'DELETE')
    assert.equal(s.requests[0].url, '/v1/repo')
    assert.equal(s.requests[0].auth, `Bearer ${c.token}`)
    assert.equal(existsSync(c.tokenFile), false)
    assert.equal(existsSync(c.queueDir), false)
  } finally {
    await s.close()
  }
})

test('401 means already deleted, so local state is dropped too', async () => {
  const c = enrolledRepo('gone')
  const s = await stub(status(401))
  try {
    assert.equal(await createAuth({ cwd: c.dir, baseUrl: s.baseUrl, timeoutMs: 2000 }).revoke(), 'done')
    assert.equal(existsSync(c.tokenFile), false)
    assert.equal(existsSync(c.queueDir), false)
  } finally {
    await s.close()
  }
})

test('a 500 keeps token and queue and reports retry', async () => {
  const c = enrolledRepo('boom')
  const s = await stub(status(500))
  try {
    assert.equal(await createAuth({ cwd: c.dir, baseUrl: s.baseUrl, timeoutMs: 2000 }).revoke(), 'retry')
    assert.equal(existsSync(c.tokenFile), true)
    assert.equal(existsSync(c.queueDir), true)
  } finally {
    await s.close()
  }
})

test('a 503 kill-switch style refusal is also retry, never a local wipe', async () => {
  const c = enrolledRepo('stop')
  const s = await stub(status(503))
  try {
    assert.equal(await createAuth({ cwd: c.dir, baseUrl: s.baseUrl, timeoutMs: 2000 }).revoke(), 'retry')
    assert.equal(existsSync(c.tokenFile), true)
    assert.equal(existsSync(c.queueDir), true)
  } finally {
    await s.close()
  }
})

test('a timeout keeps token and queue and reports retry without throwing', async () => {
  const c = enrolledRepo('hang')
  const s = await stub(() => {})
  try {
    assert.equal(await createAuth({ cwd: c.dir, baseUrl: s.baseUrl, timeoutMs: 300 }).revoke(), 'retry')
    assert.equal(existsSync(c.tokenFile), true)
    assert.equal(existsSync(c.queueDir), true)
  } finally {
    await s.close()
  }
})

test('an unreachable server is retry, not a throw', async () => {
  const c = enrolledRepo('down')
  const s = await stub(status(204))
  const baseUrl = s.baseUrl
  await s.close()
  assert.equal(await createAuth({ cwd: c.dir, baseUrl, timeoutMs: 500 }).revoke(), 'retry')
  assert.equal(existsSync(c.tokenFile), true)
})

test('no token means done with zero requests and no registration', async () => {
  const dir = join(tmp, 'fresh')
  git(tmp, 'init', '-q', dir)
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  const s = await stub(status(201))
  try {
    assert.equal(await createAuth({ cwd: dir, baseUrl: s.baseUrl, timeoutMs: 2000 }).revoke(), 'done')
    assert.equal(s.requests.length, 0)
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
  console.error('\nexport-revoke tests failed')
  process.exit(1)
}
console.log('\nexport-revoke tests passed')
