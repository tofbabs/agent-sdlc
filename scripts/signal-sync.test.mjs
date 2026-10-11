import { syncIssues, account, summaryLine, discardsJson, renderDiscardLog, syncDiscardLog, runSync, newSinceLastRun } from './signal-sync.mjs'
import { evaluate } from './signal-scan.mjs'
import { renderIssue } from './signal-render.mjs'

let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.error(`  ✗ ${name} ${detail}`); failed = 1 }
}

// The stub holds the issue list in memory and records every call, so a test can
// assert both what was written and what the code should never have asked for.
const stubGh = (issues = []) => {
  const calls = []
  return {
    calls,
    list: () => { calls.push(['list']); return structuredClone(issues) },
    create: (i) => { calls.push(['create', i]); return { number: 900 + calls.length } },
    edit: (n, i) => { calls.push(['edit', n, i]) },
    reopen: (n) => { calls.push(['reopen', n]) },
    comment: (n) => { calls.push(['comment', n]) },
  }
}
// Both lookups are reads; counting the stub's own read as a write made every write assertion off by one.
const writes = (gh) => gh.calls.filter(([c]) => c !== 'list' && c !== 'listDiscards')

const group = (id, runs = 5) => ({ kind: 'finding', key: ['correctness', 'major'], id, runs, repos: 3, members: [] })
const A = group('sig-0123456789ab')
const B = group('sig-ba9876543210')
const body = (g) => renderIssue(g, { entries: [] }).body
const open = (number, g, over = {}) => ({ number, state: 'OPEN', stateReason: null, closedAt: null, body: body(g), ...over })

{
  const gh = stubGh([open(7, A, { body: body(group(A.id, 4)) })])
  const r = await syncIssues([group(A.id, 5)], { entries: [], gh })
  const w = writes(gh)
  check('a known fingerprint updates its issue with the new counts and files nothing',
    w.length === 1 && w[0][0] === 'edit' && w[0][1] === 7 && w[0][2].body === body(group(A.id, 5)), JSON.stringify(w))
  check('result reports the update, not a creation', r.created.length === 0 && r.updated.length === 1, JSON.stringify(r))
}

{
  const gh = stubGh([open(8, A, { state: 'CLOSED', stateReason: 'NOT_PLANNED', closedAt: '2026-10-01T00:00:00Z', body: body(group(A.id, 4)) })])
  await syncIssues([group(A.id, 6)], { entries: [], gh })
  const w = writes(gh)
  check('a closed issue keeps its counts current without being reopened or commented on',
    w.length === 1 && w[0][0] === 'edit' && w[0][1] === 8 && w[0][2].body === body(group(A.id, 6)), JSON.stringify(w))
}

{
  const gh = stubGh([open(7, A)])
  const r = await syncIssues([A], { entries: [], gh })
  check('identical rendered bytes cause no write at all', writes(gh).length === 0 && r.unchanged.length === 1, JSON.stringify(gh.calls))
}

{
  const gh = stubGh([open(7, A)])
  const r = await syncIssues([A, B], { entries: [], gh })
  const w = writes(gh)
  const made = w.find(([c]) => c === 'create')
  check('only a fingerprint with no issue is filed, labelled signal',
    w.length === 1 && made && made[1].body === body(B) && made[1].labels.includes('signal') && r.created.length === 1, JSON.stringify(w))
}

{
  const gh = stubGh([open(7, A), open(9, A)])
  let err
  try { await syncIssues([A, B], { entries: [], gh }) } catch (e) { err = e }
  check('two issues claiming one fingerprint fail the run before anything is written',
    err instanceof Error && writes(gh).length === 0, `${err} ${JSON.stringify(gh.calls)}`)
}

