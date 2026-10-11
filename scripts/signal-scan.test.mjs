// Drives the CLI over temp dirs so the summary a human reads is what is pinned.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const SCAN = new URL('./signal-scan.mjs', import.meta.url).pathname
const report = JSON.parse(readFileSync(new URL('./fixtures/signal/report.json', import.meta.url), 'utf8'))
const NOW = '2026-10-09T12:00:00Z'
const REASONS = ['unreadable', 'oversize', 'not_json', 'envelope_invalid', 'report_invalid', 'superseded', 'run_id_conflict']

let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.error(`  ✗ ${name} ${detail}`); failed = 1 }
}

const envelope = (r = report, over = {}) => ({
  envelope: 1,
  source: 'a'.repeat(32),
  source_first_seen: '2026-09-01T00:00:00Z',
  received_at: '2026-10-07T10:00:00Z',
  report: r,
  ...over,
})
const withDir = (files, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'signal-scan-'))
  try {
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body))
    }
    return fn(dir)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const run = (dir, extra = []) =>
  execFileSync('node', [SCAN, '--source', `dir:${dir}`, '--now', NOW, ...extra], { encoding: 'utf8' })
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)

// --- every file lands in exactly one bucket ---------------------------------
{
  const bad = structuredClone(report)
  bad.run.command = 'not-a-command'
  const files = {
    'a-envelope.json': envelope(),
    'b-bare.json': report,
    'c-garbage.json': '{nope',
    'd-huge.json': ' '.repeat(21 * 1024),
    'e-bad-envelope.json': envelope(report, { envelope: 2 }),
    'f-bad-report.json': envelope(bad),
  }
  withDir(files, (dir) => {
    const s = JSON.parse(run(dir))
    check('files counted', s.files === 6, JSON.stringify(s))
    check('both envelope and bare reports accepted', s.accepted === 2, JSON.stringify(s))
    check('rejected lists the full closed reason set, zero-filled',
      JSON.stringify(Object.keys(s.rejected)) === JSON.stringify(REASONS), JSON.stringify(s.rejected))
    check('each failure maps to its own reason',
      s.rejected.not_json === 1 && s.rejected.oversize === 1 &&
      s.rejected.envelope_invalid === 1 && s.rejected.report_invalid === 1, JSON.stringify(s.rejected))
    check('counts sum to the file count',
      s.accepted + sum(s.rejected) + s.skipped_window === s.files, JSON.stringify(s))
  })
}

// --- poisoned content never reaches later stages ----------------------------
{
  const unknownInReport = structuredClone(report)
  unknownInReport.smuggled = 'x'
  const longString = structuredClone(report)
  longString.run.command = 'x'.repeat(10 * 1024)
  const files = {
    'a-ok.json': envelope(),
    'b-envelope-extra.json': envelope(report, { note: 'hi' }),
    'c-bad-timestamp.json': envelope(report, { received_at: 'yesterday' }),
    'd-long-timestamp.json': envelope(report, { source_first_seen: '2026-09-01T00:00:00Z'.padEnd(5000, '0') }),
    'e-report-unknown-field.json': envelope(unknownInReport),
    'f-report-long-string.json': envelope(longString),
    'g-bare-unknown-field.json': unknownInReport,
    'h-envelope-missing-report.json': { ...envelope(), report: undefined },
  }
  withDir(files, (dir) => {
    const s = JSON.parse(run(dir))
    check('only the clean envelope is accepted', s.accepted === 1, JSON.stringify(s))
    check('envelope-level poison is envelope_invalid',
      s.rejected.envelope_invalid === 4, JSON.stringify(s.rejected))
    check('report-level poison is report_invalid',
      s.rejected.report_invalid === 3, JSON.stringify(s.rejected))
    check('counts sum to the file count',
      s.accepted + sum(s.rejected) + s.skipped_window === s.files, JSON.stringify(s))
  })
}

