#!/usr/bin/env node
//
// meter.mjs — measure what a pipeline run actually costs, per lane and per agent.
//
// WHY THIS EXISTS AS A SCRIPT AND NOT A SPREADSHEET
//
// The pair-log spec (docs/superpowers/specs/2026-07-31-pair-log-carryover-design.md)
// priced spend as `Σ over turns of (bytes_read × round_trips)` — every re-sent byte
// at full rate, with no caching term and no output term. Measured against real
// billing that is off by a large, lane-dependent factor:
//
//   * Re-sent bytes are CACHE READS, billed at 0.10×, not 1.0×. For a long single
//     session the naive model overstates static-content cost by ~4.4×.
//   * The first API call of every subagent spawn pays cache_creation for the system
//     prompt + tool definitions + injected CLAUDE.md, billed at 1.25× (5m TTL) or
//     2.0× (1h TTL). A ~40-spawn PAIR story spends 0.8M–1.5M billed tokens BOOTING
//     agents before any work — a term the old model does not contain at all, and one
//     that scales with TOOL COUNT, not prose length.
//
// So this meter reports the overstatement factor PER LANE rather than assuming the
// 4.4× (a PAIR story is dozens of short subagent sessions on a 5-minute TTL — the
// opposite shape from the long conversation that produced 4.4×), and it surfaces
// per-spawn boot cost and round-trip count as first-class derived fields.
//
// DATA SOURCES, LAYERED BY TRUST
//
//   A (primary)    `claude -p --output-format stream-json --verbose`, captured to a
//                  file. DOCUMENTED. Per-message usage, exact totals, cost, model.
//   B (enrichment) ~/.claude/projects/<proj>/<session>.jsonl plus
//                  <session>/subagents/agent-*.jsonl. INTERNAL, UNGUARANTEED FORMAT.
//                  Uniquely gives the agent TYPE name (attributionAgent), per-spawn
//                  boot cost, and the 5m-vs-1h cache split.
//   C (production) OpenTelemetry (CLAUDE_CODE_ENABLE_TELEMETRY=1). Documented. For
//                  metering real runs in consuming projects — not parsed here.
//
// THE GUARD ON LAYER B IS THE POINT. Claude Code's docs warn the transcript format
// is internal. So layer B is probed on startup (TRANSCRIPT_SCHEMA / REQUIRED_FIELDS):
// if a required field is missing, the meter DEGRADES to layer A only, names the
// missing fields in `record.degraded` and on stderr, and still reports correct
// totals. It never crashes and never silently reports zeros — silent zeros would
// make every cost claim in this programme false.
//
// Layer B also has a documented door: the SubagentStop/Stop hook input carries
// `transcript_path` and `session_id`, so when run from a hook the meter parses a
// path the harness handed it (see templates/hooks/).
//
// Zero dependencies, Node 22 (the repo floor). See
// docs/superpowers/specs/2026-09-17-meter-and-benchmark-design.md

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { spawnSync } from 'node:child_process'

// ------------------------------------------------------------ schema + prices

const SCHEMA = 1
const TRANSCRIPT_SCHEMA = 1

// The layer-B enrichment fields a transcript MUST carry for by-agent attribution.
// Probed against the first PROBE_LINES assistant records; a miss degrades to A.
const REQUIRED_FIELDS = ['attributionAgent']
const PROBE_LINES = 200

// Cache-tier multipliers on the input rate. These are the documented, stable
// ratios — and the whole reason this meter exists, so they are named, not inlined.
const CACHE_WRITE_5M = 1.25
const CACHE_WRITE_1H = 2.0
const CACHE_READ = 0.1

// Per-model list prices, USD per 1,000,000 tokens: [input, output].
// VERIFY these against the current pricing (the `claude-api` skill / docs) before
// trusting an absolute-dollar figure — they drift. Token-space derived fields
// (billed_input_equivalent, overstatement_factor, boot_tokens) do NOT depend on
// them. `capture`/`report` also record the CLI's own total_cost_usd as the
// authoritative cross-check (derived.cost_usd_reported).
const PRICES = {
  opus: [15, 75],
  sonnet: [3, 15],
  haiku: [1, 5],
  fable: [5, 25], // placeholder — VERIFY
  'gemini-flash': [0.1, 0.4],
  'gemini-pro': [1.25, 5],
  flash: [0.1, 0.4],
}
const DEFAULT_PRICE = [3, 15]

