// Outcome events ride inside the report export.mjs already sends (STORY-4-6).
// Run via scripts/export-outcomes.test.sh.
//
// Zero-bytes when opted out is proven at the hook (consent gate before enqueue,
// STORY-4-4). What this file can prove for that guarantee is that export.mjs is
// the only module that puts a report on the wire, so there is no second path
// outcome events could leave by.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SCRIPTS = join(ROOT, 'plugins', 'agentic-sdlc', 'scripts')
const exp = await import(join(SCRIPTS, 'export.mjs'))
const dec = await import(join(SCRIPTS, 'decisions.mjs'))
const rr = await import(join(SCRIPTS, 'run-report.mjs'))
const { handle } = await import(join(ROOT, 'ingest', 'src', 'handler.mjs'))
const { fakeDb } = await import('./ingest/fake-db.mjs')

const RUN_A = '11111111-1111-4111-8111-111111111111'
const RUN_B = '22222222-2222-4222-8222-222222222222'
const SUBJECTS = ['STORY-4-6', 'FAST-3', 'EPIC-4']
const TOKEN = 'dG9rZW4tZm9yLXRlc3RzLW9ubHktMzItYnl0ZXMhIQ'
const sha = (s) => createHash('sha256').update(s).digest('hex')

function mkrepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'export-outcomes-')))
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  execFileSync('git', ['init', '-q', dir], { env })
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init'], { env })
  return dir
}

// Run A decided and went quiet; run B (the one being reported) appends an
// outcome to A's decision, settles another of A's, and makes its own.
function buildFixtureReport() {
  const cwd = mkrepo()
  const base = { layer: 'score', rubric: 1, score: 3, choice: 'SOLO', alternative: 'PAIR', overridden: false, fallback: false }
  const open = dec.writeDecision({ ...base, run_id: RUN_A, subject: SUBJECTS[0] }, { cwd })
  const toClose = dec.writeDecision({ ...base, run_id: RUN_A, subject: SUBJECTS[1] }, { cwd })
  const mine = dec.writeDecision({ ...base, run_id: RUN_B, subject: SUBJECTS[2] }, { cwd })
  dec.appendEvent(open.decision_id, { event: 'merged', at: '2026-10-09T10:00:00.000Z', run_id: RUN_B, ref: 'pr-41', days_to_merge: 2, findings: 3 }, { cwd })
  dec.closeDecision(toClose.decision_id, { verdict: 'held', rubric: 1, at: '2026-10-09T10:00:00.000Z', run_id: RUN_B }, { cwd })
  mkdirSync(join(cwd, '.agentic-sdlc'))
  writeFileSync(
    join(cwd, '.agentic-sdlc', 'run-state.json'),
    JSON.stringify({ run_id: RUN_B, command: 'build', lane: 'deliberate', target: 'EPIC-4', started_at: '2026-10-09T09:00:00Z', sessions: 1, wall_clock_s_prior: 0, arch_snapshot: [], debt_snapshot: null, backlog: null }),
  )
  const report = rr.buildReport(rr.loadContext({ project: cwd, now: new Date('2026-10-09T11:00:00Z') }))
  return { cwd, report, ids: { open: open.decision_id, toClose: toClose.decision_id, mine: mine.decision_id } }
}

// The real edge handler behind a local socket, so the wire body is what
// export.mjs actually sent rather than what a test hand-built.
async function edge(db) {
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      seen.push(body)
      const r = await handle(
        new Request(`http://edge.test${req.url}`, { method: req.method, headers: req.headers, body: req.method === 'POST' ? body : undefined }),
        { db, now: () => new Date('2026-10-09T12:00:00Z'), env: {} },
      )
      res.writeHead(r.status, Object.fromEntries(r.headers))
      res.end(await r.text())
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { seen, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }
}

test('the real builder fills decisions, outcome_events and settlements for the run', () => {
  const { report, ids } = buildFixtureReport()
  assert.deepEqual(report.decisions.map((d) => d.decision_id), [ids.mine])
  assert.deepEqual(report.outcome_events, [{ decision_id: ids.open, event: 'merged', findings: 3, days_to_merge: 2 }])
  assert.deepEqual(report.settlements, [{ decision_id: ids.toClose, verdict: 'held', verdict_rubric: 1 }])
  assert.deepEqual(rr.validate(report), [])
})

