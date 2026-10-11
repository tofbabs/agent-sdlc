#!/usr/bin/env node
// Re-validates every stored report against the shipped schema, so the store's
// own checks are never the only line of defence.
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { validate } from '../plugins/agentic-sdlc/scripts/run-report-schema.mjs'

export const REASONS = ['unreadable', 'oversize', 'not_json', 'envelope_invalid', 'report_invalid', 'superseded', 'run_id_conflict']
const THRESHOLDS = JSON.parse(readFileSync(fileURLToPath(new URL('./signal-thresholds.json', import.meta.url)), 'utf8'))
const MAX_BYTES = 20 * 1024
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const ENVELOPE_KEYS = ['envelope', 'source', 'source_first_seen', 'received_at', 'report']
// Anchored and fixed-width so a hostile timestamp cannot carry a payload.
const ISO_SECONDS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// A bare schema-1 report is the local-mode shape: no envelope to check.
const unwrap = (doc, mtime) => {
  if (isObj(doc) && doc.schema === 1 && !('envelope' in doc)) {
    const received_at = mtime.toISOString().slice(0, 19) + 'Z'
    // Local mode has no earlier sighting than its own receipt.
    return { report: doc, source: 'local', received_at, source_first_seen: received_at }
  }
  const ok = isObj(doc) && doc.envelope === 1 &&
    Object.keys(doc).every((k) => ENVELOPE_KEYS.includes(k)) &&
    ENVELOPE_KEYS.every((k) => k in doc) &&
    typeof doc.source === 'string' && /^[0-9a-f]{32}$/.test(doc.source) &&
    typeof doc.source_first_seen === 'string' && ISO_SECONDS.test(doc.source_first_seen) &&
    typeof doc.received_at === 'string' && ISO_SECONDS.test(doc.received_at) &&
    isObj(doc.report)
  return ok ? { report: doc.report, source: doc.source, source_first_seen: doc.source_first_seen, received_at: doc.received_at } : null
}

const classify = (path) => {
  let size, mtime
  try { ({ size, mtime } = statSync(path)) } catch { return { reason: 'unreadable' } }
  // Size is judged before reading so a hostile file is never loaded.
  if (size > MAX_BYTES) return { reason: 'oversize' }
  let text
  try { text = readFileSync(path, 'utf8') } catch { return { reason: 'unreadable' } }
  let doc
  try { doc = JSON.parse(text) } catch { return { reason: 'not_json' } }
  const wrapped = unwrap(doc, mtime)
  if (!wrapped) return { reason: 'envelope_invalid' }
  if (validate(wrapped.report).length > 0) return { reason: 'report_invalid' }
  return wrapped
}

// A run's mode is only meaningful when every story agrees; otherwise it is the
// structural wildcard, never a guess.
const modeOf = (report) => {
  const modes = new Set((report.build?.stories ?? []).map((s) => s.mode))
  return modes.size === 1 ? [...modes][0] : '*'
}

// One extractor per ADR-0004 kind, returning that report's keys (without the
// kind). New kinds plug in here and nothing else changes.
const EXTRACTORS = {
  finding: (r) => (r.review?.findings ?? []).map((f) =>
    [r.run.command, r.run.lane, modeOf(r), f.category, f.severity]),
  // Map values are counts; one report is one occurrence, so only the keys matter.
  arch_handoff: (r) => Object.keys(r.plan?.arch_handoffs ?? {}).map((c) =>
    [r.run.command, r.run.lane, modeOf(r), c]),
  arch_block: (r) => Object.keys(r.build?.arch_blocks ?? {}).map((c) =>
    [r.run.command, r.run.lane, modeOf(r), c]),
  outcome: (r) => ['blocked', 'aborted'].includes(r.run.outcome)
    ? [[r.run.command, r.run.lane, modeOf(r), r.run.outcome]] : [],
  // by_risk is an independent tally with no joint cell, so severity is the
  // structural wildcard rather than a guessed pairing.
  debt: (r) => Object.entries(r.debt?.by_category ?? {}).filter(([, n]) => n > 0).map(([c]) =>
    [r.run.command, r.run.lane, modeOf(r), c, '*']),
  // Degradation is a property of the pipeline, not of the build mode.
  degraded: (r) => (r.degraded ?? []).map((t) => [r.run.command, r.run.lane, t]),
}

const fingerprint = (kind, key) =>
  'sig-' + createHash('sha256').update(JSON.stringify([kind, ...key])).digest('hex').slice(0, 12)

const byRunId = (members) =>
  [...members].sort((a, b) => (a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0))

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// A metric a report lacks yields undefined and is skipped, never read as zero.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
export const METRICS = {
  boot_tokens_mean: (r) => num(r.cost?.derived?.boot_tokens_mean),
  billed_input_per_story: (r) => {
    const n = (r.build?.stories ?? []).length
    const b = num(r.cost?.totals?.billed_input_equivalent)
    return n > 0 && b !== undefined ? b / n : undefined
  },
  // Only pair stories alternate; a SOLO run has no meaningful count.
  alternations_per_story: (r) => {
    const st = r.build?.stories ?? []
    return st.length > 0 && st.every((s) => s.mode === 'PAIR')
      ? st.reduce((a, s) => a + s.alternations, 0) / st.length : undefined
  },
  revise_rounds: (r) => num(r.build?.revise_rounds),
  review_rounds: (r) => num(r.review?.rounds),
}

