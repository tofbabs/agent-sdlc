#!/usr/bin/env node
//
// outcomes.mjs — appends what happened to the decision that caused it. Build
// and review runs call `event`; the run start calls `sweep` for what only GitHub
// knows (merge, post-merge fix, revert); `account` is the check that every
// decision is closed, still inside its window, or orphaned with a reason.
// Verdicts themselves are `mode-select.mjs verdicts`, next to the scoring rules;
// `settle` is the run-start pair of the two.
//
// Telemetry never fails a build: every error path here exits 0 with a reason.
//
// Zero dependencies, Node 22 (the repo floor).

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { OUTCOME_MEASURES, CLOSED } from './run-report-categories.mjs'
import { readAllDecisions, appendEvent } from './decisions.mjs'
import { evaluateDecision, resolveRunIdFrom, verdicts } from './mode-select.mjs'

const GH_TIMEOUT_MS = 15000
const DAY_MS = 86_400_000
const WINDOW_DAYS = JSON.parse(
  readFileSync(new URL('./mode-select-rubric.json', import.meta.url), 'utf8'),
).outcome_window_days

// Where an event lands. A correction supersedes what it corrected, and what
// happens after it belongs to the correction's own record (ARCH-2 layer
// stacking); an override stands in for the selector's record it replaced.
// A subject re-run in a later run is a new decision, so the latest run wins
// unless the caller names the run.
export function activeDecision(records, subject, run_id) {
  const mine = records.filter((r) => r.subject === subject)
  const runs = [...new Set(mine.map((r) => r.run_id))]
  const latest = (id) => Math.max(...mine.filter((r) => r.run_id === id).map((r) => Date.parse(r.created_at)))
  const chosen = runs.includes(run_id) ? run_id : runs.sort((a, b) => latest(b) - latest(a))[0]
  const inRun = mine.filter((r) => r.run_id === chosen)
  const corrections = inRun.filter((r) => r.layer === 'correction').sort((a, b) => b.seq - a.seq)
  const target =
    corrections[0] ?? inRun.find((r) => r.layer === 'override') ?? inRun.find((r) => r.layer !== 'correction')
  return target?.state === 'open' ? target : null
}

function parseFlags(args) {
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from-session') flags['from-session'] = true
    else if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[++i]
  }
  return flags
}

function nowFrom(flags) {
  const now = flags.now === undefined ? Date.now() : Date.parse(flags.now)
  if (!Number.isFinite(now)) throw new Error('outcomes.mjs: --now must be an ISO timestamp')
  return now
}

const commonDir = (cwd) =>
  resolve(cwd, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim())

// Builds already tally blocks and gate failures (observe) and mirror the pair
// session (alternation, rejections); reading those beats a second recorder.
function sessionMeasures(cwd, run_id, subject) {
  const base = join(commonDir(cwd), 'agentic-sdlc')
  const out = {}
  const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null)
  const observed = read(join(base, 'observe', `${run_id ?? 'norun'}-${subject}.json`))
  if (observed) {
    out.blocks = observed.blocks ?? 0
    out.gate_failures = Object.values(observed.gate_failures ?? {}).reduce((a, b) => a + b, 0)
  }
  const session = read(join(base, 'pair', subject, 'session.json'))
  if (session) {
    out.alternations = session.alternation ?? 0
    out.rejections = session.rejections ?? 0
  }
  return out
}

function event(flags) {
  const cwd = resolve(flags.cwd ?? process.cwd())
  const { subject, event: name } = flags
  if (!CLOSED.outcome_event.includes(name)) {
    throw new Error(`outcomes.mjs: event "${name}" is not one of ${CLOSED.outcome_event.join('|')}`)
  }
  const run_id = resolveRunIdFrom(flags, cwd)
  const measures = flags['from-session'] ? sessionMeasures(cwd, run_id, subject) : {}
  for (const key of OUTCOME_MEASURES) {
    const raw = flags[key.replaceAll('_', '-')]
    if (raw === undefined) continue
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0) throw new Error(`outcomes.mjs: --${key.replaceAll('_', '-')} must be a non-negative integer`)
    measures[key] = n
  }
  const records = readAllDecisions({ cwd })
  const target = activeDecision(records, subject, run_id)
  if (!target) return { appended: false, reason: 'no_open_decision' }
  const ev = { event: name, at: new Date(nowFrom(flags)).toISOString(), run_id, ...measures }
  if (flags.ref !== undefined) ev.ref = flags.ref
  const { appended, record } = appendEvent(target.decision_id, ev, { cwd })
  return { appended, decision_id: record.decision_id }
}