// --- accounting: every accepted report gets exactly one disposition ---------
{
  const entry = (n) => ({ source: 's'.repeat(32), report: { run: { run_id: `r${n}` } } })
  const entries = [1, 2, 3, 4, 5].map(entry)
  const m = (...ns) => ns.map((n) => ({ run_id: `r${n}`, source: 's'.repeat(32) }))
  // r1 sits in both a qualifying and a failing group; r2 only in a failing one; r3 in two failing ones; r4, r5 in none.
  const qualified = [{ id: 'sig-q', members: m(1) }]
  const discards = [
    { id: 'sig-d1', reason: 'min_runs', members: m(1, 2, 3) },
    { id: 'sig-d2', reason: 'min_sources', members: m(3) },
  ]
  const a = account(entries, { qualified, discards }, { not_json: 2, oversize: 1 })
  check('filed beats discarded beats no_signal, each report counted once',
    a.accepted === 5 && a.filed === 1 && a.discarded === 2 && a.no_signal === 2, JSON.stringify(a))
  check('the three dispositions always sum to accepted', a.filed + a.discarded + a.no_signal === a.accepted)
  check('rejected total is carried through', a.rejected === 3, JSON.stringify(a))
  check('summary line states the identity and the rejected count',
    summaryLine(a).startsWith('accepted 5 = filed 1 + discarded 2 + no_signal 2; rejected 3 by reason'), summaryLine(a))
}

{
  const { readFileSync } = await import('node:fs')
  const report = JSON.parse(readFileSync(new URL('./fixtures/signal/report.json', import.meta.url), 'utf8'))
  const e = { envelope: 1, source: 'a'.repeat(32), source_first_seen: '2026-09-01T00:00:00Z', received_at: '2026-10-07T10:00:00Z', report }
  const { discards } = evaluate([e], { now: new Date('2026-10-09T12:00:00Z') })
  const d = discards.find((g) => g.reason)
  check('a discarded group carries its members, runs and sources so the log and accounting can use it',
    d && Array.isArray(d.members) && d.members.length === 1 && d.runs === 1 && d.repos === 1, JSON.stringify(discards[0]))
}

// --- discard log: deterministic file + overwritten issue body ---------------
{
  const d = (id, runs, reason = 'min_runs') => ({ id, kind: 'finding', key: ['correctness', 'major'], reason, runs, repos: 2, members: [{ run_id: `r-${id}` }] })
  const one = d('sig-aaaaaaaaaaaa', 3)
  const two = d('sig-bbbbbbbbbbbb', 4, 'min_sources')
  const acct = { accepted: 9, filed: 2, discarded: 5, no_signal: 2, rejected: 3, rejectedByReason: { not_json: 3 } }
  check('discards.json is byte-identical whatever order the groups arrive in',
    discardsJson([one, two]) === discardsJson([two, one]))
  const parsed = JSON.parse(discardsJson([two, one]))
  check('discards.json lists fingerprint, key, runs, sources and the failed rule',
    parsed.length === 2 && parsed[0].id === one.id && parsed[0].runs === 3 && parsed[0].repos === 2
      && parsed[0].reason === 'min_runs' && Array.isArray(parsed[0].key), discardsJson([one]))
  const log = renderDiscardLog([one, two], acct)
  check('the log issue body has a row per discarded group with its failed rule',
    log.includes(one.id) && log.includes(two.id) && log.includes('min_runs') && log.includes('min_sources'), log)
  check('the log issue body states the no_signal and rejected counts',
    /no_signal\D*2/.test(log) && /rejected\D*3/.test(log), log)
  check('same input renders the same body so an unchanged run causes no edit',
    log === renderDiscardLog([two, one], acct))
}

{
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `sig-${String(i).padStart(12, '0')}`, kind: 'finding',
    key: ['correctness', 'major'], reason: 'min_runs', runs: i + 1, repos: 1, members: [] }))
  const acct = { accepted: 40, filed: 0, discarded: 40, no_signal: 0, rejected: 0, rejectedByReason: {} }
  const log = renderDiscardLog(many, acct, { maxChars: 2000 })
  check('an oversized table stays within the cap', log.length <= 2000, String(log.length))
  check('the lowest run counts are cut first and the omitted count is stated',
    log.includes(many[39].id) && !log.includes(many[0].id) && /\b\d+ rows? omitted/.test(log), log.slice(-400))
  const kept = many.filter((g) => log.includes(g.id)).length
  check('the stated omitted count matches the rows actually cut', log.includes(`${40 - kept} rows omitted`), `kept ${kept}`)
}

