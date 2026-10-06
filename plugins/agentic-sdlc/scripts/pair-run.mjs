#!/usr/bin/env node
//
// pair-run.mjs — runs one PAIR story's navigator ⇄ driver loop headless.
//
// WHY THIS IS A SCRIPT AND NOT THE ORCHESTRATOR
//
// Driven by hand, every alternation cost the orchestrator two full turns over its
// own ever-growing conversation (spawn, read status, spawn again) — on a measured
// 68-agent-turn epic that was ~75 orchestrator turns, on Opus, at the largest
// context in the run. None of those turns made a decision: the loop is
// "navigator, status, driver, repeat". So the loop lives here, each turn is a
// fresh `claude -p --agent …` process, and the orchestrator makes one call per
// story and wakes only for what needs judgment: a block, a failure, the landing.
//
// Resumable: the next role comes from `pair-log.mjs status`, so re-running after a
// crash or a usage limit continues where the story stopped.
//
// Exit codes: 0 complete · 10 blocked on an ARCH · 4 alternation cap · 5 a turn
// failed (stderr says which; re-run to resume) · 2 usage.
//
// Zero dependencies, Node 22.

import { spawnSync } from 'node:child_process'
import { existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PAIR_LOG = join(PLUGIN_ROOT, 'scripts', 'pair-log.mjs')
const REPORT_MAX_CHARS = 2000

const [, , storyId, ...rest] = process.argv
const flags = {}
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith('--')) continue
  const key = rest[i].slice(2)
  const next = rest[i + 1]
  if (next === undefined || next.startsWith('--')) flags[key] = true
  else {
    flags[key] = next
    i++
  }
}

const USAGE = `usage:
  pair-run.mjs <STORY-ID> --worktree <dir> --base <epic branch | origin/<base>>
               [--claude <bin>] [--navigator-model <m>] [--driver-model <m>]
               [--turn-budget-usd <n>]
  Extra CLI args for every turn (permissions, settings): env PAIR_RUN_CLAUDE_ARGS.`

const die = (code, msg) => {
  process.stderr.write(`pair-run: ${msg}\n`)
  process.exit(code)
}

if (!storyId || storyId.startsWith('--')) die(2, USAGE)
if (typeof flags.worktree !== 'string' || typeof flags.base !== 'string') die(2, USAGE)
const cwd = resolve(flags.worktree)
if (!existsSync(cwd)) die(2, `worktree not found: ${cwd}`)

const claude = typeof flags.claude === 'string' ? flags.claude : 'claude'
const extraArgs = (process.env.PAIR_RUN_CLAUDE_ARGS || '').split(/\s+/).filter(Boolean)
const meterDir = join(cwd, '.agentic-sdlc', 'meter')

const status = () => {
  const r = spawnSync('node', [PAIR_LOG, 'status', storyId], { cwd, encoding: 'utf8' })
  if (r.status !== 0) die(2, `pair-log status failed: ${r.stderr.trim()}`)
  return Object.fromEntries(
    r.stdout
      .trim()
      .split(/\s+/)
      .map((kv) => kv.split('=')),
  )
}

const PROMPTS = {
  navigator: `PAIR on ${storyId}. You are already in the story worktree, on the story branch off ${flags.base}; stay in it. Your only read of the pair log is \`node ${PAIR_LOG} read ${storyId} --role navigator\` (bounded: brief, STATE, last 2 entries, last commit); open source files as you need them. Review the last increment, write the failing tests for the next behaviour, refresh STATE. All ACs green → close the story in this same turn per your CLOSE step (scopes: \`git diff --stat ${flags.base}...HEAD\`). Then stop.`,
  driver: `PAIR driver turn on ${storyId}. You are already in the story worktree; stay in it. Your only read of the pair log is \`node ${PAIR_LOG} read ${storyId} --role driver\` (bounded: STATE, last 2 entries, last commit); open source files as you need them. Make the failing tests pass, implementing only what they demand; commit, log, stop.`,
}

const totals = { turns: 0, cost_usd: 0 }
let lastNavigatorReport = ''

const runTurn = (role) => {
  const model = flags[`${role}-model`]
  const args = ['-p', PROMPTS[role], '--agent', `agentic-sdlc:${role}`, '--output-format', 'json']
  if (typeof model === 'string') args.push('--model', model)
  if (typeof flags['turn-budget-usd'] === 'string') args.push('--max-budget-usd', flags['turn-budget-usd'])
  args.push(...extraArgs)

  const started = Date.now()
  const r = spawnSync(claude, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  })
  let out = null
  try {
    out = JSON.parse(r.stdout)
  } catch {
    out = null
  }
  const cost = Number(out?.total_cost_usd) || 0
  totals.turns += 1
  totals.cost_usd += cost

  // One line per turn, so a run's measured cost is on disk without anyone having
  // to read a transcript — the evidence later cost cuts are argued from.
  try {
    mkdirSync(meterDir, { recursive: true })
    appendFileSync(
      join(meterDir, `pair-run-${storyId}.jsonl`),
      `${JSON.stringify({ story: storyId, role, cost_usd: cost, num_turns: out?.num_turns ?? null, ms: Date.now() - started, ok: r.status === 0 && !out?.is_error })}\n`,
    )
  } catch {
    // Metering is advisory; a read-only tree must not stop the story.
  }

  if (r.error) die(5, `${role} turn could not start ${claude}: ${r.error.message}`)
  if (r.status !== 0 || !out || out.is_error) {
    const why = (out?.result || r.stderr || r.stdout || '').trim().slice(0, 500)
    die(5, `${role} turn failed (exit ${r.status}) — re-run to resume.\n${why}`)
  }
  if (role === 'navigator') lastNavigatorReport = String(out.result || '')
  process.stderr.write(`pair-run: ${storyId} ${role} done ($${cost.toFixed(2)})\n`)
}

const finish = (code, s) => {
  process.stdout.write(
    `${JSON.stringify(
      {
        story: storyId,
        session: s.session,
        arch: s.arch,
        alternation: s.alternation,
        agent_turns: totals.turns,
        cost_usd: Number(totals.cost_usd.toFixed(4)),
        navigator_report: lastNavigatorReport.slice(-REPORT_MAX_CHARS),
      },
      null,
      2,
    )}\n`,
  )
  process.exit(code)
}

let ran = null
for (;;) {
  const s = status()
  if (s.session === 'complete') finish(0, s)
  if (s.session === 'blocked') finish(10, s)
  // A turn that exits cleanly but never appends leaves `next` unchanged; without
  // this the loop would re-spawn the same role forever at full price.
  if (ran && s.next === ran) die(5, `${ran} turn made no pair-log entry — inspect, then re-run to resume`)
  const [n, cap] = s.alternation.split('/').map(Number)
  if (s.next === 'navigator' && n >= cap) finish(4, s)
  runTurn(s.next)
  ran = s.next
}