test('outcome events arrive intact through enqueue, flush and the edge validator', async () => {
  const { cwd, report } = buildFixtureReport()
  const db = fakeDb({ tokens: { [sha(TOKEN)]: { repo_id: 'a'.repeat(64) } } })
  const s = await edge(db)
  try {
    await exp.enqueue({ cwd, report })
    await exp.flush({ cwd, auth: { token: async () => TOKEN, invalidate: async () => {} }, baseUrl: s.baseUrl, jitterMs: 0 })
    assert.equal(s.seen.length, 1)
    const wire = JSON.parse(s.seen[0])
    assert.deepEqual(wire.reports[0].outcome_events, report.outcome_events)
    assert.deepEqual(wire.reports[0].decisions, report.decisions)
    assert.deepEqual(wire.reports[0].settlements, report.settlements)
    assert.equal(db.reports.size, 1)
    const stored = JSON.parse([...db.reports.values()][0].body)
    assert.deepEqual(stored.outcome_events, report.outcome_events)
    const queue = join(cwd, '.git', 'agentic-sdlc', 'export', 'queue')
    assert.equal(readdirSync(queue).length, 0)
  } finally {
    s.close()
  }
})

test('nothing identity-shaped or free-text crosses the wire in the decision sections', async () => {
  const { cwd, report } = buildFixtureReport()
  const s = await edge(fakeDb({ tokens: { [sha(TOKEN)]: { repo_id: 'a'.repeat(64) } } }))
  try {
    await exp.enqueue({ cwd, report })
    await exp.flush({ cwd, auth: { token: async () => TOKEN, invalidate: async () => {} }, baseUrl: s.baseUrl, jitterMs: 0 })
    const raw = s.seen[0]
    assert.ok(!/(STORY|FAST|EPIC)-\d+/.test(raw), 'no backlog ID on the wire')
    assert.ok(!raw.includes(RUN_A), 'the origin run id stays local')
    assert.ok(!raw.includes('pr-41'), 'the event ref stays local')
    const uuids = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g) ?? []
    assert.ok(uuids.every((u) => u === RUN_B), 'run.run_id is the only uuid')

    const vocab = new Set(Object.values((await import(join(SCRIPTS, 'run-report-categories.mjs'))).CLOSED).flat())
    const wire = JSON.parse(raw).reports[0]
    for (const section of ['decisions', 'outcome_events', 'settlements']) {
      for (const el of wire[section]) {
        for (const [k, v] of Object.entries(el)) {
          if (k === 'decision_id') assert.match(v, /^[0-9a-f]{16}$/)
          else if (typeof v === 'string') assert.ok(vocab.has(v), `${section}.${k} = ${v} is not a vocabulary token`)
          else assert.ok(typeof v === 'number' || typeof v === 'boolean', `${section}.${k} is a ${typeof v}`)
        }
      }
    }
  } finally {
    s.close()
  }
})

test('the edge rejects an outcome event that smuggles an identity-tuple field', async () => {
  const { report } = buildFixtureReport()
  const probes = [
    { subject: 'STORY-4-6' },
    { run_id: RUN_A },
    { decision_id: 'STORY-4-6' },
    { ref: 'pr-41' },
    { note: 'free text' },
  ]
  for (const extra of probes) {
    const r = structuredClone(report)
    r.outcome_events[0] = { ...r.outcome_events[0], ...extra }
    assert.notDeepEqual(rr.validate(r), [], JSON.stringify(extra))
  }
})

test('export.mjs is the only shipped module that sends reports', () => {
  const sender = /\bfetch\s*\(|node:https?|node:net\b|XMLHttpRequest/
  const offenders = readdirSync(SCRIPTS)
    .filter((f) => f.endsWith('.mjs'))
    .filter((f) => sender.test(readFileSync(join(SCRIPTS, f), 'utf8')))
  // export-identity.mjs talks to /v1/register and /v1/repo only, never a report.
  assert.deepEqual(offenders.sort(), ['export-identity.mjs', 'export.mjs'])
  assert.ok(!/outcome_events|\/v1\/reports/.test(readFileSync(join(SCRIPTS, 'export-identity.mjs'), 'utf8')))
})