// --- discard log issue: one long-lived issue, overwritten, never a signal issue ---
{
  const stubLog = (issues = []) => {
    const gh = stubGh()
    gh.listDiscards = () => { gh.calls.push(['listDiscards']); return structuredClone(issues) }
    return gh
  }
  const d = { id: 'sig-aaaaaaaaaaaa', kind: 'finding', key: ['correctness', 'major'], reason: 'min_runs', runs: 3, repos: 2, members: [] }
  const acct = { accepted: 4, filed: 0, discarded: 1, no_signal: 3, rejected: 0, rejectedByReason: {} }
  const want = renderDiscardLog([d], acct)
  const logIssue = (over = {}) => ({ number: 40, state: 'OPEN', stateReason: null, closedAt: null, body: want, ...over })

  {
    const gh = stubLog([])
    const r = await syncDiscardLog([d], acct, { gh })
    const made = writes(gh).find(([c]) => c === 'create')
    check('the first run files the discard log labelled signal-discards and not signal',
      writes(gh).length === 1 && made && made[1].body === want && made[1].labels.includes('signal-discards')
        && !made[1].labels.includes('signal') && r.action === 'created', JSON.stringify(gh.calls))
  }
  {
    const gh = stubLog([logIssue()])
    const r = await syncDiscardLog([d], acct, { gh })
    check('an unchanged log body causes no write', writes(gh).length === 0 && r.action === 'unchanged', JSON.stringify(gh.calls))
  }
  {
    const gh = stubLog([logIssue({ body: 'stale' })])
    const r = await syncDiscardLog([d], acct, { gh })
    const w = writes(gh)
    check('a changed log overwrites the same issue body, with no comment or new issue',
      w.length === 1 && w[0][0] === 'edit' && w[0][1] === 40 && w[0][2].body === want && r.action === 'updated', JSON.stringify(w))
  }
  {
    const gh = stubLog([logIssue({ body: 'stale' })])
    await syncDiscardLog([d], acct, { gh })
    check('the log lookup never goes through the signal issue list',
      !gh.calls.some(([c]) => c === 'list'), JSON.stringify(gh.calls))
  }
  {
    const gh = stubLog([logIssue({ body: 'stale' }), logIssue({ number: 41, body: 'stale' })])
    let err
    try { await syncDiscardLog([d], acct, { gh }) } catch (e) { err = e }
    check('two discard log issues fail the run before anything is written',
      err instanceof Error && writes(gh).length === 0, `${err} ${JSON.stringify(gh.calls)}`)
  }
}
// --- the CLI flow end to end: scan, group, sync, log -------------------------
{
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const base = JSON.parse(readFileSync(new URL('./fixtures/signal/report.json', import.meta.url), 'utf8'))
  const NOW = new Date('2026-10-09T12:00:00Z')
  const dir = mkdtempSync(join(tmpdir(), 'signal-sync-'))
  const out = mkdtempSync(join(tmpdir(), 'signal-sync-out-'))
  const write = (s, i, received_at = '2026-10-07T10:00:00Z') => {
    const r = structuredClone(base)
    r.run.run_id = `00000000-0000-4000-8000-${String(s * 100 + i).padStart(12, '0')}`
    r.review.findings = [{ round: 1, category: 'correctness', severity: 'MAJOR' }]
    writeFileSync(join(dir, `r-${s}-${i}.json`), JSON.stringify({ envelope: 1, source: String(s).padStart(32, 'a'),
      source_first_seen: '2026-09-01T00:00:00Z', received_at, report: r }))
  }
  for (let s = 1; s <= 4; s++) for (let i = 0; i < 3; i++) write(s, i)
  // A lone source's finding fails min_sources and so lands in the discard log.
  const lone = structuredClone(base)
  lone.run.run_id = '00000000-0000-4000-8000-000000009999'
  lone.review.findings = [{ round: 1, category: 'security', severity: 'MINOR' }]
  writeFileSync(join(dir, 'lone.json'), JSON.stringify({ envelope: 1, source: 'f'.repeat(32),
    source_first_seen: '2026-09-01T00:00:00Z', received_at: '2026-10-07T10:00:00Z', report: lone }))

  // Stateful stub: creates and edits change what the next run lists.
  const issues = []
  const log = []
  const gh = {
    list: () => structuredClone(issues.filter((i) => i.labels.includes('signal'))),
    listDiscards: () => structuredClone(issues.filter((i) => i.labels.includes('signal-discards'))),
    create: ({ title, body, labels }) => { issues.push({ number: 100 + issues.length, state: 'OPEN', stateReason: null, closedAt: null, title, body, labels }); log.push('create'); return { number: 99 + issues.length } },
    edit: (n, { body }) => { issues.find((i) => i.number === n).body = body; log.push('edit') },
  }
  const lines = []
  const go = (extra = {}) => runSync({ dir, now: NOW, out, gh, log: (l) => lines.push(l), ...extra })

  const first = await go()
  const filed = issues.filter((i) => i.labels.includes('signal'))
  check('the first run files one issue per qualifying group and the discard log',
    first.synced.created.length >= 1 && filed.length === first.synced.created.length && first.logged.action === 'created', JSON.stringify(first))
  check('no filed issue is the discard log or the reverse',
    issues.filter((i) => i.labels.includes('signal-discards')).length === 1 &&
    !issues.some((i) => i.labels.includes('signal') && i.labels.includes('signal-discards')))
  const accounting = lines.find((l) => l.startsWith('accepted '))
  check('the summary states the accounting identity',
    /^accepted 13 = filed \d+ \+ discarded \d+ \+ no_signal \d+; rejected 0 by reason/.test(accounting ?? ''), accounting)
  check('every accepted report is filed, discarded or no_signal',
    (() => { const m = /accepted (\d+) = filed (\d+) \+ discarded (\d+) \+ no_signal (\d+)/.exec(accounting); return +m[1] === +m[2] + +m[3] + +m[4] })())
  const disk1 = readFileSync(join(out, 'discards.json'), 'utf8')
  check('the sub-threshold group is in discards.json with its failed rule',
    JSON.parse(disk1).some((d) => d.reason === 'min_sources'), disk1)

  log.length = 0
  lines.length = 0
  const second = await go()
  check('a second run over the same fixtures files 0 issues and edits 0 bodies',
    second.synced.created.length === 0 && second.synced.updated.length === 0 && second.logged.action === 'unchanged' && log.length === 0,
    JSON.stringify({ second, log }))
  check('discards.json is byte-identical across runs', readFileSync(join(out, 'discards.json'), 'utf8') === disk1)
  check('after a run, nothing is new since the issues were written', lines.includes('new since last run: 0'), lines.join('\n'))

  write(1, 7, '2026-10-08T08:00:00Z')
  lines.length = 0
  await go()
  check('a report newer than the issues reflect is counted as new', lines.includes('new since last run: 1'), lines.join('\n'))

  // Closing an issue must not stop its counts being kept or cause a duplicate.
  issues.forEach((i) => { if (i.labels.includes('signal')) Object.assign(i, { state: 'CLOSED', stateReason: 'COMPLETED' }) })
  log.length = 0
  await go()
  check('a closed issue is updated in place, never reopened or duplicated',
    !log.includes('create') && issues.every((i) => i.labels.includes('signal-discards') || i.state === 'CLOSED'), log.join())

  const bad = join(out, 'bad-merges.json')
  writeFileSync(bad, '{not json')
  lines.length = 0
  const rej = await go({ mergesFile: bad })
  check('a rejected merges file does not stop the run and the summary records the reason',
    rej.acct.accepted > 0 && lines.includes('merge_rejected:unknown_field'), lines.join('\n'))
  lines.length = 0
  await go({ mergesFile: join(out, 'absent.json') })
  check('an absent merges file is skipped without a rejection note', !lines.some((l) => l.startsWith('merge_rejected')))

  rmSync(dir, { recursive: true, force: true })
  rmSync(out, { recursive: true, force: true })
}