// --- run_id dedupe is order-independent -------------------------------------
{
  const other = structuredClone(report)
  other.run.run_id = '11111111-2222-4333-8444-555555555555'
  const older = envelope(report, { received_at: '2026-10-05T10:00:00Z' })
  const newer = envelope(report, { received_at: '2026-10-07T10:00:00Z' })
  const layouts = {
    'latest wins, older superseded': [{ 'a.json': older, 'b.json': newer, 'c.json': envelope(other) }],
    'same result with the file order reversed': [{ 'a.json': newer, 'b.json': older, 'c.json': envelope(other) }],
  }
  for (const [label, [files]] of Object.entries(layouts)) {
    withDir(files, (dir) => {
      const s = JSON.parse(run(dir))
      check(`${label}: one superseded, two accepted`,
        s.accepted === 2 && s.rejected.superseded === 1 && s.rejected.run_id_conflict === 0, JSON.stringify(s))
      check(`${label}: counts sum to the file count`,
        s.accepted + sum(s.rejected) + s.skipped_window === s.files, JSON.stringify(s))
    })
  }

  const conflicting = {
    'a.json': envelope(report, { source: 'a'.repeat(32) }),
    'b.json': envelope(report, { source: 'b'.repeat(32) }),
    'c.json': envelope(report, { source: 'b'.repeat(32), received_at: '2026-10-06T10:00:00Z' }),
    'd.json': envelope(other),
  }
  withDir(conflicting, (dir) => {
    const s = JSON.parse(run(dir))
    check('a run_id under two sources rejects every copy, superseded or not',
      s.rejected.run_id_conflict === 3 && s.rejected.superseded === 0 && s.accepted === 1, JSON.stringify(s))
  })

  // Invalid reports never join dedupe, or a poisoned copy could evict a good one.
  const bad = structuredClone(report)
  bad.smuggled = 1
  withDir({ 'a.json': envelope(report), 'b.json': envelope(bad, { received_at: '2026-10-08T10:00:00Z' }) }, (dir) => {
    const s = JSON.parse(run(dir))
    check('a rejected copy does not supersede a valid one',
      s.accepted === 1 && s.rejected.report_invalid === 1 && s.rejected.superseded === 0, JSON.stringify(s))
  })
}

// --- rolling 30-day window on received_at ----------------------------------
{
  const other = structuredClone(report)
  other.run.run_id = '11111111-2222-4333-8444-555555555555'
  const files = {
    'a-fresh.json': envelope(),
    'b-edge.json': envelope(other, { received_at: '2026-09-09T12:00:00Z' }),
    'c-stale.json': envelope(report, { received_at: '2026-09-09T11:59:59Z' }),
  }
  withDir(files, (dir) => {
    const s = JSON.parse(run(dir))
    // Window is applied before dedupe so a stale copy neither counts as superseded nor evicts a fresh one.
    check('a report exactly 30 days old is in the window, older is skipped',
      s.accepted === 2 && s.skipped_window === 1 && s.rejected.superseded === 0, JSON.stringify(s))
    check('counts sum to the file count',
      s.accepted + sum(s.rejected) + s.skipped_window === s.files, JSON.stringify(s))
    const later = JSON.parse(run(dir, ['--now', '2026-10-20T00:00:00Z']))
    check('--now moves the window',
      later.accepted === 1 && later.skipped_window === 2, JSON.stringify(later))
  })

  withDir({ 'a.json': report }, (dir) => {
    const old = new Date('2026-07-01T00:00:00Z')
    utimesSync(join(dir, 'a.json'), old, old)
    const s = JSON.parse(run(dir))
    check('a bare report is windowed by its file mtime', s.accepted === 0 && s.skipped_window === 1, JSON.stringify(s))
  })
}