const priceFor = (model, degraded) => {
  const m = String(model || '').toLowerCase()
  for (const family of Object.keys(PRICES)) {
    if (m.includes(family)) return PRICES[family]
  }
  const note = `unknown-model-price:${model}`
  if (degraded && !degraded.includes(note)) degraded.push(note)
  return DEFAULT_PRICE
}

// --------------------------------------------------------------- arg parsing

const [, , command, ...rest] = process.argv

const flags = {}
const positional = []
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]
  if (a === '--') {
    positional.push(...rest.slice(i + 1))
    break
  }
  if (a.startsWith('--')) {
    const key = a.slice(2)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true
    } else {
      flags[key] = next
      i++
    }
  } else {
    positional.push(a)
  }
}

const die = (code, msg) => {
  process.stderr.write(`meter: ${msg}\n`)
  process.exit(code)
}

const warn = (msg) => process.stderr.write(`meter: ${msg}\n`)

const USAGE = `usage:
  meter.mjs report  --stream <file> [--transcript <file>] [--subagents <dir>] [--lane deliberate|fast] [--label <s>]
  meter.mjs record  --stream <file> [--transcript <file>] [--subagents <dir>] [--lane <l>] [--label <s>] [--store <dir>]
  meter.mjs enrich  --record <file> --transcript <file> [--subagents <dir>]
  meter.mjs diff    --baseline <record.json> --candidate <record.json>
  meter.mjs boot    --agent <name> --stream <file> [--transcript <file>] [--subagents <dir>]
  meter.mjs capture --out <file> -- <claude args...>`

if (!command || command === '--help' || command === '-h') die(2, USAGE)

// ---------------------------------------------------------------- utilities

const readJsonl = (path) => {
  const out = []
  const text = readFileSync(path, 'utf8')
  let lineNo = 0
  for (const raw of text.split('\n')) {
    lineNo++
    const line = raw.trim()
    if (!line) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      warn(`skipping unparseable line ${lineNo} of ${basename(path)}`)
    }
  }
  return out
}

// A usage object as the API/CLI emits it, normalised to the fields we bill on.
const readUsage = (u = {}) => {
  const cc = u.cache_creation || {}
  const cw5m = cc.ephemeral_5m_input_tokens ?? (u.cache_creation_input_tokens ?? 0)
  const cw1h = cc.ephemeral_1h_input_tokens ?? 0
  // When only the flat cache_creation_input_tokens is present we cannot split the
  // TTL, so it all lands in the 5m bucket — the conservative (cheaper) assumption,
  // and the split is a layer-B enrichment anyway.
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cache_write_5m: cw5m,
    cache_write_1h: cw1h,
    cache_read: u.cache_read_input_tokens ?? 0,
    thinking: u.thinking_tokens ?? 0,
  }
}

const emptyTotals = () => ({
  input: 0,
  output: 0,
  cache_write_5m: 0,
  cache_write_1h: 0,
  cache_read: 0,
  thinking: 0,
  billed_input_equivalent: 0,
  usd: 0,
})

const usdFor = (u, model, degraded) => {
  const [pin, pout] = priceFor(model, degraded)
  return (
    (u.input * pin +
      u.output * pout +
      u.cache_write_5m * pin * CACHE_WRITE_5M +
      u.cache_write_1h * pin * CACHE_WRITE_1H +
      u.cache_read * pin * CACHE_READ) /
    1e6
  )
}

const addUsage = (totals, u, model, degraded) => {
  totals.input += u.input
  totals.output += u.output
  totals.cache_write_5m += u.cache_write_5m
  totals.cache_write_1h += u.cache_write_1h
  totals.cache_read += u.cache_read
  totals.thinking += u.thinking
  totals.usd += usdFor(u, model, degraded)
}

const round = (n, p = 6) => Number(n.toFixed(p))

const billedInputEquivalent = (t) =>
  t.input + CACHE_WRITE_5M * t.cache_write_5m + CACHE_WRITE_1H * t.cache_write_1h + CACHE_READ * t.cache_read

const naiveModelTokens = (t) => t.input + t.cache_write_5m + t.cache_write_1h + t.cache_read

// ----------------------------------------------------- layer A: stream parse

