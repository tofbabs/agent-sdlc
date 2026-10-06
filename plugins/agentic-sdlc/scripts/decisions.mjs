#!/usr/bin/env node
//
// decisions.mjs — the decision record. The ID is the join key every outcome
// event and verdict hangs off, so its derivation is fixed by ADR-0002 and must
// not drift: a resumed run re-derives the same ID rather than minting a copy.
//
// Zero dependencies, Node 22 (the repo floor).

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// The seq is hashed only when present: a seq-bearing correction and a seqless
// decision on the same subject must not collide.
export function decisionId({ run_id, layer, subject, seq }) {
  const parts = [run_id, layer, subject]
  if (seq !== undefined) parts.push(String(seq))
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16)
}

// The store is shared by every worktree of the repo: /build's cascade crosses
// worktrees, and a decision written in one must be found from another. The
// common git dir is the one place they all agree on; a worktree reports it as
// an absolute path, the main checkout as a path relative to where it ran.
function storeDir(cwd) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
  }).trim()
  return join(resolve(cwd, common), 'agentic-sdlc', 'decisions')
}

// Returns the record already stored for this identity tuple when there is one,
// untouched: a resumed run must not overwrite the decision it is resuming.
export function writeDecision(fields, { cwd = process.cwd() } = {}) {
  const decision_id = decisionId(fields)
  const dir = storeDir(cwd)
  const file = join(dir, decision_id + '.json')

  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))

  const record = {
    decision_id,
    run_id: fields.run_id,
    subject: fields.subject,
    // Kept in clear so the identity tuple is recoverable from the record alone.
    ...(fields.seq !== undefined && { seq: fields.seq }),
    layer: fields.layer,
    rubric: fields.rubric,
    floor: fields.floor,
    score: fields.score,
    inputs: fields.inputs,
    choice: fields.choice,
    alternative: fields.alternative,
    overridden: fields.overridden,
    fallback: fields.fallback,
    // Stored, not exported: outcome routing needs to tell which of a subject's
    // runs is the latest, and nothing else on the record orders them.
    created_at: fields.created_at ?? new Date().toISOString(),
    state: 'open',
    outcome_events: [],
    verdict: null,
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n')
  return record
}

// False when there is nothing to read — not a git checkout, or no decision
// written yet — so a reader can tell an absent store from a broken one.
export function decisionStoreExists({ cwd = process.cwd() } = {}) {
  try {
    return existsSync(storeDir(cwd))
  } catch {
    return false
  }
}

function readFile(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function writeRecord(record, cwd) {
  writeFileSync(join(storeDir(cwd), record.decision_id + '.json'), JSON.stringify(record, null, 2) + '\n')
  return record
}

// Outcome joins and the sweep span runs, so they read the whole store rather
// than one run's slice. Sorted for the same byte-identical-rebuild reason.
export function readAllDecisions({ cwd = process.cwd() } = {}) {
  const dir = storeDir(cwd)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readFile(join(dir, name)))
    .sort((a, b) => (a.decision_id < b.decision_id ? -1 : a.decision_id > b.decision_id ? 1 : 0))
}

function readOne(decision_id, cwd) {
  const file = join(storeDir(cwd), decision_id + '.json')
  if (!existsSync(file)) throw new Error(`decisions: no record ${decision_id}`)
  return readFile(file)
}

// An event with a `ref` already on the record is skipped, so a re-run sweep
// finds the same merge or fix and attaches it once. A closed or orphaned
// record takes no further events: its verdict was computed without them.
export function appendEvent(decision_id, event, { cwd = process.cwd() } = {}) {
  const record = readOne(decision_id, cwd)
  if (record.state !== 'open') return { appended: false, record }
  if (event.ref !== undefined && record.outcome_events.some((e) => e.ref === event.ref)) {
    return { appended: false, record }
  }
  record.outcome_events.push(event)
  return { appended: true, record: writeRecord(record, cwd) }
}

// settled_run_id names the run whose verdict pass closed it: often a later run
// than the one that decided, and the only report the verdict can still reach.
export function closeDecision(decision_id, { verdict, rubric, at, run_id }, { cwd = process.cwd() } = {}) {
  const record = readOne(decision_id, cwd)
  return writeRecord(
    {
      ...record,
      state: 'closed',
      verdict,
      verdict_rubric: rubric,
      closed_at: at,
      ...(run_id != null && { settled_run_id: run_id }),
    },
    cwd,
  )
}

export function orphanDecision(decision_id, { reason, at }, { cwd = process.cwd() } = {}) {
  const record = readOne(decision_id, cwd)
  return writeRecord({ ...record, state: 'orphaned', orphan_reason: reason, closed_at: at }, cwd)
}

// The report lists a run's decisions from whichever worktree it is built in, so
// this reads the same shared store writeDecision wrote to. Sorted by decision_id
// so two builds over the same store are byte-identical; an unwritten store is
// simply no decisions, not an error.
export function readDecisions(run_id, { cwd = process.cwd() } = {}) {
  const dir = storeDir(cwd)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')))
    .filter((record) => record.run_id === run_id)
    .sort((a, b) => (a.decision_id < b.decision_id ? -1 : a.decision_id > b.decision_id ? 1 : 0))
}

// A correction is not rubric-scored, so its rubric/floor/score stay null and
// it is never overridden or a fallback. seq is the ordinal that lets one
// subject be corrected more than once in a run without the records colliding.
export function recordCorrection({ run_id, subject, seq, trigger, from, to }, opts) {
  return writeDecision(
    {
      run_id,
      subject,
      seq,
      layer: 'correction',
      rubric: null,
      floor: null,
      score: null,
      inputs: { trigger },
      choice: to,
      alternative: from,
      overridden: false,
      fallback: false,
    },
    opts,
  )
}