{
  const e = (t) => ({ received_at: t })
  const withNewest = (t) => ({ body: `<!-- signal: sig-aaaaaaaaaaaa -->\n<!-- signal-newest: ${t} -->\n` })
  check('with no signal-newest in any issue every accepted report is new', newSinceLastRun([e('2026-10-01T00:00:00Z')], [{ body: 'x' }]) === 1)
  check('only reports strictly newer than the newest reflected one count',
    newSinceLastRun([e('2026-10-01T00:00:00Z'), e('2026-10-02T00:00:00Z'), e('2026-10-03T00:00:00Z')],
      [withNewest('2026-10-01T00:00:00Z'), withNewest('2026-10-02T00:00:00Z')]) === 1)
}

// --- outcome: cut-over version from the closed issue -------------------------
{
  const sync = await import('./signal-sync.mjs')
  const cutover = sync.cutoverVersion
  const tags = [
    { tag: 'v0.2.7', date: '2026-10-09T09:00:00Z' },
    { tag: 'v0.2.5', date: '2026-10-01T09:00:00Z' },
    { tag: 'v0.2.6', date: '2026-10-05T09:00:00Z' },
  ]
  const closed = (closedAt, stateReason = 'COMPLETED') => ({ state: 'CLOSED', stateReason, closedAt })
  check('cutoverVersion is exported', typeof cutover === 'function')
  if (typeof cutover === 'function') {
    check('the cut-over is the first release at or after the close, as a bare version, whatever order tags arrive in',
      cutover(closed('2026-10-04T00:00:00Z'), tags) === '0.2.6')
    check('a release dated exactly at the close counts as the cut-over',
      cutover(closed('2026-10-05T09:00:00Z'), tags) === '0.2.6')
    check('no release yet after the close means no cut-over', cutover(closed('2026-10-10T00:00:00Z'), tags) === null)
    check('closed as not planned makes no claim', cutover(closed('2026-10-04T00:00:00Z', 'NOT_PLANNED'), tags) === null)
    check('an open issue makes no claim', cutover({ state: 'OPEN', stateReason: null, closedAt: null }, tags) === null)
  }
}