const parseStream = (path, degraded) => {
  const events = readJsonl(path)
  const totals = emptyTotals()
  const byModel = {}
  let assistantMsgs = 0
  let userTurns = 0
  let costReported = null
  let wallClockS = 0

  for (const ev of events) {
    if (ev.type === 'assistant' && ev.message) {
      assistantMsgs++
      const model = ev.message.model || ev.model || 'unknown'
      const u = readUsage(ev.message.usage)
      addUsage(totals, u, model, degraded)
      byModel[model] = byModel[model] || { usd: 0 }
      byModel[model].usd += usdFor(u, model, degraded)
    } else if (ev.type === 'user') {
      userTurns++
    } else if (ev.type === 'result') {
      if (typeof ev.total_cost_usd === 'number') costReported = ev.total_cost_usd
      if (typeof ev.duration_ms === 'number') wallClockS = ev.duration_ms / 1000
      if (typeof ev.num_turns === 'number' && ev.num_turns > 0) userTurns = ev.num_turns
    }
  }

  totals.billed_input_equivalent = billedInputEquivalent(totals)
  for (const m of Object.keys(byModel)) byModel[m].usd = round(byModel[m].usd)

  return { totals, byModel, assistantMsgs, userTurns, costReported, wallClockS }
}

// ------------------------------------------- layer B: transcript enrichment

// Probe the transcript for the fields by-agent attribution needs. Returns the
// missing field names; empty means layer B is usable.
const probeTranscript = (transcriptPath) => {
  const events = readJsonl(transcriptPath)
  const assistants = events.filter((e) => e.type === 'assistant').slice(0, PROBE_LINES)
  if (assistants.length === 0) return REQUIRED_FIELDS.slice()
  const missing = []
  for (const field of REQUIRED_FIELDS) {
    const present = assistants.some((e) => e[field] !== undefined && e[field] !== null)
    if (!present) missing.push(field)
  }
  return missing
}

// Build one spawn record from a subagent transcript file (one file = one spawn).
const parseSpawnFile = (path, seq, degraded) => {
  const events = readJsonl(path).filter((e) => e.type === 'assistant' && e.message)
  if (events.length === 0) return null
  const agent = events[0].attributionAgent || events[0].agentType || 'unknown'
  const firstU = readUsage(events[0].message.usage)
  let roundTrips = 0
  let output = 0
  const totals = emptyTotals()
  for (const ev of events) {
    roundTrips++
    const u = readUsage(ev.message.usage)
    output += u.output
    addUsage(totals, u, ev.message.model || 'unknown', degraded)
  }
  return {
    agent,
    seq,
    first_call_cache_creation: firstU.cache_write_5m + firstU.cache_write_1h,
    cache_read_on_first_call: firstU.cache_read,
    round_trips: roundTrips,
    output,
    usd: round(totals.usd),
  }
}

const enrichFromLayerB = (transcriptPath, subagentsDir, degraded) => {
  const missing = probeTranscript(transcriptPath)
  if (missing.length) {
    for (const f of missing) if (!degraded.includes(f)) degraded.push(f)
    warn(
      `layer-B transcript is missing required field(s): ${missing.join(', ')} — ` +
        'degrading to layer A only. Totals are correct; by_agent / spawns are omitted. ' +
        'The transcript format is internal and may have drifted (TRANSCRIPT_SCHEMA=' +
        `${TRANSCRIPT_SCHEMA}).`,
    )
    return { by_agent: {}, spawns: [] }
  }

  const spawns = []
  if (subagentsDir && existsSync(subagentsDir)) {
    const files = readdirSync(subagentsDir)
      .filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'))
      .sort()
    let seq = 0
    for (const f of files) {
      seq++
      const spawn = parseSpawnFile(join(subagentsDir, f), seq, degraded)
      if (spawn) spawns.push(spawn)
    }
  }

  const by_agent = {}
  for (const s of spawns) {
    const a = (by_agent[s.agent] = by_agent[s.agent] || { spawns: 0, boot_mean: 0, output: 0, usd: 0 })
    a.spawns++
    a.boot_mean += s.first_call_cache_creation
    a.output += s.output
    a.usd += s.usd
  }
  for (const a of Object.keys(by_agent)) {
    const row = by_agent[a]
    row.boot_mean = row.spawns ? Math.round(row.boot_mean / row.spawns) : 0
    row.usd = round(row.usd)
  }

  return { by_agent, spawns }
}

