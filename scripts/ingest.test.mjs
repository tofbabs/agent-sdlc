// Runs the pure handler against an in-memory db: no wrangler, no network.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fakeDb } from './ingest/fake-db.mjs'
import { handle } from '../ingest/src/handler.mjs'

const report = JSON.parse(readFileSync(new URL('./fixtures/ingest/valid-report.json', import.meta.url), 'utf8'))
const TOKEN = 'dG9rZW4tZm9yLXRlc3RzLW9ubHktMzItYnl0ZXMhIQ'
const sha = (s) => createHash('sha256').update(s).digest('hex')
const REPO = 'a'.repeat(64)
const NOW = new Date('2026-10-09T12:00:00Z')

let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.error(`  ✗ ${name} ${detail}`); failed = 1 }
}

const mk = (over = {}) => {
  const r = structuredClone(report)
  over.mutate?.(r)
  return r
}
const fresh = () => fakeDb({ tokens: { [sha(TOKEN)]: { repo_id: REPO } } })
const post = (db, body, { headers = {}, env = {} } = {}) =>
  handle(
    new Request('https://ingest.example/v1/reports', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { db, now: () => NOW, env },
  )

// --- stored under the token's repo, never the body's -----------------------
{
  const db = fresh()
  const res = await post(db, { reports: [report] })
  const j = await res.json()
  check('valid report → 200 stored', res.status === 200 && j.results?.[0]?.status === 'stored', JSON.stringify(j))
  check('result echoes run_id and sessions', j.results?.[0]?.run_id === report.run.run_id && j.results?.[0]?.sessions === 1)
  const row = [...db.reports.values()][0]
  check('row carries repo_id from the token record and the token hash', row?.repo_id === REPO && row?.token_hash === sha(TOKEN))
  check('stored body is the validated report', row && JSON.stringify(JSON.parse(row.body)) === JSON.stringify(report))
}

// --- per-item rejection, validated against the shared schema ----------------
const bads = {
  'unknown schema version': (r) => { r.schema = 2 },
  'unknown enum value': (r) => { r.run.command = 'nope' },
  'extra unknown field': (r) => { r.extra = 1 },
  'repo_id smuggled in the body': (r) => { r.repo_id = 'b'.repeat(64) },
  'oversized string field': (r) => { r.run.run_id = 'x'.repeat(5000) },
}
for (const [name, m] of Object.entries(bads)) {
  const db = fresh()
  const res = await post(db, { reports: [mk({ mutate: m })] })
  const j = await res.json()
  check(`${name} → rejected, storage untouched`, res.status === 200 && j.results?.[0]?.status === 'rejected' && db.writes().length === 0, JSON.stringify(j))
}
{
  const db = fresh()
  const good = mk({ mutate: (r) => { r.run.run_id = '11111111-1111-4111-8111-111111111111' } })
  const j = await (await post(db, { reports: [mk({ mutate: bads['unknown enum value'] }), good] })).json()
  check('a malformed item does not void the batch', j.results?.map((x) => x.status).join() === 'rejected,stored' && db.reports.size === 1, JSON.stringify(j))
}

// --- envelope ----------------------------------------------------------------
for (const [name, body] of Object.entries({
  'not JSON': '{nope',
  'reports missing': {},
  'reports not an array': { reports: report },
  'zero reports': { reports: [] },
  'nine reports': { reports: Array.from({ length: 9 }, () => report) },
})) {
  const db = fresh()
  const res = await post(db, body)
  check(`bad envelope (${name}) → 400, no writes`, res.status === 400 && db.writes().length === 0, String(res.status))
}

// --- size cap: checked before any db access ----------------------------------
{
  const db = fresh()
  const res = await post(db, { reports: [report] }, { headers: { 'content-length': '16385' } })
  check('Content-Length over 16384 → 413, db never touched', res.status === 413 && db.calls.length === 0, String(res.status))
}
{
  const db = fresh()
  const res = await post(db, JSON.stringify({ reports: [report], pad: 'x'.repeat(16400) }))
  check('actual bytes over 16384 without a header → 413, db never touched', res.status === 413 && db.calls.length === 0, String(res.status))
}

// --- auth and per-token daily cap -------------------------------------------
{
  const db = fakeDb()
  const res = await post(db, { reports: [report] })
  check('unknown token → 401, no writes', res.status === 401 && db.writes().length === 0, String(res.status))
}
{
  const db = fresh()
  const res = await post(db, { reports: [report] }, { headers: { authorization: '' } })
  check('missing bearer → 401, no writes', res.status === 401 && db.writes().length === 0, String(res.status))
}
// Counter key shape is part of the contract with the D1 adapter: one row per token hash per UTC day.
const CAP_KEY = `token:${sha(TOKEN)}`
{
  const db = fresh()
  await db.incCounter(CAP_KEY, '2026-10-09', 100)
  db.calls.length = 0
  const res = await post(db, { reports: [report] })
  check('token at 100 reports today → 429, nothing written', res.status === 429 && !db.calls.includes('insertReport'), String(res.status))
  check('Retry-After is seconds to the next UTC midnight', res.headers.get('retry-after') === String(12 * 3600), String(res.headers.get('retry-after')))
}
{
  const db = fresh()
  await db.incCounter(CAP_KEY, '2026-10-08', 100)
  const res = await post(db, { reports: [report] })
  check("yesterday's count does not block today", res.status === 200)
}
{
  const db = fresh()
  await db.incCounter(CAP_KEY, '2026-10-09', 99)
  const res = await post(db, { reports: [report] })
  check('report 100 is accepted and counted', res.status === 200 && (await db.getCounter(CAP_KEY, '2026-10-09')) === 100)
}
{
  const db = fresh()
  await post(db, { reports: [report] })
  const j = await (await post(db, { reports: [report] })).json()
  check('replayed report is a duplicate and does not consume the cap', j.results?.[0]?.status === 'duplicate' && (await db.getCounter(CAP_KEY, '2026-10-09')) === 1, JSON.stringify(j))
}

// --- idempotency key is (run_id, sessions) ------------------------------------
{
  const db = fresh()
  await post(db, { reports: [report] })
  const higher = mk({ mutate: (r) => { r.run.sessions = report.run.sessions + 1 } })
  const j = await (await post(db, { reports: [higher] })).json()
  check('same run_id with higher sessions is stored as new', j.results?.[0]?.status === 'stored' && db.reports.size === 2, JSON.stringify(j))
}

// --- kill switch: refuses before any storage access -------------------------
{
  const db = fresh()
  const res = await post(db, { reports: [report] }, { env: { KILL_SWITCH: 'on' } })
  const j = await res.json().catch(() => ({}))
  check('KILL_SWITCH=on → 503 {"stop":true} with Retry-After', res.status === 503 && j.stop === true && Number(res.headers.get('retry-after')) > 0, String(res.status))
  check('kill switch never reaches the db', db.calls.length === 0, db.calls.join())
}
{
  const db = fresh()
  const res = await post(db, { reports: [report] }, { env: { KILL_SWITCH: 'off' } })
  check('KILL_SWITCH other than on leaves ingestion open', res.status === 200, String(res.status))
}

// --- /v1/register ------------------------------------------------------------
const register = (db, body, { ip = '203.0.113.7', env = {} } = {}) =>
  handle(
    new Request('https://ingest.example/v1/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { db, now: () => NOW, env: { IP_SALT: 'test-salt', ...env } },
  )
{
  const db = fakeDb()
  const res = await register(db, { repo_id: REPO })
  const j = await res.json().catch(() => ({}))
  check('register → 201 with a base64url 32-byte token', res.status === 201 && /^[A-Za-z0-9_-]{43}$/.test(j.token ?? ''), JSON.stringify(j))
  check('only sha256(token) and repo_id are stored', db.tokenRows.size === 1 && db.tokenRows.get(sha(j.token))?.repo_id === REPO && !JSON.stringify([...db.tokenRows]).includes(j.token))
  const res2 = await handle(
    new Request('https://ingest.example/v1/reports', {
      method: 'POST',
      headers: { authorization: `Bearer ${j.token}` },
      body: JSON.stringify({ reports: [report] }),
    }),
    { db, now: () => NOW },
  )
  check('the issued token authenticates /v1/reports', res2.status === 200, String(res2.status))
}
for (const [name, body] of Object.entries({
  'not JSON': '{nope',
  'repo_id missing': {},
  'repo_id not 64 hex': { repo_id: 'abc' },
  'repo_id uppercase hex': { repo_id: 'A'.repeat(64) },
  'extra field': { repo_id: REPO, extra: 1 },
})) {
  const db = fakeDb()
  const res = await register(db, body)
  check(`register with ${name} → 400, no token stored`, res.status === 400 && db.tokenRows.size === 0, String(res.status))
}
{
  const db = fakeDb()
  const res = await register(db, { repo_id: REPO }, { env: { KILL_SWITCH: 'on' } })
  check('kill switch also stops /v1/register', res.status === 503 && db.calls.length === 0, String(res.status))
}
{
  const res = await handle(new Request('https://ingest.example/v1/nope', { method: 'POST', body: '{}' }), { db: fakeDb(), now: () => NOW })
  check('unknown path → 404', res.status === 404, String(res.status))
  const res2 = await handle(new Request('https://ingest.example/v1/reports', { method: 'GET' }), { db: fresh(), now: () => NOW })
  check('wrong method on a known path → 405', res2.status === 405, String(res2.status))
}

process.exit(failed)