// --- outcome: group rate before and after the cut-over -----------------------
{
  const { shipRates } = await import('./signal-sync.mjs')
  check('shipRates is exported', typeof shipRates === 'function')
  if (typeof shipRates === 'function') {
    const src = (n) => String(n).repeat(32)
    let seq = 0
    const mk = (n, version) => ({ source: src(n), received_at: '2026-10-08T00:00:00Z',
      report: { run: { run_id: `run-${++seq}`, plugin_version: version } } })
    const cohort = (version, perSource) => [1, 2, 3, 4].flatMap((n) => Array.from({ length: perSource }, () => mk(n, version)))
    const before = cohort('0.2.5', 4)
    const after = [...cohort('0.2.6', 3), mk(1, '0.2.10')]
    const entries = [...before, ...after]
    const memberOf = (list, n, count) => list.filter((e) => e.source === src(n)).slice(0, count)
      .map((e) => ({ run_id: e.report.run.run_id, source: e.source }))
    // Source 1 repeats three times before; a per-source cap of 2 must keep it from dominating the numerator.
    const g = { kind: 'finding', key: ['correctness', 'major'], id: 'sig-0123456789ab',
      members: [...memberOf(before, 1, 3), ...memberOf(before, 2, 1), ...memberOf(after, 1, 1)] }
    const r = shipRates(g, entries, '0.2.6')
    check('before is the capped group runs over the capped runs of every older release',
      r?.before?.runs === 3 && r.before.weighted === 8 && r.before.rate === 3 / 8, JSON.stringify(r))
    check('after counts the cut-over release itself and compares versions numerically, so 0.2.10 is after 0.2.6',
      r?.after?.runs === 1 && r.after.weighted === 8 && r.after.rate === 1 / 8, JSON.stringify(r))
    check('an after cohort below the class minimum makes no claim',
      shipRates(g, [...before, ...cohort('0.2.6', 1)], '0.2.6') === null)
  }
}