// --- rerun determinism -------------------------------------------------------
{
  const bad = structuredClone(report)
  bad.run.command = 'not-a-command'
  const dup = structuredClone(report)
  const files = { 'a.json': envelope(), 'b.json': envelope(dup, { received_at: '2026-10-08T10:00:00Z' }), 'c.json': '{nope', 'd.json': envelope(bad), 'e.json': report }
  const reversed = Object.fromEntries(Object.entries(files).reverse())
  const first = withDir(files, (dir) => run(dir))
  const again = withDir(files, (dir) => run(dir))
  const other = withDir(reversed, (dir) => run(dir))
  check('rerun over the same files is byte-identical', first === again, `${first} vs ${again}`)
  check('creation order does not change the summary bytes', first === other, `${first} vs ${other}`)
  check('summary carries no wall-clock value', !/20\d\d-\d\d-\d\dT/.test(first), first)
}

// --- grouping by signature --------------------------------------------------
const { groupReports } = await import('./signal-scan.mjs')
const { createHash } = await import('node:crypto')
const fp = (...key) => 'sig-' + createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 12)

const entry = (over = {}, source = 'a'.repeat(32), runId) => {
  const r = structuredClone(report)
  if (runId) r.run.run_id = runId
  r.review.findings = over.findings ?? []
  return { report: r, source, received_at: '2026-10-07T10:00:00Z' }
}
const finding = (category, severity, round = 1) => ({ round, category, severity })
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

{
  const entries = [
    // Two identical findings in one run still count that run once.
    entry({ findings: [finding('correctness', 'MAJOR'), finding('correctness', 'MAJOR', 2)] }, 'a'.repeat(32), uuid(1)),
    entry({ findings: [finding('correctness', 'MAJOR')] }, 'a'.repeat(32), uuid(2)),
    entry({ findings: [finding('correctness', 'MAJOR')] }, 'b'.repeat(32), uuid(3)),
    entry({ findings: [finding('correctness', 'MINOR')] }, 'b'.repeat(32), uuid(4)),
  ]
  const findings = groupReports(entries).filter((g) => g.kind === 'finding')
  const major = findings.find((g) => g.key.at(-1) === 'MAJOR')
  check('findings split by severity into separate groups', findings.length === 2, JSON.stringify(findings))
  check('a shared signature forms one group counting runs, not findings',
    major?.runs === 3, JSON.stringify(major))
  check('distinct repos are distinct sources', major?.repos === 2, JSON.stringify(major))
  check('key is the ordered ADR-0004 finding fields',
    JSON.stringify(major?.key) === JSON.stringify(['build', 'deliberate', 'SOLO', 'correctness', 'MAJOR']), JSON.stringify(major?.key))
  check('id is the ADR-0004 fingerprint of the kind and key',
    major?.id === fp('finding', 'build', 'deliberate', 'SOLO', 'correctness', 'MAJOR'), major?.id)
  check('membership keeps run_id and source for later weighting',
    JSON.stringify(major?.members.map((m) => m.run_id).sort()) === JSON.stringify([uuid(1), uuid(2), uuid(3)]) &&
    major.members.every((m) => typeof m.source === 'string'), JSON.stringify(major?.members))
}

// --- single-field kinds -----------------------------------------------------
{
  const e = (mutate, source = 'a'.repeat(32), n = 10) => {
    const x = entry({}, source, uuid(n))
    mutate(x.report)
    return x
  }
  const entries = [
    e((r) => { r.plan.arch_handoffs = { contract: 2 }; r.build.arch_blocks = { contract: 1 } }, 'a'.repeat(32), 10),
    e((r) => { r.plan.arch_handoffs = { contract: 1 }; r.run.outcome = 'blocked'; r.degraded = ['gate_history'] }, 'b'.repeat(32), 11),
    e((r) => { r.run.outcome = 'aborted'; r.plan.arch_handoffs = {} }, 'b'.repeat(32), 12),
  ]
  const groups = groupReports(entries)
  const by = (kind) => groups.filter((g) => g.kind === kind)
  const handoff = by('arch_handoff')
  check('a handoff category counts each report once, not its count',
    handoff.length === 1 && handoff[0].runs === 2 && handoff[0].repos === 2 &&
    JSON.stringify(handoff[0].key) === JSON.stringify(['build', 'deliberate', 'SOLO', 'contract']), JSON.stringify(handoff))
  check('arch_block is its own kind with the same key shape',
    by('arch_block').length === 1 && by('arch_block')[0].id === fp('arch_block', 'build', 'deliberate', 'SOLO', 'contract'),
    JSON.stringify(by('arch_block')))
  check('only blocked and aborted outcomes form outcome groups',
    JSON.stringify(by('outcome').map((g) => g.key.at(-1)).sort()) === JSON.stringify(['aborted', 'blocked']), JSON.stringify(by('outcome')))
  check('degraded key omits mode',
    JSON.stringify(by('degraded').map((g) => g.key)) === JSON.stringify([['build', 'deliberate', 'gate_history']]), JSON.stringify(by('degraded')))
  check('a completed clean run produces no outcome or degraded group',
    groupReports([e(() => {})]).every((g) => !['outcome', 'degraded'].includes(g.kind)))
}