// ----------------------------------------------------------- record builder

const buildRecord = ({ streamPath, transcriptPath, subagentsDir, lane, label }) => {
  if (!streamPath || !existsSync(streamPath)) die(2, `--stream file not found: ${streamPath}`)
  const degraded = []

  const a = parseStream(streamPath, degraded)
  const t = a.totals

  let by_agent = {}
  let spawns = []
  if (transcriptPath) {
    if (!existsSync(transcriptPath)) die(2, `--transcript file not found: ${transcriptPath}`)
    ;({ by_agent, spawns } = enrichFromLayerB(transcriptPath, subagentsDir, degraded))
  }

  const billed = t.billed_input_equivalent
  const naive = naiveModelTokens(t)
  const inputSide = t.input + t.cache_write_5m + t.cache_write_1h + t.cache_read
  const bootTotal = spawns.reduce((s, x) => s + x.first_call_cache_creation, 0)

  const record = {
    schema: SCHEMA,
    label: label || null,
    session: null,
    harness_ref: null,
    lane: lane || null,
    wall_clock_s: round(a.wallClockS, 3),
    totals: {
      input: t.input,
      cache_write_5m: t.cache_write_5m,
      cache_write_1h: t.cache_write_1h,
      cache_read: t.cache_read,
      output: t.output,
      thinking: t.thinking,
      billed_input_equivalent: Math.round(billed),
      usd: round(t.usd),
    },
    derived: {
      cache_hit_ratio: inputSide ? round(t.cache_read / inputSide, 4) : 0,
      spawns: spawns.length,
      boot_tokens_total: bootTotal,
      boot_tokens_mean: spawns.length ? Math.round(bootTotal / spawns.length) : 0,
      round_trips_per_turn_mean: a.userTurns ? round(a.assistantMsgs / a.userTurns, 3) : 0,
      naive_model_tokens: Math.round(naive),
      overstatement_factor: billed ? round(naive / billed, 4) : 0,
      cost_usd_reported: a.costReported,
    },
    by_agent,
    by_model: a.byModel,
    spawns,
    degraded,
  }
  return record
}

// --------------------------------------------------------------- subcommands

if (command === 'report') {
  const record = buildRecord({
    streamPath: flags.stream,
    transcriptPath: typeof flags.transcript === 'string' ? flags.transcript : null,
    subagentsDir: typeof flags.subagents === 'string' ? flags.subagents : null,
    lane: typeof flags.lane === 'string' ? flags.lane : null,
    label: typeof flags.label === 'string' ? flags.label : null,
  })
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`)
  process.exit(0)
}

if (command === 'record') {
  const record = buildRecord({
    streamPath: flags.stream,
    transcriptPath: typeof flags.transcript === 'string' ? flags.transcript : null,
    subagentsDir: typeof flags.subagents === 'string' ? flags.subagents : null,
    lane: typeof flags.lane === 'string' ? flags.lane : null,
    label: typeof flags.label === 'string' ? flags.label : null,
  })
  const store = typeof flags.store === 'string' ? flags.store : '.agentic-sdlc/meter'
  mkdirSync(store, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `${(record.label || 'run').replace(/[^\w.-]/g, '_')}-${stamp}.json`
  const out = join(store, name)
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`)
  process.stdout.write(`${out}\n`)
  process.exit(0)
}

if (command === 'enrich') {
  if (typeof flags.record !== 'string' || !existsSync(flags.record)) {
    die(2, `enrich needs --record <file>\n${USAGE}`)
  }
  if (typeof flags.transcript !== 'string' || !existsSync(flags.transcript)) {
    die(2, `enrich needs --transcript <file>\n${USAGE}`)
  }
  const record = JSON.parse(readFileSync(flags.record, 'utf8'))
  record.degraded = record.degraded || []
  const subagentsDir = typeof flags.subagents === 'string' ? flags.subagents : null
  const { by_agent, spawns } = enrichFromLayerB(flags.transcript, subagentsDir, record.degraded)
  record.by_agent = by_agent
  record.spawns = spawns
  const bootTotal = spawns.reduce((s, x) => s + x.first_call_cache_creation, 0)
  record.derived.spawns = spawns.length
  record.derived.boot_tokens_total = bootTotal
  record.derived.boot_tokens_mean = spawns.length ? Math.round(bootTotal / spawns.length) : 0
  writeFileSync(flags.record, `${JSON.stringify(record, null, 2)}\n`)
  process.stdout.write(`enriched ${flags.record} (${spawns.length} spawns)\n`)
  process.exit(0)
}

