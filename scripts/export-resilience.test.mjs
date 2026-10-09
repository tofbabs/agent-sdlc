// Resilience tests for the export client (STORY-4-3): oversize, auth, backoff,
// kill switch, black hole, CLI. Run via scripts/export-resilience.test.sh.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readdirSync, realpathSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPORT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'plugins', 'agentic-sdlc', 'scripts', 'export.mjs')
const mod = await import(EXPORT)

function mkrepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'export-r-')))
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  execFileSync('git', ['init', '-q', dir], { env })
  return dir
}
const uid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
const report = (i, sessions = 1, extra = {}) => ({ schema: 1, run: { run_id: uid(i), sessions }, ...extra })
const qdir = (cwd) => join(cwd, '.git', 'agentic-sdlc', 'export', 'queue')
const qlen = (cwd) => (existsSync(qdir(cwd)) ? readdirSync(qdir(cwd)).length : 0)

async function stub(handler) {
  const calls = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      calls.push({ headers: req.headers, body })
      handler(req, res, body, calls.length)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { calls, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections?.(); server.close() } }
}
const json = (res, status, obj, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(obj))
}
const settleAll = (req, res, body) => {
  const { reports } = JSON.parse(body)
  json(res, 200, { results: reports.map((r) => ({ run_id: r.run.run_id, sessions: r.run.sessions, status: 'stored' })) })
}
function mkauth(token = 'tok') {
  const a = { invalidated: 0, token: async () => token, invalidate: async () => { a.invalidated++ } }
  return a
}

test('a single report over the request cap is dropped, the rest still sent', async () => {
  const cwd = mkrepo()
  await mod.enqueue({ cwd, report: report(1, 1, { pad: 'x'.repeat(20000) }) })
  await mod.enqueue({ cwd, report: report(2) })
  const s = await stub(settleAll)
  try {
    await mod.flush({ cwd, auth: mkauth(), baseUrl: s.baseUrl, jitterMs: 0 })
    assert.equal(s.calls.length, 1)
    assert.equal(JSON.parse(s.calls[0].body).reports.length, 1)
    assert.equal(qlen(cwd), 0)
  } finally { s.close() }
})

test('401 invalidates the token, keeps the queue and stops the flush', async () => {
  const cwd = mkrepo()
  for (let i = 0; i < 20; i++) await mod.enqueue({ cwd, report: report(i) })
  const a = mkauth()
  const s = await stub((req, res) => json(res, 401, {}))
  try {
    await mod.flush({ cwd, auth: a, baseUrl: s.baseUrl, jitterMs: 0 })
    assert.equal(s.calls.length, 1)
    assert.equal(a.invalidated, 1)
    assert.equal(qlen(cwd), 20)
  } finally { s.close() }
})

test('413 splits a batch and finally drops a lone report', async () => {
  const cwd = mkrepo()
  for (let i = 0; i < 4; i++) await mod.enqueue({ cwd, report: report(i) })
  const s = await stub((req, res, body) => {
    const { reports } = JSON.parse(body)
    if (reports.length > 1 || reports[0].run.run_id === uid(0)) return json(res, 413, {})
    settleAll(req, res, body)
  })
  try {
    await mod.flush({ cwd, auth: mkauth(), baseUrl: s.baseUrl, jitterMs: 0 })
    assert.equal(qlen(cwd), 0)
    assert.ok(s.calls.length > 1)
  } finally { s.close() }
})

for (const [name, status, headers] of [['429', 429, { 'retry-after': '120' }], ['503', 503, { 'retry-after': '120' }]]) {
  test(`${name} with Retry-After keeps the queue and later flushes send nothing until it passes`, async () => {
    const cwd = mkrepo()
    await mod.enqueue({ cwd, report: report(1) })
    let t = 1_000_000
    const s = await stub((req, res) => json(res, status, {}, headers))
    try {
      const run = () => mod.flush({ cwd, auth: mkauth(), baseUrl: s.baseUrl, jitterMs: 0, now: () => t })
      await run()
      assert.equal(s.calls.length, 1)
      assert.equal(qlen(cwd), 1)
      t += 119_000
      await run()
      assert.equal(s.calls.length, 1)
      t += 2_000
      await run()
      assert.equal(s.calls.length, 2)
      assert.equal(qlen(cwd), 1)
    } finally { s.close() }
  })
}

test('5xx without Retry-After backs off exponentially and the queue stays capped', async () => {
  const cwd = mkrepo()
  for (let i = 0; i < mod.QUEUE_CAP + 10; i++) await mod.enqueue({ cwd, report: report(i) })
  assert.equal(qlen(cwd), mod.QUEUE_CAP)
  let t = 5_000_000
  const s = await stub((req, res) => json(res, 500, {}))
  try {
    const run = () => mod.flush({ cwd, auth: mkauth(), baseUrl: s.baseUrl, jitterMs: 0, now: () => t })
    await run()
    await run()
    assert.equal(s.calls.length, 1)
    t += 3_600_001
    await run()
    assert.equal(s.calls.length, 2)
  } finally { s.close() }
})