// --- metric outliers ----------------------------------------------------------
{
  const srcs = ['a', 'b', 'c'].map((c) => c.repeat(32))
  const e = (n, revise) => {
    const x = entry({}, srcs[n % 3], uuid(100 + n))
    x.report.build.revise_rounds = revise
    return x
  }
  // Two high runs among twenty keep the median at 1, so the baseline is the
  // ordinary run and not shifted by the outliers it is meant to expose.
  const entries = Array.from({ length: 22 }, (_, n) => e(n, n < 2 ? 4 : 1))
  const out = groupReports(entries).filter((g) => g.kind === 'outlier')
  const g = out.find((o) => o.key.at(-1) === 'revise_rounds')
  check('a metric at or above twice the baseline forms one outlier group', out.length === 1 && !!g, JSON.stringify(out))
  check('outlier key is command, lane, mode, metric',
    JSON.stringify(g?.key) === JSON.stringify(['build', 'deliberate', 'SOLO', 'revise_rounds']), JSON.stringify(g?.key))
  check('outlier id is the ADR-0004 fingerprint', g?.id === fp('outlier', 'build', 'deliberate', 'SOLO', 'revise_rounds'), g?.id)
  check('only the outlying reports are members', g?.runs === 2 && g?.repos === 2, JSON.stringify(g))
  check('ratio is group median over the global baseline', g?.ratio === 4, JSON.stringify(g?.ratio))
}

// --- no baseline --------------------------------------------------------------
{
  const { discardsOf } = await import('./signal-scan.mjs')
  const mk = (count, sourceCount) => Array.from({ length: count }, (_, n) => {
    const x = entry({}, String.fromCharCode(97 + (n % sourceCount)).repeat(32), uuid(200 + n))
    x.report.build.revise_rounds = n < 2 ? 9 : 1
    return x
  })
  const few = mk(19, 3)
  const narrow = mk(20, 2)
  const enough = mk(20, 3)
  const outliers = (es) => groupReports(es).filter((g) => g.kind === 'outlier')
  check('fewer than 20 reports yield no outlier group', outliers(few).length === 0, JSON.stringify(outliers(few)))
  check('fewer than 3 sources yield no outlier group', outliers(narrow).length === 0, JSON.stringify(outliers(narrow)))
  check('exactly 20 reports from 3 sources do form a baseline', outliers(enough).length === 1, JSON.stringify(outliers(enough)))
  check('a missing baseline discards every report as no_baseline', discardsOf(few).no_baseline === 19 && discardsOf(narrow).no_baseline === 20,
    JSON.stringify([discardsOf(few), discardsOf(narrow)]))
  check('a sufficient baseline discards nothing', discardsOf(enough).no_baseline === 0, JSON.stringify(discardsOf(enough)))
}

