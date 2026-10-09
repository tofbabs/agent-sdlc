// DELETE /v1/repo must erase exactly the calling token's repo and nothing else.
import { createHash } from 'node:crypto'
import { fakeDb } from './ingest/fake-db.mjs'
import { handle } from '../ingest/src/handler.mjs'

const sha = (s) => createHash('sha256').update(s).digest('hex')
const NOW = new Date('2026-10-09T12:00:00Z')
const REPO_A = 'a'.repeat(64)
const REPO_B = 'b'.repeat(64)
const TOKEN_A1 = 'QUExQUExQUExQUExQUExQUExQUExQUExQUExQUExQUE'
const TOKEN_A2 = 'QTJBMkEyQTJBMkEyQTJBMkEyQTJBMkEyQTJBMkEyQTI'
const TOKEN_B1 = 'QjFCMUIxQjFCMUIxQjFCMUIxQjFCMUIxQjFCMUIxQjE'
const TOKEN_B2 = 'QjJCMkIyQjJCMkIyQjJCMkIyQjJCMkIyQjJCMkIyQjI'

let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.error(`  ✗ ${name} ${detail}`); failed = 1 }
}

const created_at = '2026-10-01T00:00:00.000Z'
// Two repos, two tokens each, several reports each: scoping needs both sides populated.
async function seeded() {
  const db = fakeDb({
    tokens: {
      [sha(TOKEN_A1)]: { repo_id: REPO_A, created_at },
      [sha(TOKEN_A2)]: { repo_id: REPO_A, created_at },
      [sha(TOKEN_B1)]: { repo_id: REPO_B, created_at },
      [sha(TOKEN_B2)]: { repo_id: REPO_B, created_at },
    },
  })
  let n = 0
  for (const [repo, tok] of [[REPO_A, TOKEN_A1], [REPO_A, TOKEN_A2], [REPO_B, TOKEN_B1], [REPO_B, TOKEN_B2]]) {
    for (let i = 0; i < 2; i++) {
      await db.insertReport({
        repo_id: repo, run_id: `run-${n++}`, sessions: 1, schema: 1,
        body: '{}', token_hash: sha(tok), received_at: NOW.toISOString(),
      })
    }
  }
  return db
}
const snapshot = (db, repo) =>
  JSON.stringify({
    reports: [...db.reports.entries()].filter(([, r]) => r.repo_id === repo),
    tokens: [...db.tokenRows.entries()].filter(([, r]) => r.repo_id === repo),
  })
const count = (db, repo) => ({
  reports: [...db.reports.values()].filter((r) => r.repo_id === repo).length,
  tokens: [...db.tokenRows.values()].filter((r) => r.repo_id === repo).length,
})

const del = (db, token, { env = {}, path = '/v1/repo', method = 'DELETE', body, headers = {} } = {}) =>
  handle(
    new Request(`https://ingest.example${path}`, {
      method,
      headers: token === null ? headers : { authorization: `Bearer ${token}`, ...headers },
      body,
    }),
    { db, now: () => NOW, env },
  )

// --- scoping ---------------------------------------------------------------------
{
  const db = await seeded()
  const beforeB = snapshot(db, REPO_B)
  const res = await del(db, TOKEN_A1)
  check('DELETE /v1/repo with a known token → 204', res.status === 204, String(res.status))
  const a = count(db, REPO_A)
  check("caller's repo loses all reports and all tokens (including the sibling token)", a.reports === 0 && a.tokens === 0, JSON.stringify(a))
  check("the other repo's reports and tokens are byte-identical", snapshot(db, REPO_B) === beforeB)
  check('the other repo still has its 4 reports and 2 tokens', JSON.stringify(count(db, REPO_B)) === JSON.stringify({ reports: 4, tokens: 2 }))
}

// --- repeat and unknown ---------------------------------------------------------------
{
  const db = await seeded()
  await del(db, TOKEN_A1)
  check('repeat DELETE with the now-removed token → 401', (await del(db, TOKEN_A1)).status === 401)
  check('the sibling token of a deleted repo is also dead → 401', (await del(db, TOKEN_A2)).status === 401)
  check('a token never registered → 401', (await del(db, 'bm9wZS1ub3QtcmVnaXN0ZXJlZC1hdC1hbGwtMDAwMDAw')).status === 401)
  check('no Authorization header → 401', (await del(db, null)).status === 401)
  check('401s deleted nothing from the other repo', JSON.stringify(count(db, REPO_B)) === JSON.stringify({ reports: 4, tokens: 2 }))
}

// --- the caller cannot name the target --------------------------------------------------
{
  const db = await seeded()
  const beforeB = snapshot(db, REPO_B)
  const res = await del(db, TOKEN_A1, {
    path: `/v1/repo?repo_id=${REPO_B}`,
    body: JSON.stringify({ repo_id: REPO_B }),
    headers: { 'content-type': 'application/json', 'x-repo-id': REPO_B },
  })
  check('client-supplied repo ids (query, body, header) are ignored → 204', res.status === 204)
  check("a client-named repo_id never reaches the other repo's rows", snapshot(db, REPO_B) === beforeB)
  check("caller's own repo is what got deleted", count(db, REPO_A).reports === 0)
}

// --- kill switch ------------------------------------------------------------------------
{
  const db = await seeded()
  const res = await del(db, TOKEN_B1, { env: { KILL_SWITCH: 'on' } })
  check('DELETE during the kill switch still → 204', res.status === 204, String(res.status))
  check('and it deleted', count(db, REPO_B).reports === 0)
}

