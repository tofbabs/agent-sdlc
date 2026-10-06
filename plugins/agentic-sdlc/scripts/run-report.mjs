#!/usr/bin/env node
//
// run-report.mjs — derive one code-free JSON report per pipeline run, after the fact.
//
// WHY A DERIVATION AND NOT AN EVENT LOG
//
// ADR 0001 (docs/adr/0001-run-report-schema-and-vocabulary.md) fixes the report
// shape; ARCH-4 makes a run "one report, amended by full rebuild". So this script
// never appends: it reads artifacts the pipeline already writes (the run marker,
// the backlog file, the newest meter record, pair sessions) and rebuilds the whole
// report. A double-fired hook, a crash or a resume the next day all converge on
// the same file.
//
// WHY THE SCHEMA IS A DATA STRUCTURE
//
// "Code-free" is a schema property, not a redaction pass: no field may accept an
// unbounded string. REPORT_SCHEMA below is declarative so the validator and the
// leak-proofing test walk the very same object — a field cannot be added to one
// and forgotten in the other. Enum values are never listed here; they come from
// run-report-categories.mjs, the only place any of them is written down.
//
// THE RUN MARKER — <project>/.agentic-sdlc/run-state.json
//
// Written by the UserPromptSubmit hook (templates/hooks/run-report.sh), read here.
// It is LOCAL state and may carry paths; nothing in it is copied into the report
// except the fields marked "→ run.*". Shape (all fields required unless noted):
//
//   {
//     "run_id": "<uuid v4>",               → run.run_id; names the report file
//     "command": "plan|build|review",      → run.command
//     "lane": "deliberate|fast",           → run.lane
//     "target": "<raw command argument>",  local only, NEVER in the report
//     "started_at": "<ISO-8601>",          start of THIS session's command
//     "sessions": 1,                       → run.sessions (integer ≥ 1)
//     "wall_clock_s_prior": 0,             seconds accumulated by earlier sessions
//     "arch_snapshot": ["ARCH-1"],         ARCH IDs in the backlog file at run start
//                                          ([] when the file did not exist yet)
//     "debt_snapshot": 0,                  `###` entries under the ledger's
//                                          "Logged by agents" at run start
//                                          (null when there is no ledger)
//     "backlog": "backlog/EPIC-1.md"       resolved backlog file, relative to the
//                                          project or absolute; null if unknown
//   }
//
// run.wall_clock_s: for an OPEN session (session_open true or absent),
// wall_clock_s_prior + (now − started_at) — and producing this report BANKS
// that session, persisting the sum back as wall_clock_s_prior and closing
// session_open to false in the marker, so a later rebuild of the same session
// never adds (now − started_at) again. For a CLOSED session, wall_clock_s_prior
// alone. The SessionEnd hook finalises a run by spawning this report command
// detached, which is why the fold lives here rather than in a separate step. A
// missing, unreadable or incomplete marker puts `run_state` in `degraded` and
// nulls what it fed.
//
// BACKLOG FILE RESOLUTION, in order: --backlog; marker.backlog; an EPIC-<n> /
// FAST-<n> ID in marker.target → backlog/<ID>.md; for a plan run, the backlog
// file whose `- Artifacts:` line names the brief in marker.target (the planner
// claims the ID after the run starts, so the hook cannot know it up front).
//
// PLAN-TIME HANDOFFS: a plan run counts every ARCH handoff in the file; a build
// or review run counts only those in arch_snapshot, because anything newer was
// raised mid-build and belongs to build.arch_blocks. With no marker the command
// is unknown, so every handoff counts (run_state already says why).
//
// COST: the newest meter record (<project>/.agentic-sdlc/meter/*.json) modified
// at or after this session's started_at — an older one belongs to another run.
// Only its schema, totals and derived are embedded: label, by_agent, by_model and
// spawns carry free strings (ADR 0001).
//
// CLI
//   run-report.mjs report --project <dir> [--out <file>] [--backlog <file>]
//                         [--meter <record.json>] [--pr-comments <comments.json>]
//                         [--now <ISO-8601>]
//     Writes <project>/.agentic-sdlc/runs/<run_id>.json (or --out). With no
//     marker there is no run_id to name the file, so it writes nothing and exits
//     0 unless --out is given. Degraded inputs always exit 0; a report that fails
//     its own schema is never written (exit 1, violations on stderr). --now pins
//     the clock for tests.
//   run-report.mjs mark --project <dir> --prompt-file <f> --session <id> [--now <ISO-8601>]
//     The UserPromptSubmit hook's counterpart: the hook does a cheap prefix
//     check in shell and hands the pipeline prompt to this subcommand, which
//     owns the parsing (command / lane / target) and writes the run marker
//     above. The prompt is read from --prompt-file, never argv or stdin — it
//     can carry anything a user typed. A fresh run (no marker yet) gets a new
//     uuid v4 run_id, sessions 1 and a zero prior clock; --now pins started_at
//     for tests.
//   run-report.mjs validate <file>
//
// Zero dependencies, Node 22 (the repo floor).

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { join, dirname, resolve, isAbsolute, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { CLOSED, OPEN, DEGRADED_INPUT, isMember, toCategory } from './run-report-categories.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_JSON = join(HERE, '..', '.claude-plugin', 'plugin.json')
const MARKER = join('.agentic-sdlc', 'run-state.json')
const METER_DIR = join('.agentic-sdlc', 'meter')
const RUNS_DIR = join('.agentic-sdlc', 'runs')

// ------------------------------------------------------------------- schema

// The only three string patterns the whole schema admits (ADR 0001).
export const PATTERNS = Object.freeze({
  uuid_v4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  semver: /^\d+\.\d+\.\d+$/,
  iso_utc_seconds: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
})

// numericRecord keys come from meter.mjs, not a vocabulary, so they are bounded
// by shape instead: short snake_case cannot carry a path, branch or sentence.
const NUMERIC_KEY = /^[a-z][a-z0-9_]{0,63}$/
const NUMERIC_RECORD_MAX_KEYS = 64
const NUMERIC_RECORD_MAX_DEPTH = 4

// Every spec is nullable unless wrapped in required(): ADR 0001's null means
// "input missing, named in degraded", and that applies to every field.
export const T = Object.freeze({
  const: (value) => ({ type: 'const', value }),
  enum: (vocab) => ({ type: 'enum', vocab }),
  number: (opts = {}) => ({ type: 'number', ...opts }),
  pattern: (name) => ({ type: 'pattern', name }),
  object: (fields) => ({ type: 'object', fields }),
  array: (items) => ({ type: 'array', items }),
  countMap: (vocab) => ({ type: 'countMap', vocab }),
  numericRecord: () => ({ type: 'numericRecord' }),
})
const required = (spec) => ({ ...spec, nullable: false })
const count = () => T.number({ int: true, min: 0 })

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v)
  return Object.freeze(o)
}