test('kill switch holds until Retry-After passes, then probes and recovers', async () => {
  const cwd = mkrepo()
  await mod.enqueue({ cwd, report: report(1) })
  let t = 9_000_000
  let stopped = true
  const s = await stub((req, res, body) => (stopped ? json(res, 503, { stop: true }, { 'retry-after': '600' }) : settleAll(req, res, body)))
  try {
    const run = () => mod.flush({ cwd, auth: mkauth(), baseUrl: s.baseUrl, jitterMs: 0, now: () => t })
    await run()
    t += 599_000
    await run()
    assert.equal(s.calls.length, 1)
    assert.equal(qlen(cwd), 1)
    t += 2_000
    stopped = false
    await run()
    assert.equal(s.calls.length, 2)
    assert.equal(qlen(cwd), 0)
    await mod.enqueue({ cwd, report: report(2) })
    await run()
    assert.equal(s.calls.length, 3)
  } finally { s.close() }
})

test('a black-hole endpoint cannot hold the caller past the per-call timeout', async () => {
  const cwd = mkrepo()
  await mod.enqueue({ cwd, report: report(1) })
  const s = await stub(() => {})
  try {
    const t0 = Date.now()
    await mod.flush({ cwd, auth: mkauth(), baseUrl: s.baseUrl, jitterMs: 0, timeoutMs: 300 })
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`)
    assert.equal(qlen(cwd), 1)
  } finally { s.close() }
})

test('a hung fetch that ignores its signal is still bounded by the total budget', async () => {
  const cwd = mkrepo()
  await mod.enqueue({ cwd, report: report(1) })
  const t0 = Date.now()
  await mod.flush({ cwd, auth: mkauth(), baseUrl: 'http://x', fetch: () => new Promise(() => {}), jitterMs: 0, budgetMs: 300 })
  assert.ok(Date.now() - t0 < 2000)
  assert.equal(qlen(cwd), 1)
})

test('a connection refused is a backoff, not a throw', async () => {
  const cwd = mkrepo()
  await mod.enqueue({ cwd, report: report(1) })
  await assert.doesNotReject(() => mod.flush({ cwd, auth: mkauth(), baseUrl: 'http://127.0.0.1:1', jitterMs: 0 }))
  assert.equal(qlen(cwd), 1)
})

test('jitterMs delays the first send by at most jitterMs', async () => {
  const cwd = mkrepo()
  await mod.enqueue({ cwd, report: report(1) })
  const s = await stub(settleAll)
  try {
    const t0 = Date.now()
    await mod.flush({ cwd, auth: mkauth(), baseUrl: s.baseUrl, jitterMs: 200 })
    assert.ok(Date.now() - t0 < 1500)
    assert.equal(qlen(cwd), 0)
  } finally { s.close() }
})

test('every request carries each report run.run_id and run.sessions unmodified, nothing added', async () => {
  const cwd = mkrepo()
  const rs = [report(1, 1, { a: 1 }), report(1, 2, { a: 2 }), report(2, 1)]
  for (const r of rs) await mod.enqueue({ cwd, report: r })
  const s = await stub(settleAll)
  try {
    await mod.flush({ cwd, auth: mkauth(), baseUrl: s.baseUrl, jitterMs: 0 })
    const sent = s.calls.flatMap((c) => JSON.parse(c.body).reports)
    assert.equal(sent.length, 3)
    for (const r of rs) assert.deepEqual(sent.find((x) => x.run.run_id === r.run.run_id && x.run.sessions === r.run.sessions), r)
    assert.ok(s.calls.every((c) => Object.keys(JSON.parse(c.body)).join() === 'reports'))
  } finally { s.close() }
})

test('the CLI always exits 0, even on junk input and with no repo', () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'export-cli-')))
  const bad = join(cwd, 'bad.json')
  writeFileSync(bad, 'not json')
  for (const args of [['enqueue', bad], ['enqueue'], ['flush'], ['bogus']]) {
    const r = spawnSync(process.execPath, [EXPORT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, AGENTIC_SDLC_EXPORT_URL: 'http://127.0.0.1:1' } })
    assert.equal(r.status, 0, `${args}: ${r.stderr}`)
  }
})

test('the CLI enqueue command queues a report file', () => {
  const cwd = mkrepo()
  const f = join(cwd, 'r.json')
  writeFileSync(f, JSON.stringify(report(7)))
  assert.equal(spawnSync(process.execPath, [EXPORT, 'enqueue', f], { cwd }).status, 0)
  assert.equal(qlen(cwd), 1)
})