// --- routing ------------------------------------------------------------------------------
{
  const db = await seeded()
  const before = JSON.stringify([...db.reports.entries()])
  const onReports = await del(db, TOKEN_A1, { path: '/v1/reports' })
  check('DELETE /v1/reports stays method-not-allowed → 405', onReports.status === 405, String(onReports.status))
  const onRegister = await del(db, TOKEN_A1, { path: '/v1/register' })
  check('DELETE /v1/register stays method-not-allowed → 405', onRegister.status === 405, String(onRegister.status))
  const get = await del(db, TOKEN_A1, { method: 'GET' })
  check('GET /v1/repo → 405', get.status === 405, String(get.status))
  const post = await del(db, TOKEN_A1, { method: 'POST', body: '{}' })
  check('POST /v1/repo → 405', post.status === 405, String(post.status))
  check('wrong-method requests deleted nothing', JSON.stringify([...db.reports.entries()]) === before && db.tokenRows.size === 4)
}

// --- token activity: the unseen-token sweep must not drop live tokens ---------------------
{
  const { readFileSync } = await import('node:fs')
  const base = JSON.parse(readFileSync(new URL('./fixtures/ingest/valid-report.json', import.meta.url), 'utf8'))
  // run_id must be a real uuid_v4 or the edge rejects the report before it can be counted
  const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const withRun = (n) => { const r = structuredClone(base); r.run.run_id = uuid(n); return r }
  const send = (db, reports, token = TOKEN_A1) =>
    handle(
      new Request('https://ingest.example/v1/reports', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reports }),
      }),
      { db, now: () => NOW, env: {} },
    )
  const row = (db, token) => db.tokenRows.get(sha(token))

  const db = await seeded()
  const res = await send(db, [withRun(1), withRun(2)])
  check('authenticated upload still → 200', res.status === 200, String(res.status))
  check('last_seen_at is set to now on an authenticated upload', row(db, TOKEN_A1).last_seen_at === NOW.toISOString(), JSON.stringify(row(db, TOKEN_A1)))
  check('accepted_total counts each stored report', row(db, TOKEN_A1).accepted_total === 2, JSON.stringify(row(db, TOKEN_A1)))

  await send(db, [withRun(1), withRun(3)])
  check('duplicates are not counted again', row(db, TOKEN_A1).accepted_total === 3, JSON.stringify(row(db, TOKEN_A1)))

  const bad = withRun(4)
  delete bad.run.outcome
  await send(db, [bad])
  check('rejected reports are not counted', row(db, TOKEN_A1).accepted_total === 3)

  check("a sibling token's activity is untouched", row(db, TOKEN_A2).last_seen_at === undefined && row(db, TOKEN_B1).last_seen_at === undefined)

  const unauth = await send(db, [withRun(5)], 'bm9wZS1ub3QtcmVnaXN0ZXJlZC1hdC1hbGwtMDAwMDAw')
  check('an unknown token touches nothing', unauth.status === 401 && [...db.tokenRows.values()].filter((r) => r.last_seen_at).length === 1)
}

// --- scheduled sweep: retention is enforced without a manual step ----------------------
{
  const { sweep } = await import('../ingest/src/handler.mjs')
  const ago = (days) => new Date(NOW.getTime() - days * 86400000).toISOString()
  const dayAgo = (days) => ago(days).slice(0, 10)
  const mk = (hash, extra) => [hash, { repo_id: REPO_A, created_at: ago(200), ...extra }]
  const db = fakeDb({
    tokens: Object.fromEntries([
      mk('seen-89', { last_seen_at: ago(89) }),
      mk('seen-91', { last_seen_at: ago(91) }),
      mk('never-89', { created_at: ago(89) }),
      mk('never-91', { created_at: ago(91) }),
      // old created_at but recently active: only last_seen_at may keep it alive
      mk('old-but-active', { created_at: ago(300), last_seen_at: ago(1) }),
    ]),
  })
  for (const [i, days] of [[1, 89], [2, 91]]) {
    await db.insertReport({
      repo_id: REPO_B, run_id: `r${i}`, sessions: 1, schema: 1, body: '{}', token_hash: 'x', received_at: ago(days),
    })
  }
  await db.incCounter('token:t', dayAgo(1))
  await db.incCounter('token:t', dayAgo(3))
  await db.incCounter('global', dayAgo(0))

  await sweep({ db, now: () => NOW })

  check('report 89 days old is kept', db.reports.has('r1|1'))
  check('report 91 days old is deleted', !db.reports.has('r2|1'))
  check('token last seen 89 days ago is kept', db.tokenRows.has('seen-89'))
  check('token last seen 91 days ago is deleted', !db.tokenRows.has('seen-91'))
  check('never-seen token created 89 days ago is kept', db.tokenRows.has('never-89'))
  check('never-seen token created 91 days ago is deleted', !db.tokenRows.has('never-91'))
  check('old token with recent last_seen_at is kept', db.tokenRows.has('old-but-active'))
  check('counter 1 day old is kept', (await db.getCounter('token:t', dayAgo(1))) === 1)
  check('counter 3 days old is deleted', (await db.getCounter('token:t', dayAgo(3))) === 0)
  check("today's counter is kept", (await db.getCounter('global', dayAgo(0))) === 1)
}

process.exit(failed)