// The single seam for the baseline: later weighting replaces only this.
const baselineOf = (entries, command, metric) => {
  const vs = entries.map((e) => e.report).filter((r) => r.run.command === command)
    .map(METRICS[metric]).filter((v) => v !== undefined)
  return vs.length ? median(vs) : undefined
}

// Too thin a population makes any median noise, so outliers are not judged at all.
const hasBaseline = (entries) =>
  entries.length >= THRESHOLDS.baseline_min_reports &&
  new Set(entries.map((e) => e.source)).size >= THRESHOLDS.baseline_min_sources

export const discardsOf = (entries) => ({ no_baseline: hasBaseline(entries) ? 0 : entries.length })

function outlierGroups(entries, { now, firstSeen } = {}) {
  const groups = new Map()
  // Fresh tokens are free to mint, so they must not move the median or satisfy the population check.
  const minAge = THRESHOLDS.cost.min_source_age_days * 24 * 60 * 60 * 1000
  const base = !now || !firstSeen ? entries : entries.filter((e) =>
    !firstSeen.has(e.source) || now.getTime() - Date.parse(firstSeen.get(e.source)) >= minAge)
  if (!hasBaseline(base)) return []
  for (const { report, source } of entries) {
    for (const metric of Object.keys(METRICS)) {
      const value = METRICS[metric](report)
      const baseMedian = baselineOf(base, report.run.command, metric)
      if (value === undefined || !(baseMedian > 0) || value < THRESHOLDS.outlier_factor * baseMedian) continue
      const key = [report.run.command, report.run.lane, modeOf(report), metric]
      const id = fingerprint('outlier', key)
      if (!groups.has(id)) groups.set(id, { kind: 'outlier', key, id, members: [], values: [], base: baseMedian })
      const g = groups.get(id)
      g.members.push({ run_id: report.run.run_id, source })
      g.values.push(value)
    }
  }
  return [...groups.values()].map(({ values, base, ...g }) => ({
    ...g,
    baseline: base,
    members: byRunId(g.members),
    ratio: median(values) / base,
    runs: g.members.length,
    repos: new Set(g.members.map((m) => m.source)).size,
  }))
}