export const REPORT_SCHEMA = deepFreeze(
  required(
    T.object({
      schema: required(T.const(1)),
      run: required(
        T.object({
          run_id: T.pattern('uuid_v4'),
          plugin_version: T.pattern('semver'),
          command: T.enum('command'),
          lane: T.enum('lane'),
          outcome: T.enum('outcome'),
          ended_at: T.pattern('iso_utc_seconds'),
          wall_clock_s: T.number({ int: true, min: 0 }),
          sessions: T.number({ int: true, min: 1 }),
        }),
      ),
      plan: required(
        T.object({
          epics: count(),
          stories: count(),
          tasks: count(),
          arch_handoffs: T.countMap('arch_category'),
        }),
      ),
      build: required(
        T.object({
          stories: T.array(required(T.object({ mode: required(T.enum('mode')), alternations: count() }))),
          arch_blocks: T.countMap('arch_category'),
          revise_rounds: count(),
          gate_runs: count(),
          gate_failures: count(),
        }),
      ),
      review: required(
        T.object({
          rounds: count(),
          verdict: T.enum('verdict'),
          findings: T.array(
            required(
              T.object({
                round: required(T.number({ int: true, min: 1 })),
                category: required(T.enum('finding_category')),
                severity: required(T.enum('severity')),
              }),
            ),
          ),
        }),
      ),
      debt: required(
        T.object({
          rows_logged: count(),
          by_risk: T.countMap('risk'),
          by_category: T.countMap('debt_category'),
        }),
      ),
      cost: T.object({
        schema: required(T.number({ int: true, min: 1 })),
        totals: required(T.numericRecord()),
        derived: required(T.numericRecord()),
      }),
      degraded: required(T.array(required(T.enum('degraded_input')))),
    }),
  ),
)

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
// Report-supplied keys reach stderr in violation paths; cap them so a stuffed key
// cannot turn the error message into the leak.
const keyLabel = (k) => JSON.stringify(String(k).slice(0, 40))

// Values that are null by the meter's own semantics (e.g. cost_usd_reported) are
// measurements, so a numericRecord's nulls do not demand a degraded entry.
function checkNumericRecord(value, path, out, depth = 0) {
  if (!isPlainObject(value)) return out.push(`${path}: must be an object of numbers`)
  if (depth >= NUMERIC_RECORD_MAX_DEPTH) return out.push(`${path}: nested too deep`)
  const keys = Object.keys(value)
  if (keys.length > NUMERIC_RECORD_MAX_KEYS) out.push(`${path}: more than ${NUMERIC_RECORD_MAX_KEYS} keys`)
  for (const k of keys) {
    const p = `${path}[${keyLabel(k)}]`
    if (!NUMERIC_KEY.test(k)) {
      out.push(`${p}: key is not short snake_case`)
      continue
    }
    const v = value[k]
    if (v === null) continue
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) out.push(`${p}: must be finite`)
    } else if (isPlainObject(v)) {
      checkNumericRecord(v, p, out, depth + 1)
    } else {
      out.push(`${p}: must be a number or null`)
    }
  }
}

function walk(spec, value, path, out, state) {
  if (value === null) {
    if (spec.nullable === false) out.push(`${path}: must not be null`)
    else state.nulls++
    return
  }
  switch (spec.type) {
    case 'const':
      if (value !== spec.value) out.push(`${path}: must be ${JSON.stringify(spec.value)}`)
      return
    case 'enum':
      if (typeof value !== 'string' || !isMember(spec.vocab, value)) out.push(`${path}: not a ${spec.vocab} member`)
      return
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return out.push(`${path}: must be a finite number`)
      if (spec.int && !Number.isInteger(value)) out.push(`${path}: must be an integer`)
      if (spec.min !== undefined && value < spec.min) out.push(`${path}: must be ≥ ${spec.min}`)
      return
    case 'pattern':
      if (typeof value !== 'string' || !PATTERNS[spec.name].test(value)) out.push(`${path}: does not match ${spec.name}`)
      return
    case 'object':
      if (!isPlainObject(value)) return out.push(`${path}: must be an object`)
      for (const k of Object.keys(value)) {
        if (!Object.hasOwn(spec.fields, k)) out.push(`${path}[${keyLabel(k)}]: unknown field`)
      }
      for (const [k, sub] of Object.entries(spec.fields)) {
        if (!Object.hasOwn(value, k)) out.push(`${path}.${k}: missing`)
        else walk(sub, value[k], `${path}.${k}`, out, state)
      }
      return
    case 'array':
      if (!Array.isArray(value)) return out.push(`${path}: must be an array`)
      value.forEach((item, i) => walk(spec.items, item, `${path}[${i}]`, out, state))
      return
    case 'countMap':
      if (!isPlainObject(value)) return out.push(`${path}: must be an object`)
      for (const [k, v] of Object.entries(value)) {
        const p = `${path}[${keyLabel(k)}]`
        if (!isMember(spec.vocab, k)) out.push(`${p}: key is not a ${spec.vocab} member`)
        if (!Number.isInteger(v) || v < 0) out.push(`${p}: must be a non-negative integer`)
      }
      return
    case 'numericRecord':
      checkNumericRecord(value, path, out)
      return
    default:
      out.push(`${path}: schema has unknown type ${JSON.stringify(spec.type)}`)
  }
}

