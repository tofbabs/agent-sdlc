#!/usr/bin/env node
//
// run-report-categories.mjs — the one place every run-report enum value lives.
//
// WHY ONE MODULE
//
// ADR 0001 (docs/adr/0001-run-report-schema-and-vocabulary.md) makes vocabulary
// drift impossible by construction rather than by review: run-report.mjs's
// schema validator imports these sets instead of hardcoding them a second
// time, and an agent that needs to know what token to write reads this file
// directly — `node run-report-categories.mjs` prints every vocabulary as JSON.
// It is deliberately not boot-path content (scripts/size-budget.json only
// covers agents/*.md and commands/*.md); agents read it on demand instead.
//
// Zero dependencies, Node 22 (the repo floor).

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Closed sets: the pipeline cannot produce a value outside these, so there is
// no `other` escape — an unrecognised token here is a bug, not drift.
export const CLOSED = Object.freeze({
  command: Object.freeze(['plan', 'build', 'review']),
  lane: Object.freeze(['deliberate', 'fast']),
  outcome: Object.freeze(['completed', 'blocked', 'aborted']),
  mode: Object.freeze(['SOLO', 'PAIR', 'FAST']),
  verdict: Object.freeze(['APPROVE', 'REQUEST_CHANGES', 'COMMENT', 'NONE']),
  severity: Object.freeze(['BLOCKER', 'MAJOR', 'MINOR']),
  risk: Object.freeze(['LOW', 'MEDIUM', 'HIGH']),
})

// Open sets: a deterministic script cannot classify prose (ADR 0001 Context),
// so the agent writing the artifact tags one token at source; the builder
// parses the token and never the surrounding text. `other` is the last
// member of each so a missing or stale tag still counts, never rejects.
export const OPEN = Object.freeze({
  arch_category: Object.freeze([
    'contract',
    'data',
    'lifecycle',
    'dependency',
    'security',
    'cost',
    'process',
    'other',
  ]),
  finding_category: Object.freeze([
    'correctness',
    'testing',
    'security',
    'performance',
    'consistency',
    'clarity',
    'process',
    'other',
  ]),
  debt_category: Object.freeze([
    'missing_test',
    'hardcoded_value',
    'stubbed_integration',
    'deferred_migration',
    'robustness',
    'observability',
    'other',
  ]),
})

// Closed despite naming *missing* inputs: the build script enumerates exactly
// these sources and never an arbitrary one, so there is nothing for an
// `other` escape to catch.
export const DEGRADED_INPUT = Object.freeze([
  'run_state',
  'meter_record',
  'backlog_file',
  'pair_sessions',
  'pr_comments',
  'debt_ledger',
  'gate_history',
  'plugin_version',
])

const ALL = Object.freeze({ ...CLOSED, ...OPEN, degraded_input: DEGRADED_INPUT })

export function isMember(vocabName, value) {
  const set = ALL[vocabName]
  if (!set) throw new Error(`run-report-categories: unknown vocabulary "${vocabName}"`)
  return set.includes(value)
}

// Open vocabularies only — ADR 0001 requires a missing or unrecognised tag to
// map to `other` deterministically, never to reject the report.
export function toCategory(vocabName, token) {
  if (!(vocabName in OPEN)) {
    throw new Error(`run-report-categories: "${vocabName}" is not an open vocabulary`)
  }
  return OPEN[vocabName].includes(token) ? token : 'other'
}

export default ALL

// Compared by realpath: import.meta.url is already resolved, so a symlinked
// invocation (a plugin cache link) would otherwise never match argv[1].
const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return false
  }
})()
if (isMain) {
  process.stdout.write(`${JSON.stringify(ALL, null, 2)}\n`)
}
