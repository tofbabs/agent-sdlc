// Tests for the export client (STORY-4-3). Run via scripts/export.test.sh.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, realpathSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPORT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'plugins', 'agentic-sdlc', 'scripts', 'export.mjs')
const mod = await import(EXPORT)

function mkrepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'export-')))
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  execFileSync('git', ['init', '-q', dir], { env })
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init'], { env })
  return dir
}

const report = (run_id, sessions = 1, extra = {}) => ({ schema: 1, run: { run_id, sessions }, ...extra })
const queueDir = (cwd) => join(cwd, '.git', 'agentic-sdlc', 'export', 'queue')

test('enqueue stores the report unmodified under the git common dir', async () => {
  const cwd = mkrepo()
  const r = report('11111111-1111-4111-8111-111111111111', 1, { note: 'x' })
  await mod.enqueue({ cwd, report: r })
  const files = readdirSync(queueDir(cwd))
  assert.equal(files.length, 1)
  assert.deepEqual(JSON.parse(readFileSync(join(queueDir(cwd), files[0]), 'utf8')), r)
})

test('re-enqueueing the same (run_id, sessions) replaces instead of duplicating', async () => {
  const cwd = mkrepo()
  const id = '22222222-2222-4222-8222-222222222222'
  await mod.enqueue({ cwd, report: report(id, 1, { v: 1 }) })
  await mod.enqueue({ cwd, report: report(id, 1, { v: 2 }) })
  const files = readdirSync(queueDir(cwd))
  assert.equal(files.length, 1)
  assert.equal(JSON.parse(readFileSync(join(queueDir(cwd), files[0]), 'utf8')).v, 2)
})

test('a later session of the same run is a separate queue item', async () => {
  const cwd = mkrepo()
  const id = '33333333-3333-4333-8333-333333333333'
  await mod.enqueue({ cwd, report: report(id, 1) })
  await mod.enqueue({ cwd, report: report(id, 2) })
  assert.equal(readdirSync(queueDir(cwd)).length, 2)
})

test('enqueue leaves no temp files behind and never throws on junk', async () => {
  const cwd = mkrepo()
  await mod.enqueue({ cwd, report: report('44444444-4444-4444-8444-444444444444') })
  assert.ok(readdirSync(queueDir(cwd)).every((f) => !f.endsWith('.tmp')))
  await assert.doesNotReject(() => mod.enqueue({ cwd, report: null }))
  await assert.doesNotReject(() => mod.enqueue({ cwd: '/nonexistent/nowhere', report: report('x', 1) }))
})

test('the queue is capped and drops the oldest report first', async () => {
  const cwd = mkrepo()
  const id = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
  const cap = mod.QUEUE_CAP
  assert.equal(cap, 50)
  for (let i = 0; i < cap; i++) {
    await mod.enqueue({ cwd, report: report(id(i)) })
    // Backdated, strictly increasing mtimes make "oldest" unambiguous.
    const f = readdirSync(queueDir(cwd)).find((n) => n.startsWith(id(i)))
    utimesSync(join(queueDir(cwd), f), new Date(2000, 0, 1, 0, 0, i), new Date(2000, 0, 1, 0, 0, i))
  }
  await mod.enqueue({ cwd, report: report(id(cap)) })
  const names = readdirSync(queueDir(cwd))
  assert.equal(names.length, cap)
  assert.ok(!names.some((n) => n.startsWith(id(0))))
  assert.ok(names.some((n) => n.startsWith(id(1))))
  assert.ok(names.some((n) => n.startsWith(id(cap))))
})

// Local stub only: the client must never need the external network to be tested.
async function stub(handler) {
  const { createServer } = await import('node:http')
  const calls = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, headers: req.headers, body })
      handler(req, res, body, calls.length)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { calls, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }
}
const json = (res, status, obj, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(obj))
}
const auth = (token = 'tok') => ({ token: async () => token, invalidate: async () => {} })

test('flush posts queued reports with the bearer token and removes the ones the server settled', async () => {
  const cwd = mkrepo()
  const ids = ['a', 'b', 'c'].map((c) => c.repeat(8) + '-0000-4000-8000-000000000000')
  for (const id of ids) await mod.enqueue({ cwd, report: report(id, 1) })
  const s = await stub((req, res, body) => {
    const { reports } = JSON.parse(body)
    const status = ['stored', 'duplicate', 'rejected']
    json(res, 200, { results: reports.map((r, i) => ({ run_id: r.run.run_id, sessions: r.run.sessions, status: status[i % 3] })) })
  })
  try {
    await mod.flush({ cwd, auth: auth('secret'), baseUrl: s.baseUrl, jitterMs: 0 })
    assert.equal(s.calls.length, 1)
    const c = s.calls[0]
    assert.equal(c.method, 'POST')
    assert.equal(c.url, '/v1/reports')
    assert.equal(c.headers.authorization, 'Bearer secret')
    assert.equal(c.headers['content-type'], 'application/json')
    const parsed = JSON.parse(c.body)
    assert.equal(c.body, JSON.stringify(parsed))
    assert.deepEqual(parsed.reports.map((r) => r.run.run_id).sort(), ids)
    assert.equal(readdirSync(queueDir(cwd)).length, 0)
  } finally {
    s.close()
  }
})

test('a null token sends nothing and keeps the queue intact', async () => {
  const cwd = mkrepo()
  await mod.enqueue({ cwd, report: report('dddddddd-0000-4000-8000-000000000000') })
  const s = await stub((req, res) => json(res, 200, { results: [] }))
  try {
    await mod.flush({ cwd, auth: auth(null), baseUrl: s.baseUrl, jitterMs: 0 })
    assert.equal(s.calls.length, 0)
    assert.equal(readdirSync(queueDir(cwd)).length, 1)
  } finally {
    s.close()
  }
})

const settleAll = (req, res, body) => {
  const { reports } = JSON.parse(body)
  json(res, 200, { results: reports.map((r) => ({ run_id: r.run.run_id, sessions: r.run.sessions, status: 'stored' })) })
}
const uid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`

test('flush splits the queue into requests of at most 8 reports', async () => {
  const cwd = mkrepo()
  for (let i = 0; i < 20; i++) await mod.enqueue({ cwd, report: report(uid(i)) })
  const s = await stub(settleAll)
  try {
    await mod.flush({ cwd, auth: auth(), baseUrl: s.baseUrl, jitterMs: 0 })
    const sizes = s.calls.map((c) => JSON.parse(c.body).reports.length)
    assert.ok(sizes.every((n) => n >= 1 && n <= 8), `sizes ${sizes}`)
    assert.equal(sizes.reduce((a, b) => a + b, 0), 20)
    assert.equal(readdirSync(queueDir(cwd)).length, 0)
  } finally {
    s.close()
  }
})

test('flush keeps every request body within 16384 bytes', async () => {
  const cwd = mkrepo()
  for (let i = 0; i < 6; i++) await mod.enqueue({ cwd, report: report(uid(i), 1, { pad: 'x'.repeat(5000) }) })
  const s = await stub(settleAll)
  try {
    await mod.flush({ cwd, auth: auth(), baseUrl: s.baseUrl, jitterMs: 0 })
    assert.ok(s.calls.length >= 2)
    assert.ok(s.calls.every((c) => Buffer.byteLength(c.body) <= 16384))
    assert.equal(readdirSync(queueDir(cwd)).length, 0)
  } finally {
    s.close()
  }
})