export function groupReports(entries, weighting) {
  const groups = new Map()
  // A fixed visit order keeps first-seen dedupe from depending on input order.
  const ordered = [...entries].sort((a, b) =>
    (a.report.run.run_id + a.source).localeCompare(b.report.run.run_id + b.source))
  for (const { report, source } of ordered) {
    for (const [kind, extract] of Object.entries(EXTRACTORS)) {
      for (const key of extract(report)) {
        const id = fingerprint(kind, key)
        if (!groups.has(id)) groups.set(id, { kind, key, id, members: [], ...(kind === 'debt' && { debt_rows: 0 }) })
        const g = groups.get(id)
        // One report counts once per group, however many times it repeats the signature.
        if (!g.members.some((m) => m.run_id === report.run.run_id)) {
          g.members.push({ run_id: report.run.run_id, source })
          if (kind === 'debt') g.debt_rows += report.debt.by_category[key[3]]
        }
      }
    }
  }
  return [...groups.values()].map((g) => ({
    ...g,
    members: byRunId(g.members),
    runs: g.members.length,
    repos: new Set(g.members.map((m) => m.source)).size,
  })).concat(outlierGroups(entries, weighting)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// Capping per source keeps one noisy repo from manufacturing a cross-repo signal.
// A brand-new source cannot be told apart from a flood, so it weighs nothing until it ages in.
export function evaluateGroup(group, { now, firstSeen } = {}) {
  const rules = group.kind === 'outlier' ? THRESHOLDS.cost : THRESHOLDS.quality
  const minAge = rules.min_source_age_days * 24 * 60 * 60 * 1000
  const mature = (s) => !now || !firstSeen?.has(s) || now.getTime() - Date.parse(firstSeen.get(s)) >= minAge
  const perSource = new Map()
  for (const m of group.members) {
    if (mature(m.source)) perSource.set(m.source, (perSource.get(m.source) ?? 0) + 1)
  }
  const runs = [...perSource.values()].reduce((a, n) => a + Math.min(n, rules.cap), 0)
  const repos = perSource.size
  const reason = repos < rules.min_sources ? 'min_sources' : runs < rules.min_runs ? 'min_runs' : undefined
  return { ...group, runs, repos, reason }
}

export function evaluate(entries, { now = new Date() } = {}) {
  const qualified = []
  const discards = []
  const firstSeen = new Map()
  for (const e of entries) {
    const t = e.source_first_seen
    if (t && (!firstSeen.has(e.source) || t < firstSeen.get(e.source))) firstSeen.set(e.source, t)
  }
  for (const g of groupReports(entries, { now, firstSeen })) {
    // Ignored before thresholds so a known-noisy group never reads as a threshold miss.
    if ((THRESHOLDS.ignore ?? []).includes(`${g.kind}:${g.key.at(-1)}`)) {
      discards.push({ id: g.id, kind: g.kind, key: g.key, reason: 'ignored' })
      continue
    }
    const { reason, ...evaluated } = evaluateGroup(g, { now, firstSeen })
    if (reason) discards.push({ id: g.id, kind: g.kind, key: g.key, reason })
    else qualified.push(evaluated)
  }
  return { qualified, discards }
}

// A settlement arrives in a later report than its decision, so the join spans all entries.
const RIGHT = new Set(['earned', 'held', 'needed', 'better'])

export function verdictSignals(entries) {
  const settled = new Map()
  for (const { report } of entries) {
    for (const s of report.settlements ?? []) settled.set(s.decision_id, s.verdict)
  }
  const groups = new Map()
  const decided = new Set()
  let open = 0
  for (const { report } of entries) {
    for (const d of report.decisions ?? []) {
      decided.add(d.decision_id)
      const verdict = d.verdict ?? settled.get(d.decision_id)
      if (verdict === undefined) { open++; continue }
      const key = [d.layer, d.choice, d.rubric]
      const id = fingerprint('verdict', key)
      if (!groups.has(id)) groups.set(id, { kind: 'verdict', key, id, settled: 0, counts: {} })
      const g = groups.get(id)
      g.settled++
      g.counts[verdict] = (g.counts[verdict] ?? 0) + 1
    }
  }
  let unjoined = 0
  for (const id of settled.keys()) if (!decided.has(id)) unjoined++
  for (const g of groups.values()) {
    const right = Object.entries(g.counts).reduce((n, [v, c]) => n + (RIGHT.has(v) ? c : 0), 0)
    g.right_rate = right / g.settled
  }
  const bySlot = new Map([...groups.values()].map((g) => [JSON.stringify(g.key), g]))
  const drift = []
  for (const g of groups.values()) {
    const [layer, choice, rubric] = g.key
    const prev = bySlot.get(JSON.stringify([layer, choice, rubric - 1]))
    if (!prev || g.settled < THRESHOLDS.verdict_min_settled || prev.settled < THRESHOLDS.verdict_min_settled) continue
    // Binary floats put a drop of exactly the margin (0.70 to 0.55) a hair under it; the epsilon keeps the boundary inclusive.
    if (prev.right_rate - g.right_rate >= THRESHOLDS.verdict_drift_margin - 1e-9) {
      drift.push({ kind: 'verdict_drift', key: g.key, id: fingerprint('verdict_drift', g.key) })
    }
  }
  return {
    groups: [...groups.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    drift: drift.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    open,
    unjoined,
  }
}

export function scan(dir, { now = new Date() } = {}) {
  const cutoff = now.getTime() - WINDOW_MS
  let skipped = 0
  const names = readdirSync(dir).sort()
  const rejected = Object.fromEntries(REASONS.map((r) => [r, 0]))
  // Dedupe only sees valid reports, or a poisoned copy could evict a good one.
  const byRun = new Map()
  for (const name of names) {
    const res = classify(join(dir, name))
    if (res.reason) { rejected[res.reason]++; continue }
    // Windowing precedes grouping so a stale copy can neither supersede nor be counted superseded.
    if (Date.parse(res.received_at) < cutoff) { skipped++; continue }
    // Local-mode reports have no source to disagree with, so they dedupe among themselves.
    const id = (res.source === 'local' ? 'local:' : 'remote:') + res.report.run.run_id
    if (!byRun.has(id)) byRun.set(id, [])
    byRun.get(id).push({ name, ...res })
  }
  let accepted = 0
  const entries = []
  const kept = []
  for (const copies of byRun.values()) {
    if (new Set(copies.map((c) => c.source)).size > 1) {
      rejected.run_id_conflict += copies.length
      continue
    }
    accepted++
    const { name, ...entry } = copies[0]
    entries.push(entry)
    rejected.superseded += copies.length - 1
    // The latest copy wins, with name as the tiebreak, so the choice never depends on directory order.
    kept.push(copies.reduce((a, b) => (b.received_at + b.name > a.received_at + a.name ? b : a)))
  }
  return { files: names.length, accepted, rejected, skipped_window: skipped, entries, verdict: verdictSignals(kept) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  // Last occurrence wins so a caller can override an earlier flag.
  const flag = (n) => { const i = args.lastIndexOf(n); return i < 0 ? undefined : args[i + 1] }
  const source = flag('--source') ?? ''
  const nowArg = flag('--now')
  const now = nowArg === undefined ? new Date() : new Date(nowArg)
  if (Number.isNaN(now.getTime())) {
    console.error('signal-scan: --now must be an ISO timestamp')
    process.exit(2)
  }
  if (!source.startsWith('dir:')) {
    console.error('usage: signal-scan.mjs --source dir:<path> [--now <iso>]')
    process.exit(2)
  }
  const { entries, ...stats } = scan(source.slice(4), { now })
  console.log(JSON.stringify(stats))
}
