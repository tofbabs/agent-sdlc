// The revoke CLI: always exit 0, honours the URL env, and a clone with no token
// opens no connection at all.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const cli = join(root, 'plugins/agentic-sdlc/scripts/export-identity.mjs')
const recorder = join(root, 'scripts/connection-recorder.mjs')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'export-revoke-cli-')))
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' })

function repo(name, withToken) {
  const dir = join(tmp, name)
  git(tmp, 'init', '-q', dir)
  const exp = join(dir, '.git', 'agentic-sdlc', 'export')
  mkdirSync(join(exp, 'queue'), { recursive: true })
  if (withToken) writeFileSync(join(exp, 'token.json'), JSON.stringify({ token: randomBytes(32).toString('base64url') }))
  return { dir, tokenFile: join(exp, 'token.json'), queueDir: join(exp, 'queue') }
}

function runCli(cwd, url) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, 'revoke'], { cwd, env: { ...process.env, AGENTIC_SDLC_EXPORT_URL: url } })
    p.on('close', (code) => resolve(code))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.error(`  ✗ ${name}\n    ${e.message}`)
  }
}

await test('with a token the CLI DELETEs the env URL, drops local state and exits 0', async () => {
  const seen = []
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`)
    res.writeHead(204)
    res.end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const c = repo('has-token', true)
  try {
    assert.equal(await runCli(c.dir, `http://127.0.0.1:${server.address().port}`), 0)
    assert.deepEqual(seen, ['DELETE /v1/repo'])
    assert.equal(existsSync(c.tokenFile), false)
    assert.equal(existsSync(c.queueDir), false)
  } finally {
    server.close()
  }
})

await test('an unreachable server still exits 0 and keeps local state', async () => {
  const c = repo('down', true)
  assert.equal(await runCli(c.dir, 'http://127.0.0.1:1'), 0)
  assert.equal(existsSync(c.tokenFile), true)
})

await test('no token: exit 0 and zero connections', async () => {
  const portFile = join(tmp, 'port')
  const connFile = join(tmp, 'conns')
  const rec = spawn(process.execPath, [recorder, portFile, connFile], { stdio: 'ignore' })
  try {
    for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(50)
    const url = `http://127.0.0.1:${readFileSync(portFile, 'utf8')}`
    const c = repo('no-token', false)
    assert.equal(await runCli(c.dir, url), 0)
    assert.equal(readFileSync(connFile, 'utf8'), '')
    assert.equal(existsSync(join(c.dir, '.git', 'agentic-sdlc', 'export', 'cooldown.json')), false)
  } finally {
    rec.kill('SIGTERM')
  }
})

if (failed) {
  console.error('\nexport-revoke-cli tests failed')
  process.exit(1)
}
console.log('\nexport-revoke-cli tests passed')
