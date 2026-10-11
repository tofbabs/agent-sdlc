// Cooldown edges, worktree convergence and token confinement for export-identity.mjs.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname
const { createAuth } = await import(
  pathToFileURL(join(root, 'plugins/agentic-sdlc/scripts/export-identity.mjs')).href
)

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'export-identity-more-')))
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' })
function mkrepo(dir) {
  git(tmp, 'init', '-q', dir)
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  return dir
}
async function stub(respond) {
  const requests = []
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      requests.push(req.url)
      respond(req, res, requests.length)
    })
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
const issue = (_req, res) => {
  res.writeHead(201, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ token: randomBytes(32).toString('base64url') }))
}
const exportDir = (repo) => join(repo, '.git', 'agentic-sdlc', 'export')

const tests = []
const test = (name, fn) => tests.push([name, fn])

test('cooldown record is private and not the token file', async () => {
  const repo = mkrepo(join(tmp, 'cd-mode'))
  const s = await stub((_r, res) => (res.writeHead(500), res.end()))
  try {
    await createAuth({ cwd: repo, baseUrl: s.baseUrl }).token()
    assert.equal(statSync(join(exportDir(repo), 'cooldown.json')).mode & 0o777, 0o600)
    assert.ok(!readdirSync(exportDir(repo)).includes('token.json'))
  } finally {
    await s.close()
  }
})

test('a corrupt cooldown record means no cooldown', async () => {
  const repo = mkrepo(join(tmp, 'cd-corrupt'))
  const s = await stub(issue)
  try {
    await createAuth({ cwd: repo, baseUrl: s.baseUrl }).token()
    await createAuth({ cwd: repo, baseUrl: s.baseUrl }).invalidate()
    writeFileSync(join(exportDir(repo), 'cooldown.json'), '{not json')
    assert.match(await createAuth({ cwd: repo, baseUrl: s.baseUrl }).token(), /^[A-Za-z0-9_-]{43}$/)
  } finally {
    await s.close()
  }
})

test('an expired cooldown record is ignored and a successful registration clears it', async () => {
  const repo = mkrepo(join(tmp, 'cd-expired'))
  const s = await stub(issue)
  try {
    await createAuth({ cwd: repo, baseUrl: s.baseUrl }).token()
    writeFileSync(join(exportDir(repo), 'cooldown.json'), JSON.stringify({ until: Date.now() - 1000 }))
    const auth = createAuth({ cwd: repo, baseUrl: s.baseUrl })
    await auth.invalidate()
    assert.match(await auth.token(), /^[A-Za-z0-9_-]{43}$/)
    assert.ok(!readdirSync(exportDir(repo)).includes('cooldown.json'))
  } finally {
    await s.close()
  }
})

test('an absurd Retry-After is capped at a day', async () => {
  const repo = mkrepo(join(tmp, 'cd-cap'))
  const s = await stub((_r, res) => (res.writeHead(429, { 'retry-after': '99999999' }), res.end()))
  try {
    await createAuth({ cwd: repo, baseUrl: s.baseUrl }).token()
    const { until } = JSON.parse(readFileSync(join(exportDir(repo), 'cooldown.json'), 'utf8'))
    assert.ok(until - Date.now() <= 24 * 3600 * 1000)
  } finally {
    await s.close()
  }
})

test('two real worktrees registering concurrently converge on one token', async () => {
  const repo = mkrepo(join(tmp, 'wt-main'))
  const other = join(tmp, 'wt-other')
  git(repo, 'worktree', 'add', '-q', other, '-b', 'second')
  const s = await stub((req, res) => setTimeout(() => issue(req, res), 100))
  try {
    const [a, b] = await Promise.all([
      createAuth({ cwd: repo, baseUrl: s.baseUrl }).token(),
      createAuth({ cwd: other, baseUrl: s.baseUrl }).token(),
    ])
    assert.match(a, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(a, b)
    assert.equal(await createAuth({ cwd: other, baseUrl: s.baseUrl }).token(), a)
  } finally {
    await s.close()
  }
})

test('the token appears in no tracked file and no working-tree file', async () => {
  const repo = mkrepo(join(tmp, 'confine'))
  writeFileSync(join(repo, 'a.txt'), 'x')
  git(repo, 'add', '.')
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'a')
  const s = await stub(issue)
  try {
    const token = await createAuth({ cwd: repo, baseUrl: s.baseUrl }).token()
    assert.ok(token)
    assert.equal(git(repo, 'ls-files').split('\n').filter(Boolean).length, 1)
    assert.equal(git(repo, 'status', '--porcelain', '--ignored'), '')
    const hits = execFileSync('grep', ['-rl', token, '.', '--exclude-dir=.git'], { cwd: repo, encoding: 'utf8' }).toString().trim().split('\n').filter(Boolean)
    assert.deepEqual(hits, [])
  } catch (e) {
    // grep exits 1 on no match, which is the passing case.
    if (e.status !== 1 || e.stdout?.toString().trim()) throw e
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
    console.log(`  ✗ ${name}\n${e.stack}`)
  }
}
if (failed) process.exit(1)
console.log('\nexport-identity-more tests passed')
