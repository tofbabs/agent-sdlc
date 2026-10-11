// /v1/register rate limits (AC4): per-IP window and global daily cap, both fail closed.
import { fakeDb } from './ingest/fake-db.mjs'
import { handle } from '../ingest/src/handler.mjs'

const REPO = 'a'.repeat(64)
let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.error(`  ✗ ${name} ${detail}`); failed = 1 }
}

const reg = (db, at, ip = '203.0.113.7', env = { IP_SALT: 's' }) =>
  handle(
    new Request('https://ingest.example/v1/register', {
      method: 'POST',
      headers: { 'cf-connecting-ip': ip },
      body: JSON.stringify({ repo_id: REPO }),
    }),
    { db, now: () => new Date(at), env },
  )

{
  const db = fakeDb()
  const a = await reg(db, '2026-10-09T12:00:10Z')
  const b = await reg(db, '2026-10-09T12:00:20Z')
  check('first register 201, second from same IP in 60 s → 429', a.status === 201 && b.status === 429, `${a.status}/${b.status}`)
  check('429 carries Retry-After and stores no token', Number(b.headers.get('retry-after')) > 0 && db.tokenRows.size === 1)
  const c = await reg(db, '2026-10-09T12:01:10Z')
  check('same IP is allowed again after the window', c.status === 201, String(c.status))
  const d = await reg(db, '2026-10-09T12:01:15Z', '203.0.113.8')
  check('a different IP is independent', d.status === 201, String(d.status))
}
{
  const db = fakeDb()
  await reg(db, '2026-10-09T12:00:10Z')
  const keys = [...db.counters.keys()].join()
  check('counters never hold the raw IP', !keys.includes('203.0.113.7'), keys)
}
{
  const db = fakeDb()
  await db.incCounter('register-global', '2026-10-09', 500)
  db.calls.length = 0
  const res = await reg(db, '2026-10-09T12:00:00Z')
  check('global 500/day reached → 429 with Retry-After to midnight, insertToken never called',
    res.status === 429 && res.headers.get('retry-after') === String(12 * 3600) && !db.calls.includes('insertToken'), String(res.status))
}
{
  const db = fakeDb()
  await db.incCounter('register-global', '2026-10-08', 500)
  const res = await reg(db, '2026-10-09T12:00:00Z')
  check("yesterday's global count does not block today", res.status === 201, String(res.status))
}
{
  const db = fakeDb()
  for (const env of [{}, { IP_SALT: '' }]) {
    const res = await reg(db, '2026-10-09T12:00:00Z', '203.0.113.7', env)
    check(`IP_SALT ${JSON.stringify(env.IP_SALT)} → 503, no token minted, no counter touched`,
      res.status === 503 && db.tokenRows.size === 0 && db.counters.size === 0, String(res.status))
  }
}
{
  const db = fakeDb()
  const all = await Promise.all(Array.from({ length: 5 }, () => reg(db, '2026-10-09T12:00:10Z')))
  check('5 concurrent registrations from one IP → exactly one token', all.filter((r) => r.status === 201).length === 1 && db.tokenRows.size === 1,
    all.map((r) => r.status).join())
}
{
  const db = fakeDb()
  await db.incCounter('register-global', '2026-10-09', 499)
  const all = await Promise.all(['1', '2', '3', '4'].map((n) => reg(db, '2026-10-09T12:00:10Z', `203.0.113.${n}`)))
  check('concurrent registrations at 499/500 → exactly one more token', all.filter((r) => r.status === 201).length === 1,
    all.map((r) => r.status).join())
}
process.exit(failed)