// --- outcome: before-rate frozen into the body, after-rate refreshed ----------
{
  const { withShipClaim } = await import('./signal-sync.mjs')
  check('withShipClaim is exported', typeof withShipClaim === 'function')
  if (typeof withShipClaim === 'function') {
    const base = '<!-- signal: sig-0123456789ab -->\n# finding\n'
    const rates = (b, a) => ({ before: { runs: b[0], weighted: b[1], rate: b[0] / b[1] }, after: { runs: a[0], weighted: a[1], rate: a[0] / a[1] } })
    const first = withShipClaim(base, rates([3, 8], [1, 8]))
    check('the first claim freezes the before counts in a marker', first.includes('<!-- signal-before: 3/8 -->'), first)
    check('the claim shows before and after as aggregate counts', first.includes('before: 3 of 8 runs') && first.includes('after: 1 of 8 runs'), first)
    check('the original body is kept intact', first.startsWith(base), first)
    const later = withShipClaim(first, rates([0, 2], [2, 9]))
    check('a later run keeps the frozen before and refreshes after',
      later.includes('<!-- signal-before: 3/8 -->') && later.includes('before: 3 of 8 runs') && later.includes('after: 2 of 9 runs') && !later.includes('1 of 8'), later)
    check('the claim is replaced, not appended, so repeated runs are stable',
      withShipClaim(later, rates([0, 2], [2, 9])) === later && later.split('signal-before').length === 2)
    check('no rates means the body is untouched', withShipClaim(base, null) === base)
  }
}