// ---- sweep ---------------------------------------------------------------

function gh(cwd, args) {
  const r = spawnSync(process.env.OUTCOMES_GH || 'gh', args, {
    cwd,
    encoding: 'utf8',
    timeout: GH_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (r.error || r.status !== 0) return null
  try {
    const data = JSON.parse(r.stdout)
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

const TAG_RE = /\[((?:STORY|EPIC)-\d[\w-]*)\]/g
const tagsOf = (...texts) => new Set(texts.flatMap((t) => [...(t ?? '').matchAll(TAG_RE)].map((m) => m[1])))

// A story is attributed by its own tag or its epic's: stories land on the epic
// branch, so the PR that reaches main usually names only the epic.
function refsFor(record) {
  const refs = new Set([record.subject])
  const m = /^STORY-(\d+)-\d+$/.exec(record.subject)
  if (m) refs.add(`EPIC-${m[1]}`)
  return refs
}

function classify(subject) {
  if (/^revert\b/i.test(subject)) return 'post_merge_revert'
  if (/^fix(\([^)]*\))?!?:/i.test(subject)) return 'post_merge_fix'
  return null
}

const overlaps = (set, refs) => [...set].some((t) => refs.has(t))

function sweep(flags) {
  const cwd = resolve(flags.cwd ?? process.cwd())
  const now = nowFrom(flags)
  const records = readAllDecisions({ cwd })
  const subjects = [...new Set(records.filter((r) => r.state === 'open').map((r) => r.subject))]
  const targets = subjects.map((s) => activeDecision(records, s)).filter(Boolean)
  if (targets.length === 0) return { swept: true, appended: [] }

  const prs = gh(cwd, [
    'pr', 'list', '--state', 'all', '--limit', '200',
    '--json', 'number,title,body,state,createdAt,mergedAt,closedAt,mergeCommit',
  ])
  if (prs === null) return { swept: false, reason: 'gh_unavailable' }

  // Stamped on every event, as `event` does: the report exports only the
  // events its own run appended, so an unstamped sweep event reaches no report.
  const run_id = resolveRunIdFrom(flags, cwd)
  const appended = []
  const add = (record, ev) => {
    const r = appendEvent(record.decision_id, { ...ev, ...(run_id !== null && { run_id }) }, { cwd })
    if (r.appended) appended.push({ decision_id: record.decision_id, event: ev.event })
    return r.record
  }

  const anchors = new Map()
  const prTags = (pr) => tagsOf(pr.title, pr.body)
  for (const target of targets) {
    const refs = refsFor(target)
    // A PR that merged or closed before this decision existed delivered an
    // earlier run's attempt at the same story; joining it would anchor the
    // window on a date that predates the decision.
    const decidedAt = Date.parse(target.created_at)
    const mine = prs.filter(
      (pr) => overlaps(prTags(pr), refs) && !(Date.parse(pr.mergedAt ?? pr.closedAt) < decidedAt),
    )
    // The PR that delivered the work is not a fix to it: a fix PR naming the
    // story is a candidate only when nothing else does. Then a PR naming the
    // story itself outranks one naming only its epic.
    const rank = (pr) => (classify(pr.title) ? 2 : 0) + (prTags(pr).has(target.subject) ? 0 : 1)
    const merged = mine.filter((pr) => pr.state === 'MERGED').sort((a, b) => rank(a) - rank(b) || Date.parse(a.mergedAt) - Date.parse(b.mergedAt))[0]
    let record = target
    if (merged) {
      record = add(target, {
        event: 'merged',
        at: merged.mergedAt,
        days_to_merge: Math.max(0, Math.floor((Date.parse(merged.mergedAt) - Date.parse(merged.createdAt)) / DAY_MS)),
        ref: `pr:${merged.number}`,
      })
      anchors.set(target.decision_id, { record, pr: merged, at: Date.parse(merged.mergedAt) })
    } else if (mine.length > 0 && mine.every((pr) => pr.state === 'CLOSED')) {
      add(target, { event: 'abandoned', at: mine[0].closedAt, ref: `pr:${mine[0].number}` })
    } else {
      const prior = record.outcome_events.find((e) => e.event === 'merged')
      if (prior) anchors.set(target.decision_id, { record, pr: null, at: Date.parse(prior.at) })
    }
  }
  if (anchors.size === 0) return { swept: true, appended }

  const earliest = Math.min(...[...anchors.values()].map((a) => a.at))
  // A failed read is not an empty one: a verdict settled without the direct
  // fixes and reverts would be final, since a closed record takes no events.
  const commits = gh(cwd, ['api', `repos/{owner}/{repo}/commits?since=${new Date(earliest).toISOString()}&per_page=100`])
  if (commits === null) return { swept: false, reason: 'gh_unavailable', appended }
  const prMergeShas = new Set(prs.map((pr) => pr.mergeCommit?.oid).filter(Boolean))

  const candidates = [
    ...prs
      .filter((pr) => pr.state === 'MERGED')
      .map((pr) => ({ number: pr.number, subject: pr.title, tags: prTags(pr), at: Date.parse(pr.mergedAt), ref: `pr:${pr.number}` })),
    ...commits
      .filter((c) => !prMergeShas.has(c.sha))
      .map((c) => {
        const subject = (c.commit?.message ?? '').split('\n')[0]
        return { subject, tags: tagsOf(subject), at: Date.parse(c.commit?.committer?.date), ref: `sha:${String(c.sha).slice(0, 12)}` }
      }),
  ]
  for (const { record, pr, at } of anchors.values()) {
    const refs = refsFor(record)
    const end = at + WINDOW_DAYS * DAY_MS
    for (const c of candidates) {
      if (c.number !== undefined && c.number === pr?.number) continue
      const kind = classify(c.subject)
      if (!kind || !overlaps(c.tags, refs)) continue
      if (!(c.at > at && c.at <= end && c.at <= now)) continue
      add(record, { event: kind, at: new Date(c.at).toISOString(), ref: c.ref })
    }
  }
  return { swept: true, appended }
}

// ---- accounting ------------------------------------------------------------

function account(flags) {
  const cwd = resolve(flags.cwd ?? process.cwd())
  const now = nowFrom(flags)
  const records = readAllDecisions({ cwd })
  const out = { total: records.length, closed: 0, open: 0, orphaned: 0, unaccounted: [] }
  for (const r of records) {
    if (r.state === 'closed' && CLOSED.decision_verdict.includes(r.verdict) && r.verdict_rubric != null) out.closed += 1
    else if (r.state === 'orphaned' && typeof r.orphan_reason === 'string' && r.orphan_reason !== '') out.orphaned += 1
    // Past its window and still open means the verdict pass never ran for it.
    else if (r.state === 'open' && evaluateDecision(r, records, now).action === 'open') out.open += 1
    else out.unaccounted.push(r.decision_id)
  }
  return out
}

function runCli(argv) {
  const [command, ...rest] = argv
  const flags = parseFlags(rest)
  if (command === 'event' && flags.subject !== undefined && flags.event !== undefined) {
    try {
      return event(flags)
    } catch (err) {
      if (err.message.startsWith('outcomes.mjs:')) throw err
      return { appended: false, reason: 'store_unavailable' }
    }
  }
  if (command === 'sweep') {
    try {
      return sweep(flags)
    } catch {
      return { swept: false, reason: 'sweep_failed' }
    }
  }
  // Verdicts wait for a successful sweep: a record closed without the
  // fixes and reverts the sweep would have found can never take them later.
  if (command === 'settle') {
    let swept
    try {
      swept = sweep(flags)
    } catch {
      swept = { swept: false, reason: 'sweep_failed' }
    }
    if (!swept.swept) return { ...swept, settled: false }
    try {
      return { ...swept, settled: true, verdicts: verdicts(flags) }
    } catch {
      return { ...swept, settled: false, reason: 'store_unavailable' }
    }
  }
  if (command === 'account') {
    const result = account(flags)
    if (result.unaccounted.length > 0) process.exitCode = 1
    return result
  }
  throw new Error(
    'usage: outcomes.mjs event --subject <ID> --event <token> [--from-session] [--tokens N --wall-s N --alternations N --rejections N --gate-failures N --blocks N --findings N --revise-rounds N] [--run-id <uuid>] [--ref <key>] [--now <iso>] | ' +
      'sweep [--cwd <dir>] [--now <iso>] [--run-id <uuid>] | settle [--cwd <dir>] [--now <iso>] [--run-id <uuid>] | account [--cwd <dir>] [--now <iso>]',
  )
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
})()
if (isMain) {
  process.stdout.write(`${JSON.stringify(runCli(process.argv.slice(2)), null, 2)}\n`)
}
