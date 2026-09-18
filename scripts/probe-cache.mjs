#!/usr/bin/env node
//
// probe-cache.mjs — the A0 prefix-sharing probe. RUN THIS BEFORE ANY TRACK-C WORK.
//
// It answers two load-bearing, currently-UNVERIFIED questions that redirect the
// whole cost programme:
//
//   1. Do two FRESH spawns of the same agent type share a server-side cache prefix?
//      If yes, per-spawn boot collapses to 0.10x after the first spawn and cache
//      stabilisation becomes the biggest lever in the repo. If no, trimming the
//      per-agent tool surface is the top lever and per-spawn boot is the thing to
//      attack. The direct signal is cache_read_input_tokens > 0 on the FIRST API
//      call of spawn #2+ of the same type.
//
//   2. Is the injected cwd / git-branch / git-state block INSIDE the cached prefix?
//      If it is, per-story worktrees bust the prefix on nearly every spawn — which
//      would make prefix stabilisation worth more than every prose edit combined.
//
// This is NOT run in CI and has no fixture test: it spends real API budget (~$5,
// under an hour) and its output is empirical, not deterministic. Record the answer
// in docs/superpowers/specs/2026-09-17-meter-and-benchmark-design.md — it is the
// most reusable artifact this programme produces.
//
// Zero dependencies, Node 22. Requires the `claude` CLI on PATH.
//
//   node scripts/probe-cache.mjs --mode temporal  [--out probe-temporal.json]
//   node scripts/probe-cache.mjs --mode worktree  [--out probe-worktree.json]

import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const flags = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) {
    const next = process.argv[i + 1]
    if (next === undefined || next.startsWith('--')) flags[a.slice(2)] = true
    else (flags[a.slice(2)] = next), i++
  }
}

const die = (m) => {
  process.stderr.write(`probe-cache: ${m}\n`)
  process.exit(2)
}

if (spawnSync('claude', ['--version'], { encoding: 'utf8' }).error) {
  die('the `claude` CLI is not on PATH — this probe needs it to spawn real agents')
}

const MODE = flags.mode || 'temporal'
const AGENT = flags.agent || 'coder'

// Identical system prompt + tool surface across every spawn — only the user
// message and (in worktree mode) the cwd differ, so any cache read is attributable
// to prefix reuse, not to a coincidentally similar prompt.
const SYSTEM = `You are a ${AGENT} agent in a probe. Reply with the single word OK and stop.`
const ALLOWED = 'Read,Grep,Glob,Bash'

// The temporal spacing straddles the 5-minute subagent TTL: reuse should hold at
// 5s/60s, be marginal at ~4-6m, and be gone by 20m — so the gap where it breaks
// localises the effective TTL.
const TEMPORAL_GAPS_S = [0, 5, 60, 240, 360, 1200]

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))

// Run one spawn; return the first assistant message's cache usage.
const spawnOnce = (userMsg, cwd) => {
  const res = spawnSync(
    'claude',
    ['-p', userMsg, '--output-format', 'stream-json', '--verbose', '--append-system-prompt', SYSTEM, '--allowedTools', ALLOWED],
    { cwd: cwd || process.cwd(), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  )
  if (res.error) die(`claude failed: ${res.error.message}`)
  for (const raw of (res.stdout || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (ev.type === 'assistant' && ev.message && ev.message.usage) {
      const u = ev.message.usage
      const cc = u.cache_creation || {}
      return {
        cache_creation: (cc.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0) + (cc.ephemeral_1h_input_tokens ?? 0),
        cache_read: u.cache_read_input_tokens ?? 0,
        model: ev.message.model || 'unknown',
      }
    }
  }
  return { cache_creation: 0, cache_read: 0, model: 'unknown', note: 'no assistant usage seen' }
}

// A throwaway git worktree, to test whether cwd/git-state sits inside the prefix.
const makeWorktree = () => {
  const dir = mkdtempSync(join(tmpdir(), 'probe-wt-'))
  const r = spawnSync('git', ['worktree', 'add', '--detach', dir], { encoding: 'utf8' })
  if (r.status !== 0) die(`git worktree add failed: ${r.stderr}`)
  return dir
}
const removeWorktree = (dir) => spawnSync('git', ['worktree', 'remove', '--force', dir], { encoding: 'utf8' })

const main = async () => {
  const spawns = []

  if (MODE === 'temporal') {
    let elapsed = 0
    for (let i = 0; i < TEMPORAL_GAPS_S.length; i++) {
      const gap = TEMPORAL_GAPS_S[i]
      if (gap) await sleep(gap)
      elapsed += gap
      const u = spawnOnce(`Probe spawn ${i + 1} of the same ${AGENT} type. Say OK.`)
      spawns.push({ seq: i + 1, gap_before_s: gap, elapsed_s: elapsed, ...u })
      process.stderr.write(`  spawn ${i + 1} (+${gap}s): creation=${u.cache_creation} read=${u.cache_read}\n`)
    }
  } else if (MODE === 'worktree') {
    const variants = [
      { label: 'same-cwd', cwd: process.cwd() },
      { label: 'different-worktree', cwd: makeWorktree(), cleanup: true },
      { label: 'same-worktree', cwd: process.cwd() },
    ]
    let seq = 0
    for (const v of variants) {
      seq++
      await sleep(seq === 1 ? 0 : 5)
      const u = spawnOnce(`Probe spawn ${seq} (${v.label}). Say OK.`, v.cwd)
      spawns.push({ seq, variant: v.label, cwd: v.cwd, ...u })
      process.stderr.write(`  spawn ${seq} (${v.label}): creation=${u.cache_creation} read=${u.cache_read}\n`)
      if (v.cleanup) removeWorktree(v.cwd)
    }
  } else {
    die(`unknown --mode ${MODE} (want temporal|worktree)`)
  }

  // The verdict, stated plainly so the spec can quote it.
  const sharing = spawns.slice(1).some((s) => s.cache_read > 0)
  const verdict =
    MODE === 'temporal'
      ? sharing
        ? 'PREFIXES ARE SHARED across consecutive same-type spawns — boot collapses to 0.10x after the first. A2 (cache stabilisation) is the top lever.'
        : 'NO cross-spawn prefix sharing — every spawn pays full cache_creation. A1 (tool-surface trimming) is the top lever.'
      : sharing
        ? 'cwd / git-state does NOT bust the prefix (different-worktree spawn still read cache) — worktrees are safe.'
        : 'cwd / git-state IS in the prefix — per-story worktrees bust it on nearly every spawn. Prefix stabilisation dominates.'

  const out = { mode: MODE, agent: AGENT, ran_at: new Date().toISOString(), spawns, cross_spawn_prefix_sharing: sharing, verdict }
  const dest = flags.out || `probe-${MODE}.json`
  writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`)
  process.stdout.write(`\n${verdict}\n\nwrote ${dest}\n`)
}

main()