// --- outcome: the claim reaches the closed issue through the sync run --------
{
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const base = JSON.parse(readFileSync(new URL('./fixtures/signal/report.json', import.meta.url), 'utf8'))
  const NOW = new Date('2026-10-09T12:00:00Z')
  const dir = mkdtempSync(join(tmpdir(), 'signal-ship-'))
  let seq = 0
  const put = (name, s, version, received_at, finding) => {
    const r = structuredClone(base)
    r.run.run_id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
    r.run.plugin_version = version
    r.review.findings = finding ? [{ round: 1, category: 'correctness', severity: 'MAJOR' }] : []
    writeFileSync(join(dir, `${name}.json`), JSON.stringify({ envelope: 1, source: String(s).repeat(32),
      source_first_seen: '2026-09-01T00:00:00Z', received_at, report: r }))
  }
  for (let s = 1; s <= 4; s++) for (let i = 0; i < 3; i++) put(`old-${s}-${i}`, s, '0.2.5', '2026-10-01T10:00:00Z', true)
  for (let s = 1; s <= 4; s++) for (let i = 0; i < 2; i++) put(`new-${s}-${i}`, s, '0.2.6', '2026-10-08T10:00:00Z', s === 1 && i === 0)

  const issues = []
  const log = []
  const gh = {
    list: () => structuredClone(issues.filter((i) => i.labels.includes('signal'))),
    listDiscards: () => structuredClone(issues.filter((i) => i.labels.includes('signal-discards'))),
    create: ({ title, body, labels }) => { issues.push({ number: 100 + issues.length, state: 'OPEN', stateReason: null, closedAt: null, title, body, labels }); return { number: 99 + issues.length } },
    edit: (n, { body }) => { issues.find((i) => i.number === n).body = body; log.push(`edit ${n}`) },
  }
  const tags = [{ tag: 'v0.2.5', date: '2026-10-01T00:00:00Z' }, { tag: 'v0.2.6', date: '2026-10-06T00:00:00Z' }]
  const go = (extra = {}) => runSync({ dir, now: NOW, gh, log: () => {}, tags, ...extra })

  await go()
  const filed = issues.find((i) => i.labels.includes('signal') && i.body.includes('Kind: `finding`'))
  check('an open issue carries no claim', !filed.body.includes('signal-before'))
  Object.assign(filed, { state: 'CLOSED', stateReason: 'NOT_PLANNED', closedAt: '2026-10-05T00:00:00Z' })
  await go()
  check('closed as not planned makes no claim', !filed.body.includes('signal-before'), filed.body)

  filed.stateReason = 'COMPLETED'
  await go({ tags: [{ tag: 'v0.2.5', date: '2026-10-01T00:00:00Z' }] })
  check('no release after the close makes no claim', !filed.body.includes('signal-before'), filed.body)

  log.length = 0
  await go()
  check('a completed close with a later release shows before and after as aggregates',
    filed.body.includes('before: 8 of 8 runs') && filed.body.includes('after: 1 of 8 runs'), filed.body)
  check('the claim edits the body only and leaves the issue closed', filed.state === 'CLOSED' && log.every((l) => l === `edit ${filed.number}`), log.join())
  check('the claim names no run ids', !/00000000-0000-4000/.test(filed.body))

  log.length = 0
  await go()
  check('rerunning with nothing new edits nothing', log.length === 0, log.join())

  // Once the older reports leave the window the group falls out of the qualified set;
  // the frozen before-rate must still be there and the claim must still be refreshed.
  for (let s = 1; s <= 4; s++) for (let i = 0; i < 3; i++) rmSync(join(dir, `old-${s}-${i}.json`))
  put('new-2-late', 2, '0.2.6', '2026-10-08T11:00:00Z', true)
  await go()
  check('a group that left the qualified set keeps its frozen before and refreshes after',
    filed.body.includes('before: 8 of 8 runs') && filed.body.includes('after: 2 of 8 runs'), filed.body)
}

// --- outcome: release tags are read from a cloned checkout ---------------------
{
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const { readTags } = await import('./signal-sync.mjs')
  const repo = mkdtempSync(join(tmpdir(), 'signal-tags-'))
  const git = (args, date) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args],
    { encoding: 'utf8', env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } })
  git(['init', '-q'], '2026-10-01T00:00:00Z')
  git(['commit', '-q', '--allow-empty', '-m', 'one'], '2026-10-01T00:00:00Z')
  git(['tag', 'v0.2.5'], '2026-10-01T00:00:00Z')
  git(['commit', '-q', '--allow-empty', '-m', 'two'], '2026-10-06T00:00:00Z')
  git(['tag', '-a', 'v0.2.6', '-m', 'rel'], '2026-10-06T00:00:00Z')
  git(['tag', 'not-a-release'], '2026-10-06T00:00:00Z')

  const tags = readTags(repo)
  const byTag = Object.fromEntries(tags.map((t) => [t.tag, t.date]))
  check('lightweight and annotated release tags are listed with their dates',
    Date.parse(byTag['v0.2.5']) === Date.parse('2026-10-01T00:00:00Z') && Date.parse(byTag['v0.2.6']) === Date.parse('2026-10-06T00:00:00Z'), JSON.stringify(tags))
  check('only version tags count as releases', !('not-a-release' in byTag), JSON.stringify(tags))
  const plain = mkdtempSync(join(tmpdir(), 'signal-notrepo-'))
  check('a directory with no repository yields no tags instead of failing', JSON.stringify(readTags(plain)) === '[]')
  rmSync(repo, { recursive: true, force: true }); rmSync(plain, { recursive: true, force: true })
}

process.exit(failed)