if (command === 'boot') {
  if (typeof flags.agent !== 'string') die(2, `boot needs --agent <name>\n${USAGE}`)
  const record = buildRecord({
    streamPath: flags.stream,
    transcriptPath: typeof flags.transcript === 'string' ? flags.transcript : null,
    subagentsDir: typeof flags.subagents === 'string' ? flags.subagents : null,
    lane: typeof flags.lane === 'string' ? flags.lane : null,
    label: null,
  })
  const spawns = record.spawns.filter((s) => s.agent === flags.agent)
  if (spawns.length === 0) {
    warn(`no spawns for agent "${flags.agent}" (need layer B: --transcript and --subagents)`)
    process.stdout.write(`agent=${flags.agent} spawns=0 boot_mean=0\n`)
    process.exit(0)
  }
  const total = spawns.reduce((s, x) => s + x.first_call_cache_creation, 0)
  const readTotal = spawns.reduce((s, x) => s + x.cache_read_on_first_call, 0)
  const bootMean = Math.round(total / spawns.length)
  const sharedPrefix = spawns.slice(1).some((s) => s.cache_read_on_first_call > 0)
  process.stdout.write(
    `agent=${flags.agent} spawns=${spawns.length} boot_mean=${bootMean} ` +
      `first_call_cache_read_total=${readTotal} cross_spawn_prefix_sharing=${sharedPrefix}\n`,
  )
  process.exit(0)
}

if (command === 'diff') {
  if (typeof flags.baseline !== 'string' || !existsSync(flags.baseline)) {
    die(2, `diff needs --baseline <record.json>\n${USAGE}`)
  }
  if (typeof flags.candidate !== 'string' || !existsSync(flags.candidate)) {
    die(2, `diff needs --candidate <record.json>\n${USAGE}`)
  }
  const base = JSON.parse(readFileSync(flags.baseline, 'utf8'))
  const cand = JSON.parse(readFileSync(flags.candidate, 'utf8'))
  const rows = []
  const signed = (n) => (n >= 0 ? `+${round(n)}` : `${round(n)}`)
  const pct = (b, c) => (b ? signed(((c - b) / b) * 100) + '%' : 'n/a')
  const emit = (label, b, c) => rows.push(`${label}: ${b} → ${c}  (${signed(c - b)}, ${pct(b, c)})`)
  emit('billed_input_equivalent', base.totals.billed_input_equivalent, cand.totals.billed_input_equivalent)
  emit('output', base.totals.output, cand.totals.output)
  emit('usd', base.totals.usd, cand.totals.usd)
  emit('boot_tokens_total', base.derived.boot_tokens_total, cand.derived.boot_tokens_total)
  emit('boot_tokens_mean', base.derived.boot_tokens_mean, cand.derived.boot_tokens_mean)
  emit('spawns', base.derived.spawns, cand.derived.spawns)
  emit('round_trips_per_turn_mean', base.derived.round_trips_per_turn_mean, cand.derived.round_trips_per_turn_mean)
  emit('overstatement_factor', base.derived.overstatement_factor, cand.derived.overstatement_factor)
  process.stdout.write(`${rows.join('\n')}\n`)
  process.exit(0)
}

if (command === 'capture') {
  if (typeof flags.out !== 'string') die(2, `capture needs --out <file>\n${USAGE}`)
  if (positional.length === 0) die(2, `capture needs claude args after --\n${USAGE}`)
  const args = positional.slice()
  // Ensure the stream format the parser expects, without clobbering an explicit one.
  if (!args.includes('--output-format')) args.push('--output-format', 'stream-json', '--verbose')
  const res = spawnSync('claude', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  if (res.error) die(1, `failed to run claude: ${res.error.message}`)
  writeFileSync(flags.out, res.stdout || '')
  if (res.stderr) process.stderr.write(res.stderr)
  process.stdout.write(`captured → ${flags.out}\n`)
  process.exit(res.status ?? 0)
}

die(2, `unknown command: ${command}\n${USAGE}`)