// Returns a list of violations; empty means valid. Beyond shape it enforces the
// no-silent-gaps rule: a null anywhere needs a named input in `degraded`.
export function validate(report) {
  const out = []
  const state = { nulls: 0 }
  walk(REPORT_SCHEMA, report, '$', out, state)
  if (isPlainObject(report) && Array.isArray(report.degraded)) {
    if (new Set(report.degraded).size !== report.degraded.length) out.push('$.degraded: duplicate entries')
    if (state.nulls > 0 && report.degraded.length === 0) out.push('$: null field(s) with nothing named in degraded')
  }
  return out
}

// ---------------------------------------------------------------- context

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

// Which session of which run a marker describes. A detached SessionEnd report
// can outlive its session: by the time it finishes, the next prompt may have
// continued the run in a new session or replaced it outright, and anything it
// writes back must be checked against this first.
const generationOf = (raw) => (isPlainObject(raw) ? JSON.stringify([raw.run_id, raw.session_id, raw.started_at]) : null)

// Rename is atomic on one filesystem, so a concurrent reader of the marker or a
// report sees the old file or the new one, never a torn write.
function writeJsonAtomic(path, value) {
  mkdirSync(dirname(resolve(path)), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(tmp, path)
}

function readMarker(project) {
  const raw = readJson(join(project, MARKER))
  if (!isPlainObject(raw)) return null
  const nonNegative = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  const startedMs = typeof raw.started_at === 'string' ? Date.parse(raw.started_at) : NaN
  const m = {
    run_id: typeof raw.run_id === 'string' && PATTERNS.uuid_v4.test(raw.run_id) ? raw.run_id : null,
    command: isMember('command', raw.command) ? raw.command : null,
    lane: isMember('lane', raw.lane) ? raw.lane : null,
    target: typeof raw.target === 'string' ? raw.target : null,
    started_ms: Number.isFinite(startedMs) ? startedMs : null,
    sessions: Number.isInteger(raw.sessions) && raw.sessions >= 1 ? raw.sessions : null,
    wall_clock_s_prior: nonNegative(raw.wall_clock_s_prior) ? raw.wall_clock_s_prior : null,
    // Absent (older markers, fresh single-session runs) reads as open: there is
    // nothing yet to have closed.
    session_open: raw.session_open === false ? false : true,
    arch_snapshot:
      Array.isArray(raw.arch_snapshot) && raw.arch_snapshot.every((id) => /^ARCH-\d+$/.test(id))
        ? new Set(raw.arch_snapshot)
        : null,
    debt_snapshot: raw.debt_snapshot === null || (Number.isInteger(raw.debt_snapshot) && raw.debt_snapshot >= 0)
      ? raw.debt_snapshot
      : undefined,
    backlog: typeof raw.backlog === 'string' && raw.backlog ? raw.backlog : null,
    generation: generationOf(raw),
  }
  const requiredKeys = ['run_id', 'command', 'lane', 'target', 'started_ms', 'sessions', 'wall_clock_s_prior', 'arch_snapshot']
  m.complete = requiredKeys.every((k) => m[k] !== null) && m.debt_snapshot !== undefined
  return m
}

// Splits markdown into `##`/`###` blocks so a field like `- status:` is read only
// from the block it belongs to, never from prose that happens to mention it.
function blocks(text) {
  const out = []
  let cur = null
  for (const line of text.split('\n')) {
    if (/^#{2,3} /.test(line)) {
      cur = { heading: line, body: [] }
      out.push(cur)
    } else if (cur) {
      cur.body.push(line)
    }
  }
  return out.map((b) => ({ heading: b.heading, body: b.body.join('\n') }))
}

const field = (body, name) => new RegExp(`^-\\s*${name}:\\s*\`?([A-Za-z_]+)`, 'm').exec(body)?.[1] ?? null

export function parseBacklog(text, fileName = '') {
  const kind = /^# (EPIC|FAST)-\d+/m.exec(text)?.[1] ?? /(EPIC|FAST)-\d+\.md$/.exec(fileName)?.[1] ?? null
  if (!kind) return null
  const status = /^- Status:\s*(\w+)/m.exec(text)?.[1] ?? null
  const stories = []
  const arch = new Map()
  let tasks = 0
  for (const b of blocks(text)) {
    const story = /^### (STORY-[\w-]+)/.exec(b.heading)
    if (story) stories.push({ id: story[1], status: field(b.body, 'status') })
    if (/^### T\d+-\d+\b/.test(b.heading)) tasks++
    const a = /^### (ARCH-\d+)\b/.exec(b.heading)
    if (a) arch.set(a[1], { category: field(b.body, 'category'), status: field(b.body, 'status') })
  }
  // A handoff listed only in the table still counts; its category is untagged.
  for (const row of text.matchAll(/^\|\s*(ARCH-\d+)\s*\|(.*)$/gm)) {
    if (arch.has(row[1])) continue
    const cells = row[2].split('|').map((c) => c.trim()).filter(Boolean)
    arch.set(row[1], { category: null, status: cells.at(-1) ?? null })
  }
  return { kind, status, stories, tasks, arch }
}

function resolveBacklogPath(project, marker, override) {
  const abs = (p) => (isAbsolute(p) ? p : resolve(project, p))
  if (override) return abs(override)
  if (marker?.backlog) return abs(marker.backlog)
  const target = marker?.target ?? ''
  const id = /\b((?:EPIC|FAST)-\d+)\b/.exec(target)?.[1]
  if (id) return join(project, 'backlog', `${id}.md`)
  if (marker?.command !== 'plan') return null
  const brief = target.trim().split(/\s+/)[0]?.replace(/^\.\//, '')
  const dir = join(project, 'backlog')
  if (!brief || !existsSync(dir)) return null
  let best = null
  for (const name of readdirSync(dir)) {
    if (!/^(EPIC|FAST)-\d+\.md$/.test(name)) continue
    const p = join(dir, name)
    let text
    try {
      text = readFileSync(p, 'utf8')
    } catch {
      continue
    }
    const artifacts = /^- Artifacts:\s*(.*)$/m.exec(text)?.[1] ?? ''
    if (!artifacts.split(/[\s,]+/).includes(brief)) continue
    const mtime = statSync(p).mtimeMs
    if (!best || mtime > best.mtime) best = { p, mtime }
  }
  return best?.p ?? null
}

// pair-log.mjs mirrors each session.json into the git common dir, because the
// in-tree pair log is gitignored and vanishes with the story worktree.
function pairStore(root) {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (r.status !== 0 || typeof r.stdout !== 'string' || !r.stdout.trim()) return null
  return join(resolve(root, r.stdout.trim()), 'agentic-sdlc', 'pair')
}

// The mirror first; the in-tree path still answers for pair logs committed
// before the log was gitignored.
function pairSessionPath(ctx, id) {
  if (ctx.pairStore) {
    const mirrored = join(ctx.pairStore, id, 'session.json')
    if (existsSync(mirrored)) return mirrored
  }
  const inTree = join(ctx.project, 'backlog', 'pair', id, 'session.json')
  return existsSync(inTree) ? inTree : null
}

export function loadContext({ project, now = new Date(), pluginJson = PLUGIN_JSON, backlog, meter, prComments } = {}) {
  const root = resolve(project ?? process.cwd())
  const marker = readMarker(root)
  const path = resolveBacklogPath(root, marker, backlog)
  let text = null
  if (path) {
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      text = null
    }
  }
  return {
    project: root,
    now,
    pluginJson,
    marker,
    meterOverride: meter ?? null,
    pairStore: pairStore(root),
    ...loadPrComments(root, marker, prComments),
    backlog: {
      path,
      exists: Boolean(path && existsSync(path)),
      parsed: text === null ? null : parseBacklog(text, path),
    },
  }
}

// ============================================================ section: run

// Outcome per ARCH-4: blocked, else completed if the command's completion
// artifact exists, else aborted. Each command's completion check returns
// true / false, or null plus the input it could not read.
const COMPLETION = {
  plan: (ctx) => {
    const b = ctx.backlog
    if (b.exists && !b.parsed) return { done: null, degraded: ['backlog_file'] }
    return { done: Boolean(b.parsed && b.parsed.stories.length + b.parsed.tasks > 0) }
  },
  // Every story DONE, or the file's own Status flipped to DONE. An open epic PR
  // would also count, but no local artifact records it, and readable PR
  // comments prove only that some PR exists — so backlog statuses stay the
  // only evidence.
  build: (ctx) => {
    const p = ctx.backlog.parsed
    if (!p) return { done: null, degraded: ['backlog_file'] }
    const allDone = p.stories.length > 0 && p.stories.every((s) => s.status?.toUpperCase() === 'DONE')
    return { done: allDone || p.status?.toUpperCase() === 'DONE' }
  },
  review: (ctx) => {
    if (ctx.prComments === null) return { done: null, degraded: ['pr_comments'] }
    return { done: reviewRounds(ctx.prComments).size > 0 }
  },
}

function isBlocked(ctx) {
  const degraded = []
  const p = ctx.backlog.parsed
  const snapshot = ctx.marker?.arch_snapshot
  if (p && snapshot) {
    for (const [id, a] of p.arch) {
      if (!snapshot.has(id) && a.status?.toUpperCase() === 'OPEN') return { blocked: true, degraded }
    }
  }
  // Only this backlog's stories: a stale blocked session from another epic must
  // not mark this run blocked. With no readable backlog there is no way to tell
  // which sessions are ours, and the completion check already degrades.
  if (!p) return { blocked: false, degraded }
  for (const { id } of p.stories) {
    const sessionPath = pairSessionPath(ctx, id)
    if (!sessionPath) continue
    const s = readJson(sessionPath)
    if (!isPlainObject(s)) {
      if (!degraded.includes('pair_sessions')) degraded.push('pair_sessions')
      continue
    }
    if (s.session === 'blocked') return { blocked: true, degraded }
  }
  return { blocked: false, degraded }
}

function deriveOutcome(ctx) {
  const command = ctx.marker?.command
  if (!command) return { value: null, degraded: ['run_state'] }
  const degraded = []
  if (command === 'build') {
    const b = isBlocked(ctx)
    degraded.push(...b.degraded)
    if (b.blocked) return { value: 'blocked', degraded }
  }
  const c = COMPLETION[command](ctx)
  if (c.done === null) return { value: null, degraded: [...degraded, ...c.degraded] }
  return { value: c.done ? 'completed' : 'aborted', degraded }
}

const isoSeconds = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

export function buildRun(ctx) {
  const degraded = []
  const m = ctx.marker
  const version = readJson(ctx.pluginJson)?.version
  const plugin_version = typeof version === 'string' && PATTERNS.semver.test(version) ? version : null
  if (plugin_version === null) degraded.push('plugin_version')
  if (!m || !m.complete) degraded.push('run_state')

  const outcome = deriveOutcome(ctx)
  degraded.push(...outcome.degraded)

  const nowMs = ctx.now.getTime()
  const complete = m && m.wall_clock_s_prior !== null && m.started_ms !== null
  const wall_clock_s = complete
    ? m.session_open === false
      ? m.wall_clock_s_prior
      : Math.round(m.wall_clock_s_prior + Math.max(0, nowMs - m.started_ms) / 1000)
    : null

  return {
    section: {
      run_id: m?.run_id ?? null,
      plugin_version,
      command: m?.command ?? null,
      lane: m?.lane ?? null,
      outcome: outcome.value,
      ended_at: isoSeconds(ctx.now),
      wall_clock_s,
      sessions: m?.sessions ?? null,
    },
    degraded,
  }
}

// =========================================================== section: plan

export function buildPlan(ctx) {
  const p = ctx.backlog.parsed
  if (!p) {
    return {
      section: { epics: null, stories: null, tasks: null, arch_handoffs: null },
      degraded: ['backlog_file'],
    }
  }
  const degraded = []
  const command = ctx.marker?.command
  let arch_handoffs = null
  if (command && command !== 'plan' && !ctx.marker.arch_snapshot) {
    degraded.push('run_state')
  } else {
    const planTime = command && command !== 'plan' ? ctx.marker.arch_snapshot : null
    arch_handoffs = Object.fromEntries(OPEN.arch_category.map((c) => [c, 0]))
    for (const [id, a] of p.arch) {
      if (planTime && !planTime.has(id)) continue
      arch_handoffs[toCategory('arch_category', a.category)]++
    }
  }
  return {
    section: {
      epics: p.kind === 'EPIC' ? 1 : 0,
      stories: p.stories.length,
      tasks: p.tasks,
      arch_handoffs,
    },
    degraded,
  }
}

// ========================================================== section: build
//
// TOUCHED BY THE BUILD — a story appears in build.stories only on evidence that
// survives the run, never on its mere presence in the backlog file (an untouched
// story is absent, not zeroed). Any one of:
//   1. a pair session: its session.json exists, mirrored at
//      <git common dir>/agentic-sdlc/pair/<STORY-ID>/ or, for history that
//      predates the mirror, in-tree at backlog/pair/<STORY-ID>/;
//   2. its `- status:` is set and no longer TODO (IN_PROGRESS, DONE, BLOCKED…);
//   3. a commit subject on the current branch carries its `[<ID>]` tag — the
//      only evidence a FAST task leaves, since fast task blocks have no status.
// Git is corroborating evidence only: where it is missing or the project is not
// a repository, rules 1–2 still decide, so there is no degraded token for it.
//
// MODE — PAIR when a session.json exists, else FAST for a FAST-<n> file or a
// fast-lane run, else SOLO. Only session.json is read: the pair log's markdown
// is free text, and the alternation count already lives in the session file.

function commitSubjects(project) {
  const r = spawnSync('git', ['-C', project, 'log', '--format=%s'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return r.status === 0 && typeof r.stdout === 'string' ? r.stdout : ''
}

// FAST files hold `### T<n>-<m>` tasks, which parseBacklog only counts; the
// build needs their IDs, in file order, to look for their commit tags.
function buildUnits(ctx, p) {
  if (p.kind !== 'FAST') return p.stories
  let text = ''
  try {
    text = readFileSync(ctx.backlog.path, 'utf8')
  } catch {
    return []
  }
  return [...text.matchAll(/^### (T\d+-\d+)\b/gm)].map((m) => ({ id: m[1], status: null }))
}

function buildStories(ctx, p) {
  const degraded = []
  const fast = p.kind === 'FAST' || ctx.marker?.lane === 'fast'
  const subjects = commitSubjects(ctx.project)
  const stories = []
  for (const unit of buildUnits(ctx, p)) {
    const sessionPath = pairSessionPath(ctx, unit.id)
    const paired = sessionPath !== null
    const statusMoved = Boolean(unit.status) && unit.status.toUpperCase() !== 'TODO'
    const tagged = subjects.includes(`[${unit.id}]`)
    if (!paired && !statusMoved && !tagged) continue
    if (!paired) {
      stories.push({ mode: fast ? 'FAST' : 'SOLO', alternations: 0 })
      continue
    }
    const s = readJson(sessionPath)
    const alt = isPlainObject(s) ? s.alternation : undefined
    if (Number.isInteger(alt) && alt >= 0) {
      stories.push({ mode: 'PAIR', alternations: alt })
    } else {
      if (!degraded.includes('pair_sessions')) degraded.push('pair_sessions')
      stories.push({ mode: 'PAIR', alternations: null })
    }
  }
  return { stories, degraded }
}

// Handoffs absent from the start-of-run snapshot were raised mid-build. A plan
// run counts every handoff as plan-time (buildPlan), so here it contributes
// zero rather than counting the same handoffs twice.
function archBlocks(ctx, p) {
  const command = ctx.marker?.command
  const snapshot = ctx.marker?.arch_snapshot
  if (!command || (command !== 'plan' && !snapshot)) return { value: null, degraded: ['run_state'] }
  const counts = Object.fromEntries(OPEN.arch_category.map((c) => [c, 0]))
  if (command === 'plan') return { value: counts, degraded: [] }
  for (const [id, a] of p.arch) {
    if (snapshot.has(id)) continue
    counts[toCategory('arch_category', a.category)]++
  }
  return { value: counts, degraded: [] }
}

// The REVISE loop's orchestrator posts one `## Response — round <k>` per round;
// distinct k, so a re-posted response does not count as another round.
const RESPONSE_ROUND = /^##\s+Response\s+[—–-]\s+round\s+(\d+)\b/gim

function reviseRounds(ctx) {
  const comments = ctx.prComments
  if (!Array.isArray(comments)) return { value: null, degraded: ['pr_comments'] }
  const rounds = new Set()
  for (const body of comments) {
    if (typeof body !== 'string') continue
    for (const m of body.matchAll(RESPONSE_ROUND)) rounds.add(Number(m[1]))
  }
  return { value: rounds.size, degraded: [] }
}

export function buildBuild(ctx) {
  const degraded = []
  const p = ctx.backlog.parsed
  let stories = null
  let arch_blocks = null
  if (p) {
    const s = buildStories(ctx, p)
    stories = s.stories
    degraded.push(...s.degraded)
    const a = archBlocks(ctx, p)
    arch_blocks = a.value
    degraded.push(...a.degraded)
  } else {
    degraded.push('backlog_file')
  }
  const r = reviseRounds(ctx)
  degraded.push(...r.degraded)
  // Nothing records gate runs yet (ADR 0001); inventing a source would turn a
  // known gap into a wrong number.
  degraded.push('gate_history')
  return {
    section: { stories, arch_blocks, revise_rounds: r.value, gate_runs: null, gate_failures: null },
    degraded,
  }
}

// ========================================================= section: review
//
// PR COMMENTS — ctx.prComments / ctx.prReviewStates (loadContext)
//
//   prComments:     string[] | null — every review body AND issue-comment body on
//                   the PR, oldest first; null means the PR could not be read.
//   prReviewStates: (string | null)[] | null — parallel to prComments: the GitHub
//                   review state (APPROVED, CHANGES_REQUESTED, COMMENTED, …) for a
//                   review body, null for an issue comment.
//
// Both kinds are read because the code-reviewer posts its round comment as a
// review (`gh pr review`), while review.md counts rounds across all bodies.
//
// Sources, in order: --pr-comments <file.json> (a JSON array whose elements are
// a body string or { "body", "state" }); else one `gh pr view [<n>] --json
// comments,reviews` in the project — <n> from a review run's target, none for a
// build run so gh picks the current branch's PR. A plan run, or a run with no
// marker, never calls gh. RUN_REPORT_GH overrides the gh binary (tests).

const GH_TIMEOUT_MS = 5000

function readPrCommentsFile(file) {
  const raw = readJson(file)
  if (!Array.isArray(raw)) return null
  const bodies = []
  const states = []
  for (const item of raw) {
    if (typeof item === 'string') {
      bodies.push(item)
      states.push(null)
    } else if (isPlainObject(item) && typeof item.body === 'string') {
      bodies.push(item.body)
      states.push(typeof item.state === 'string' ? item.state : null)
    } else return null
  }
  return { bodies, states }
}

function readPrCommentsGh(root, marker) {
  const args = ['pr', 'view']
  if (marker.command === 'review') {
    // `#42`, `42 --fable` and a PR URL all name PR 42.
    const n = /(\d+)\/?$/.exec((marker.target ?? '').trim().split(/\s+/)[0] ?? '')?.[1]
    if (!n) return null
    args.push(n)
  }
  args.push('--json', 'comments,reviews')
  const r = spawnSync(process.env.RUN_REPORT_GH || 'gh', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: GH_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (r.error || r.status !== 0) return null
  let data
  try {
    data = JSON.parse(r.stdout)
  } catch {
    return null
  }
  if (!isPlainObject(data)) return null
  const entries = []
  const add = (list, timeKey, isReview) => {
    if (!Array.isArray(list)) return
    for (const c of list) {
      if (!isPlainObject(c) || typeof c.body !== 'string') continue
      const t = Date.parse(c[timeKey] ?? '')
      entries.push({ body: c.body, state: isReview && typeof c.state === 'string' ? c.state : null, t: Number.isFinite(t) ? t : 0 })
    }
  }
  add(data.comments, 'createdAt', false)
  add(data.reviews, 'submittedAt', true)
  entries.sort((a, b) => a.t - b.t)
  return { bodies: entries.map((e) => e.body), states: entries.map((e) => e.state) }
}

function loadPrComments(root, marker, file) {
  let got = null
  if (file) got = readPrCommentsFile(file)
  else if (marker?.command === 'build' || marker?.command === 'review') got = readPrCommentsGh(root, marker)
  return { prComments: got?.bodies ?? null, prReviewStates: got?.states ?? null }
}

const ROUND_HEADING = /^##\s+Review\s+[—–-]\s+round\s+(\d+)\b/m

// round k → index of its body. A round posted twice (a retry after a failed
// `gh pr review`) keeps the later copy, so it is counted once.
function reviewRounds(bodies) {
  const rounds = new Map()
  bodies.forEach((body, i) => {
    const k = Number(ROUND_HEADING.exec(body)?.[1])
    if (Number.isInteger(k) && k >= 1) rounds.set(k, i)
  })
  return rounds
}

// The GitHub review state is the verdict as posted, so a COMMENT fallback reads
// COMMENT even though its body says REQUEST_CHANGES. A body with no usable state
// (an issue comment, a dismissed review) falls back to its own verdict line.
const STATE_TO_VERDICT = { APPROVED: 'APPROVE', CHANGES_REQUESTED: 'REQUEST_CHANGES', COMMENTED: 'COMMENT' }

function roundVerdict(body, state) {
  if (state && STATE_TO_VERDICT[state]) return STATE_TO_VERDICT[state]
  const line = /^-\s*verdict:\s*`?([A-Z_]+)/m.exec(body)?.[1]
  return isMember('verdict', line) && line !== 'NONE' ? line : null
}

// Severity is closed with no `other`, so a line whose severity is not BLOCKER,
// MAJOR or MINOR is not a finding entry at all. That is also what drops a
// re-review's rulings on earlier IDs (`F1: FIXED — …`).
const FINDING_LINE = /^\s*(?:-\s*)?F\d+:\s*([A-Za-z]+)\b\s*(?:\[([^\]\n]*)\])?/

function roundFindings(body, round) {
  const findings = []
  const lines = body.slice(ROUND_HEADING.exec(body).index).split('\n')
  for (const line of lines) {
    const m = FINDING_LINE.exec(line)
    if (!m) continue
    const severity = m[1].toUpperCase()
    if (!isMember('severity', severity)) continue
    const category = toCategory('finding_category', m[2]?.trim().toLowerCase())
    findings.push({ round, category, severity })
  }
  return findings
}

export function buildReview(ctx) {
  const none = { rounds: 0, verdict: 'NONE', findings: [] }
  if (ctx.marker?.command === 'plan' && ctx.prComments === null) return { section: none, degraded: [] }
  if (ctx.prComments === null) {
    return { section: { rounds: null, verdict: null, findings: null }, degraded: ['pr_comments'] }
  }
  const rounds = reviewRounds(ctx.prComments)
  if (rounds.size === 0) return { section: none, degraded: [] }
  const ordered = [...rounds.keys()].sort((a, b) => a - b)
  const latest = ordered.at(-1)
  const latestIdx = rounds.get(latest)
  const verdict = roundVerdict(ctx.prComments[latestIdx], ctx.prReviewStates?.[latestIdx] ?? null)
  const findings = ordered.flatMap((k) => roundFindings(ctx.prComments[rounds.get(k)], k))
  return {
    section: { rounds: latest, verdict, findings },
    degraded: verdict === null ? ['pr_comments'] : [],
  }
}

// =========================================================== section: debt

const LEDGER_REL = join('docs', 'TOOLING-DEBT.md')
// Mirrors plan-artifacts.mjs's "## Debt" pattern: an exact heading, body up to
// the next `## ` or end of file.
const LOGGED_BY_AGENTS_RE = /^## Logged by agents\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m

// Entries are appended, never reordered, so splitting on every `### ` heading
// (including the ledger template's own fenced example) and later taking the
// tail is enough — the template heading is never part of the tail because
// nothing is ever inserted ahead of it.
function debtLedgerEntries(ledgerText) {
  const section = LOGGED_BY_AGENTS_RE.exec(ledgerText)
  if (!section) return null
  const body = section[1]
  const starts = [...body.matchAll(/^###[ \t].*$/gm)].map((m) => m.index)
  return starts.map((start, i) => body.slice(start, starts[i + 1] ?? body.length))
}

export function buildDebt(ctx) {
  const missing = { section: { rows_logged: null, by_risk: null, by_category: null }, degraded: ['debt_ledger'] }
  let text
  try {
    text = readFileSync(join(ctx.project, LEDGER_REL), 'utf8')
  } catch {
    return missing
  }
  const entries = debtLedgerEntries(text)
  if (entries === null) return missing

  const m = ctx.marker
  if (!m || m.debt_snapshot === null || m.debt_snapshot === undefined) {
    return { section: { rows_logged: null, by_risk: null, by_category: null }, degraded: ['run_state'] }
  }
  const current = entries.length
  if (current < m.debt_snapshot) return missing // ledger rewritten mid-run — never report a negative count

  const rows_logged = current - m.debt_snapshot
  const newEntries = entries.slice(entries.length - rows_logged)
  const by_risk = Object.fromEntries(CLOSED.risk.map((r) => [r, 0]))
  const by_category = Object.fromEntries(OPEN.debt_category.map((c) => [c, 0]))
  for (const body of newEntries) {
    // Risk is a closed enum with no `other`: an entry whose Risk line is
    // missing or stale counts in rows_logged but nowhere in by_risk.
    const risk = field(body, 'Risk')
    if (risk && isMember('risk', risk)) by_risk[risk]++
    by_category[toCategory('debt_category', field(body, 'Category'))]++
  }
  return { section: { rows_logged, by_risk, by_category }, degraded: [] }
}

// =========================================================== section: cost

function newestMeterRecord(ctx) {
  const dir = join(ctx.project, METER_DIR)
  if (!existsSync(dir)) return undefined
  const since = ctx.marker?.started_ms ?? -Infinity
  const candidates = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const p = join(dir, name)
    const mtime = statSync(p).mtimeMs
    if (mtime >= since) candidates.push({ p, name, mtime })
  }
  candidates.sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1))
  return candidates.length ? readJson(candidates[0].p) : undefined
}

export function buildCost(ctx) {
  const rec = ctx.meterOverride ? readJson(ctx.meterOverride) : newestMeterRecord(ctx)
  const missing = { section: null, degraded: ['meter_record'] }
  if (!isPlainObject(rec) || !Number.isInteger(rec.schema) || rec.schema < 1) return missing
  const problems = []
  checkNumericRecord(rec.totals, 'totals', problems)
  checkNumericRecord(rec.derived, 'derived', problems)
  if (problems.length) return missing
  return { section: { schema: rec.schema, totals: rec.totals, derived: rec.derived }, degraded: [] }
}

// ------------------------------------------------------------------- mark

// The prompt's first line names the slash command: "/agentic-sdlc:<command>
// <raw arg>". Lane and target come out of the raw arg, never the command
// name, so "--fast" anywhere in it flips the lane and is stripped from the
// target left behind.
const PROMPT_COMMAND = /^\/agentic-sdlc:(\w[\w-]*)\s*(.*)$/

function parsePrompt(text) {
  const line = text.trim().split('\n')[0] ?? ''
  const m = PROMPT_COMMAND.exec(line)
  if (!m) return null
  const rest = m[2]
  const fast = /--fast\b/.test(rest)
  const target = rest.replace(/--fast\b/, '').trim().replace(/\s+/g, ' ')
  return { command: m[1], lane: fast ? 'fast' : 'deliberate', target }
}

// Builds and writes the report for whatever run is CURRENTLY on disk — the
// same path the `report` CLI command and the SessionEnd hook use — before
// mark() overwrites the marker with a new run. Used only by supersession: a
// different command/target means the old run's own SessionEnd never got the
// chance to close it (the prompt moved on first), so mark is the only place
// left to fold its clock and write its report. Silent no-op on anything that
// would make `report` itself write nothing (no marker, invalid report) —
// mark must never fail the prompt over a previous run's report.
function finalizeRun(root, now) {
  const ctx = loadContext({ project: root, now })
  if (!ctx.marker) return
  const report = buildReport(ctx)
  if (validate(report).length || !report.run.run_id) return
  commitReport(ctx, report, join(root, RUNS_DIR, `${report.run.run_id}.json`))
}

// Continuation (same command+target) and same-session re-prompts are handled
// here per ARCH-4: mark never folds elapsed time — that is the SessionEnd
// path's job (see the "mark section (continuation across sessions)" test
// block for the rule this encodes). Supersession (a different command or
// target) finalizes the old run first — see finalizeRun above.
function mark({ project, promptFile, session, now }) {
  const promptText = readFileSync(promptFile, 'utf8')
  const parsed = parsePrompt(promptText)
  if (!parsed || !isMember('command', parsed.command)) return null
  const root = resolve(project)

  const existing = readJson(join(root, MARKER))
  if (isPlainObject(existing) && existing.command === parsed.command && existing.target === parsed.target) {
    // Same session AND still open: a re-prompt mid-session, not a boundary.
    // Same session but CLOSED (SessionEnd already ran — e.g. `claude --resume`
    // reuses a session id) is treated exactly like a new session: it reopens.
    if (existing.session_id === session && existing.session_open !== false) return existing
    const marker = {
      ...existing,
      started_at: isoSeconds(now),
      sessions: (Number.isInteger(existing.sessions) ? existing.sessions : 1) + 1,
      session_id: session,
      session_open: true,
    }
    writeJsonAtomic(join(root, MARKER), marker)
    return marker
  }

  // A different command or target while a marker exists: finalize the
  // superseded run (fold its clock, write its report) before claiming a
  // fresh run_id for this one.
  if (isPlainObject(existing)) finalizeRun(root, now)

  // Same resolution the report uses (resolveBacklogPath), called with no prior
  // marker.backlog so a plan run's own Artifacts-line lookup still applies.
  const path = resolveBacklogPath(root, { command: parsed.command, target: parsed.target, backlog: null }, undefined)
  let arch_snapshot = []
  let backlog = null
  if (path && existsSync(path)) {
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      text = null
    }
    const parsedBacklog = text === null ? null : parseBacklog(text, path)
    if (parsedBacklog) {
      arch_snapshot = [...parsedBacklog.arch.keys()]
      backlog = isAbsolute(path) && !path.startsWith(root) ? path : relative(root, path)
    }
  }

  let debt_snapshot = null
  try {
    const ledgerText = readFileSync(join(root, LEDGER_REL), 'utf8')
    const entries = debtLedgerEntries(ledgerText)
    debt_snapshot = entries === null ? null : entries.length
  } catch {
    debt_snapshot = null
  }

  const marker = {
    run_id: randomUUID(),
    command: parsed.command,
    lane: parsed.lane,
    target: parsed.target,
    started_at: isoSeconds(now),
    sessions: 1,
    wall_clock_s_prior: 0,
    arch_snapshot,
    debt_snapshot,
    backlog,
    session_id: session,
    session_open: true,
  }
  writeJsonAtomic(join(root, MARKER), marker)
  return marker
}

// ----------------------------------------------------------------- report

export const SECTION_BUILDERS = Object.freeze({
  run: buildRun,
  plan: buildPlan,
  build: buildBuild,
  review: buildReview,
  debt: buildDebt,
  cost: buildCost,
})

export function buildReport(ctx) {
  const report = { schema: 1 }
  const named = new Set()
  for (const [key, builder] of Object.entries(SECTION_BUILDERS)) {
    const { section, degraded } = builder(ctx)
    report[key] = section
    for (const d of degraded) named.add(d)
  }
  // Vocabulary order, so two builds of the same artifacts are byte-identical.
  report.degraded = DEGRADED_INPUT.filter((d) => named.has(d))
  return report
}

// Producing a report finalises whatever session was open when it ran (ARCH-4):
// the SessionEnd hook spawns `report` detached to close out a run, so this is
// the only place the fold can happen. Folds wall_clock_s (already prior +
// elapsed) back into the marker as the new prior and closes session_open, so a
// later rebuild of this same session reports the banked prior alone.
//
// The marker is re-read here, after the (possibly slow) build, because a newer
// prompt may have moved it on in the meantime:
//   - same generation: bank, then write the report;
//   - same run, newer session (continuation raced ahead of this fold): add only
//     this session's elapsed time to the newer marker's prior, leave the newer
//     session open, and write no report — the newer session's own SessionEnd
//     writes a fuller one, and this one must not overwrite it;
//   - a different run (supersession already finalized ours) or no marker:
//     touch nothing.
// Returns whether the report was written.
export function commitReport(ctx, report, out) {
  const m = ctx.marker
  if (m) {
    const markerPath = join(ctx.project, MARKER)
    const raw = readJson(markerPath)
    const foldable = m.session_open !== false && m.wall_clock_s_prior !== null && m.started_ms !== null
    if (generationOf(raw) !== m.generation) {
      if (foldable && raw?.run_id === m.run_id && typeof report.run.wall_clock_s === 'number') {
        const elapsed = report.run.wall_clock_s - m.wall_clock_s_prior
        const prior = typeof raw.wall_clock_s_prior === 'number' ? raw.wall_clock_s_prior : 0
        writeJsonAtomic(markerPath, { ...raw, wall_clock_s_prior: prior + elapsed })
      }
      return false
    }
    if (foldable) writeJsonAtomic(markerPath, { ...raw, wall_clock_s_prior: report.run.wall_clock_s, session_open: false })
  }
  writeJsonAtomic(out, report)
  return true
}

// -------------------------------------------------------------------- CLI

function main(argv) {
  const [command, ...rest] = argv
  const flags = {}
  const positional = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a.startsWith('--')) {
      const next = rest[i + 1]
      if (next === undefined || next.startsWith('--')) flags[a.slice(2)] = true
      else {
        flags[a.slice(2)] = next
        i++
      }
    } else positional.push(a)
  }
  const USAGE = `usage:
  run-report.mjs report --project <dir> [--out <file>] [--backlog <file>] [--meter <record.json>]
                        [--pr-comments <comments.json>] [--now <ISO-8601>]
  run-report.mjs mark --project <dir> --prompt-file <f> --session <id> [--now <ISO-8601>]
  run-report.mjs validate <file>`
  const die = (code, msg) => {
    process.stderr.write(`run-report: ${msg}\n`)
    process.exit(code)
  }
  const str = (k) => (typeof flags[k] === 'string' ? flags[k] : undefined)

  if (command === 'mark') {
    const project = str('project')
    const promptFile = str('prompt-file')
    const session = str('session')
    if (!project || !promptFile || !session) die(2, USAGE)
    let now = new Date()
    if (str('now')) {
      now = new Date(str('now'))
      if (!Number.isFinite(now.getTime())) die(2, `--now is not a date: ${str('now')}`)
    }
    const marker = mark({ project, promptFile, session, now })
    if (!marker) die(1, `prompt does not name a known command: ${promptFile}`)
    process.exit(0)
  }

  if (command === 'validate') {
    if (!positional[0]) die(2, USAGE)
    const report = readJson(positional[0])
    if (report === undefined) die(1, `cannot read JSON from ${positional[0]}`)
    const v = validate(report)
    if (v.length) die(1, `invalid report:\n  ${v.join('\n  ')}`)
    process.stdout.write('valid\n')
    process.exit(0)
  }

  if (command === 'report') {
    let now = new Date()
    if (str('now')) {
      now = new Date(str('now'))
      if (!Number.isFinite(now.getTime())) die(2, `--now is not a date: ${str('now')}`)
    }
    const ctx = loadContext({
      project: str('project'),
      now,
      backlog: str('backlog'),
      meter: str('meter'),
      prComments: str('pr-comments'),
    })
    const report = buildReport(ctx)
    const v = validate(report)
    if (v.length) die(1, `refusing to write an invalid report:\n  ${v.join('\n  ')}`)
    if (report.degraded.length) process.stderr.write(`run-report: degraded: ${report.degraded.join(', ')}\n`)
    const out = str('out') ?? (report.run.run_id ? join(ctx.project, RUNS_DIR, `${report.run.run_id}.json`) : null)
    if (!out) {
      process.stderr.write('run-report: no run marker, so no run_id to name the report; nothing written\n')
      process.exit(0)
    }
    if (!commitReport(ctx, report, out)) {
      process.stderr.write('run-report: the run marker moved on while this report was built; nothing written\n')
      process.exit(0)
    }
    process.stdout.write(`${out}\n`)
    process.exit(0)
  }

  die(2, `${command ? `unknown command: ${command}\n` : ''}${USAGE}`)
}

// Compared by realpath: import.meta.url is already resolved, so a script reached
// through a symlink (a plugin cache link, macOS's /var → /private/var) would
// otherwise never run its CLI.
const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
})()
if (isMain) main(process.argv.slice(2))