// --- determinism ----------------------------------------------------------------
{
  const srcs = ['a', 'b', 'c'].map((c) => c.repeat(32))
  const entries = Array.from({ length: 24 }, (_, n) => {
    const x = entry({}, srcs[n % 3], uuid(300 + n))
    x.report.build.revise_rounds = n < 2 ? 4 : 1
    if (n % 2) x.report.plan.arch_handoffs = { contract: 1 }
    if (n % 5 === 0) x.report.run.outcome = 'blocked'
    return x
  })
  const baseline = JSON.stringify(groupReports(entries))
  // Fixed-seed shuffle so a failure reproduces.
  const shuffled = (seed) => {
    const a = [...entries]
    let s = seed
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2147483648
      const j = s % (i + 1)
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  check('reversed input gives identical groups', JSON.stringify(groupReports([...entries].reverse())) === baseline)
  check('shuffled inputs give identical groups, members and ids',
    [1, 2, 3, 4, 5].every((seed) => JSON.stringify(groupReports(shuffled(seed))) === baseline))
  const ids = groupReports(entries).map((g) => g.id)
  check('groups are ordered by id', JSON.stringify(ids) === JSON.stringify([...ids].sort()), JSON.stringify(ids))
}

// --- debt kind -----------------------------------------------------------------
{
  const withDebt = (byCat, runId) => {
    const x = entry({}, 'a'.repeat(32), runId)
    x.report.debt = { rows_logged: 0, by_risk: { HIGH: 3 }, by_category: byCat }
    return x
  }
  const debts = (es) => groupReports(es).filter((g) => g.kind === 'debt')
  const g = debts([withDebt({ robustness: 2, observability: 1 }, uuid(400))])
  check('by_category yields one debt group per category, severity always *',
    g.length === 2 && g.every((d) => d.key[4] === '*' && d.runs === 1), JSON.stringify(g))
  check('debt rows are summed from by_category, not from by_risk',
    JSON.stringify(g.map((d) => [d.key[3], d.debt_rows]).sort()) === JSON.stringify([['observability', 1], ['robustness', 2]]), JSON.stringify(g))
  const two = debts([withDebt({ robustness: 2 }, uuid(401)), withDebt({ robustness: 3 }, uuid(402))])
  check('rows sum across reports while each report counts once',
    two.length === 1 && two[0].runs === 2 && two[0].debt_rows === 5, JSON.stringify(two))
  check('empty by_category yields no debt group', debts([withDebt({}, uuid(403))]).length === 0)
}

// --- verdict kind --------------------------------------------------------------
{
  const { verdictSignals } = await import('./signal-scan.mjs')
  const did = (n) => String(n).padStart(16, '0')
  const dec = (n, over = {}) => ({
    decision_id: did(n), layer: 'lane', rubric: 2, choice: 'PAIR', overridden: false, fallback: false, ...over,
  })
  const e = (n, decisions, settlements) => {
    const x = entry({}, 'a'.repeat(32), uuid(500 + n))
    if (decisions) x.report.decisions = decisions
    if (settlements) x.report.settlements = settlements
    return x
  }
  const entries = [
    e(1, [dec(1, { verdict: 'earned', verdict_rubric: 2 }), dec(2, { verdict: 'wasted', verdict_rubric: 2 }),
      dec(3, { layer: 'floor', choice: 'SOLO', rubric: 1 })]),
    // The settling run is a different report than the one that made the decision.
    e(2, [dec(4)], [{ decision_id: did(3), verdict: 'held', verdict_rubric: 1 }, { decision_id: did(4), verdict: 'earned', verdict_rubric: 2 }]),
  ]
  const { groups } = verdictSignals(entries)
  const lane = groups.find((g) => g.key[0] === 'lane')
  const floor = groups.find((g) => g.key[0] === 'floor')
  check('a group per layer, choice and rubric with ADR-0004 key order',
    groups.length === 2 && JSON.stringify(lane?.key) === JSON.stringify(['lane', 'PAIR', 2]), JSON.stringify(groups))
  check('id is the ADR-0004 fingerprint of kind verdict', lane?.id === fp('verdict', 'lane', 'PAIR', 2), lane?.id)
  check('inline verdicts and joined settlements are tallied by token',
    lane?.settled === 3 && lane.counts.earned === 2 && lane.counts.wasted === 1, JSON.stringify(lane))
  check('a settlement from a later report lands on its decision group',
    floor?.settled === 1 && floor.counts.held === 1, JSON.stringify(floor))
}

{
  const { verdictSignals } = await import('./signal-scan.mjs')
  const did = (n) => String(n).padStart(16, '0')
  const dec = (n, over = {}) => ({
    decision_id: did(n), layer: 'lane', rubric: 2, choice: 'PAIR', overridden: false, fallback: false, ...over,
  })
  const e = (n, decisions, settlements) => {
    const x = entry({}, 'a'.repeat(32), uuid(600 + n))
    if (decisions) x.report.decisions = decisions
    if (settlements) x.report.settlements = settlements
    return x
  }
  const r = verdictSignals([
    e(1, [dec(1, { verdict: 'earned', verdict_rubric: 2 }), dec(2), dec(3)]),
    // did(9) has no decision in the window; guessing its group would pollute a rubric's rate.
    e(2, [], [{ decision_id: did(9), verdict: 'wasted', verdict_rubric: 2 }]),
  ])
  check('open decisions are counted apart and never enter a group',
    r.open === 2 && r.groups.length === 1 && r.groups[0].settled === 1, JSON.stringify(r))
  check('a settlement without its decision is counted unjoined, not guessed',
    r.unjoined === 1 && !r.groups[0].counts.wasted, JSON.stringify(r))
}

{
  const { verdictSignals } = await import('./signal-scan.mjs')
  const did = (n) => String(n).padStart(16, '0')
  const dec = (n, verdict, over = {}) => ({
    decision_id: did(n), layer: 'lane', rubric: 2, choice: 'PAIR', overridden: false, fallback: false, verdict, verdict_rubric: 2, ...over,
  })
  const x = entry({}, 'a'.repeat(32), uuid(700))
  x.report.decisions = [dec(1, 'earned'), dec(2, 'needed'), dec(3, 'held'), dec(4, 'wasted'),
    dec(5, 'missed', { layer: 'floor', choice: 'SOLO', rubric: 1 }), dec(6, 'over_ceremony', { layer: 'floor', choice: 'SOLO', rubric: 1 })]
  const { groups } = verdictSignals([x])
  const lane = groups.find((g) => g.key[0] === 'lane')
  const floor = groups.find((g) => g.key[0] === 'floor')
  check('right_rate is the share of right verdicts among settled', lane?.right_rate === 0.75, JSON.stringify(lane))
  check('a group with only wrong verdicts has a right_rate of zero', floor?.right_rate === 0, JSON.stringify(floor))
}

{
  const { verdictSignals } = await import('./signal-scan.mjs')
  const thresholds = JSON.parse(readFileSync(new URL('./signal-thresholds.json', import.meta.url), 'utf8'))
  check('drift margin and minimum sample live in the thresholds data',
    thresholds.verdict_drift_margin === 0.15 && thresholds.verdict_min_settled === 10, JSON.stringify(thresholds))
  let n = 0
  // Builds `size` settled decisions at one rubric with `right` of them earned.
  const batch = (choice, rubric, size, right) => Array.from({ length: size }, (_, i) => ({
    decision_id: String(++n).padStart(16, '0'), layer: 'lane', rubric, choice, overridden: false, fallback: false,
    verdict: i < right ? 'earned' : 'wasted', verdict_rubric: rubric,
  }))
  const x = entry({}, 'a'.repeat(32), uuid(800))
  x.report.decisions = [
    ...batch('PAIR', 1, 10, 8), ...batch('PAIR', 2, 10, 6),
    ...batch('SOLO', 1, 10, 8), ...batch('SOLO', 2, 10, 7),
    ...batch('FAST', 1, 10, 8), ...batch('FAST', 2, 9, 1),
    ...batch('DUO', 1, 9, 9), ...batch('DUO', 2, 10, 1),
    ...batch('TRIO', 1, 10, 8), ...batch('TRIO', 3, 10, 1),
  ]
  const { drift } = verdictSignals([x])
  check('only the choice whose right-rate fell by the margin with enough samples drifts',
    drift?.length === 1 && JSON.stringify(drift[0].key) === JSON.stringify(['lane', 'PAIR', 2]), JSON.stringify(drift))
  check('drift carries kind verdict_drift and its own fingerprint',
    drift?.[0]?.kind === 'verdict_drift' && drift[0].id === fp('verdict_drift', 'lane', 'PAIR', 2), JSON.stringify(drift?.[0]))
}

// --- verdict signals reach the scan summary, from accepted reports only ------
{
  const did = (n) => String(n).padStart(16, '0')
  const dec = (n, over = {}) => ({
    decision_id: did(n), layer: 'lane', rubric: 2, choice: 'PAIR', overridden: false, fallback: false, ...over,
  })
  const withDecisions = (n, decisions, settlements) => {
    const r = structuredClone(report)
    r.run.run_id = uuid(900 + n)
    r.decisions = decisions
    if (settlements) r.settlements = settlements
    return r
  }
  const withSections = {
    'a-decided.json': envelope(withDecisions(1, [dec(1, { verdict: 'earned', verdict_rubric: 2 }), dec(2)])),
    'b-settles.json': envelope(withDecisions(2, [], [{ decision_id: did(2), verdict: 'wasted', verdict_rubric: 2 }])),
    'c-open.json': envelope(withDecisions(3, [dec(3)])),
    'd-orphan.json': envelope(withDecisions(4, [], [{ decision_id: did(99), verdict: 'held', verdict_rubric: 2 }])),
  }
  withDir(withSections, (dir) => {
    const s = JSON.parse(run(dir))
    check('summary carries verdict groups, open and unjoined counts',
      s.verdict?.groups?.length === 1 && s.verdict.groups[0].settled === 2 && s.verdict.open === 1 && s.verdict.unjoined === 1,
      JSON.stringify(s.verdict))
    check('summary carries an empty drift list when nothing drifted', JSON.stringify(s.verdict?.drift) === '[]', JSON.stringify(s.verdict))
  })

  // The superseded copy's open decision must not be counted; the stale one is outside the window.
  const older = envelope(withDecisions(5, [dec(5)]), { received_at: '2026-10-06T10:00:00Z' })
  const newer = envelope(withDecisions(5, []), { received_at: '2026-10-07T10:00:00Z' })
  const stale = envelope(withDecisions(6, [dec(6)]), { received_at: '2026-08-01T10:00:00Z' })
  withDir({ 'a-old.json': older, 'b-new.json': newer, 'c-stale.json': stale }, (dir) => {
    const s = JSON.parse(run(dir))
    check('superseded and out-of-window reports contribute no decisions', s.verdict?.open === 0, JSON.stringify(s.verdict))
  })

  withDir({ 'a-plain.json': envelope() }, (dir) => {
    const s = JSON.parse(run(dir))
    check('reports without decisions or settlements pass and add nothing',
      s.accepted === 1 && s.verdict?.groups?.length === 0 && s.verdict.open === 0 && s.verdict.unjoined === 0 &&
      s.verdict.drift.length === 0, JSON.stringify(s))
  })
}

// --- the drift margin is inclusive despite float subtraction ------------------
{
  const did = (n) => String(n).padStart(16, '0')
  const batch = (rubric, base, rightN) => Array.from({ length: 20 }, (_, i) => {
    const r = structuredClone(report)
    r.run.run_id = uuid(base + i)
    r.decisions = [{ decision_id: did(base + i), layer: 'lane', rubric, choice: 'PAIR', overridden: false, fallback: false,
      verdict: i < rightN ? 'earned' : 'wasted', verdict_rubric: rubric }]
    return r
  })
  const files = {}
  ;[...batch(1, 2000, 14), ...batch(2, 3000, 11)].forEach((r, i) => { files[`f${String(i).padStart(3, '0')}.json`] = envelope(r) })
  withDir(files, (dir) => {
    const s = JSON.parse(run(dir))
    check('a drop of exactly the margin (0.70 to 0.55) fires verdict_drift',
      s.verdict?.drift?.length === 1 && s.verdict.drift[0].kind === 'verdict_drift', JSON.stringify(s.verdict?.drift))
  })
}

process.exit(failed)
