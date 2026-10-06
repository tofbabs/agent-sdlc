#!/usr/bin/env bash
#
# decisions.test.sh — the decision record: a stable ID derived per ADR-0002, a
# machine-local store under the git common dir that is idempotent on the
# identity tuple (STORY-2-8 AC1/AC2), and a clean correction-layer writer for
# STORY-2-6/2-7 to call. The run report's optional `decisions` section and its
# fourth whitelisted string pattern are exercised in run-report.test.sh.
#
# Node one-liners from bash — this repo's existing *.test.sh style, no runner.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEC="$ROOT/plugins/agentic-sdlc/scripts/decisions.mjs"
CAT="$ROOT/plugins/agentic-sdlc/scripts/run-report-categories.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  \xe2\x9c\x93 %s\n' "$*"; }
bad() { printf '  \xe2\x9c\x97 %s\n' "$*" >&2; fail=1; }

# 1. decision_id derivation (ADR-0002 Identity B): the first 16 hex of
#    sha256("<run_id>\n<layer>\n<subject>[\n<seq>]"). The expected value is
#    computed here straight from the ADR formula, so the test pins the format —
#    which components, newline-joined, 16 lowercase hex — not an implementation
#    echo. seq is appended only when present (its decimal string), so a
#    seq-bearing correction and a seqless decision on the same subject differ.
#    The ID matches ^[0-9a-f]{16}$, re-derives identically (AC2's foundation),
#    and changes when any one tuple component changes.
node --input-type=module -e "
  import { createHash } from 'node:crypto'
  import { decisionId } from '$DEC'
  const formula = (parts) => createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16)

  const run_id = '11111111-2222-4333-8444-555555555555'

  // Seqless: subject is the story ID or the literal 'lane'.
  const lane = decisionId({ run_id, layer: 'lane', subject: 'lane' })
  if (lane !== formula([run_id, 'lane', 'lane'])) { console.error('seqless id must be sha256 of run_id\\\\nlayer\\\\nsubject, got ' + lane); process.exit(1) }
  const story = decisionId({ run_id, layer: 'score', subject: 'STORY-2-8' })
  if (story !== formula([run_id, 'score', 'STORY-2-8'])) { console.error('seqless story id wrong, got ' + story); process.exit(1) }

  // seq present: appended as its decimal string, so the hashed tuple ends \\n<seq>.
  const corr = decisionId({ run_id, layer: 'correction', subject: 'STORY-2-8', seq: 2 })
  if (corr !== formula([run_id, 'correction', 'STORY-2-8', '2'])) { console.error('seq id must append the decimal seq, got ' + corr); process.exit(1) }

  // A seq-bearing id must differ from the same tuple without a seq.
  const corrNoSeq = decisionId({ run_id, layer: 'correction', subject: 'STORY-2-8' })
  if (corr === corrNoSeq) { console.error('a seq must change the id vs the seqless tuple'); process.exit(1) }

  // Pattern: exactly 16 lowercase hex.
  for (const id of [lane, story, corr]) {
    if (!/^[0-9a-f]{16}\$/.test(id)) { console.error('id must match ^[0-9a-f]{16}\$, got ' + id); process.exit(1) }
  }

  // Re-derivation is identical — the resumed-run idempotency AC2 rests on.
  if (decisionId({ run_id, layer: 'score', subject: 'STORY-2-8' }) !== story) { console.error('re-deriving the same tuple must give the same id'); process.exit(1) }

  // Any one component change changes the id.
  const variants = [
    decisionId({ run_id: '99999999-2222-4333-8444-555555555555', layer: 'score', subject: 'STORY-2-8' }),
    decisionId({ run_id, layer: 'override', subject: 'STORY-2-8' }),
    decisionId({ run_id, layer: 'score', subject: 'STORY-2-9' }),
  ]
  for (const v of variants) {
    if (v === story) { console.error('changing a tuple component must change the id, collision on ' + v); process.exit(1) }
  }
" && ok "decision_id is the 16-hex sha256 of the ADR-0002 tuple, seq-sensitive and stable" \
  || bad "decision_id derivation wrong"

# 2. The store (ADR-0002 Store C): one JSON per decision at
#    <git common dir>/agentic-sdlc/decisions/<decision_id>.json, resolved via
#    `git rev-parse --git-common-dir` so every worktree of the repo sees the same
#    store (the exact boundary /build's cascade crosses). The writer looks the
#    identity tuple up before writing: same tuple → the EXISTING record, never a
#    duplicate and never clobbered by a later call's differing non-identity fields
#    (AC1 write, AC2 resumed-run idempotency). The record is the join authority:
#    it holds the identity tuple in clear (run_id, subject) — which the report may
#    not — plus layer/rubric/floor/score and the input enums, choice/alternative,
#    overridden/fallback, state `open`, an empty outcome_events array, verdict null.
REPO="$TMP/repo"
git init -q "$REPO"
git -C "$REPO" -c user.name=t -c user.email=t@t -c commit.gpgsign=false -c core.hooksPath=/dev/null \
  commit -q --allow-empty -m init
# A linked worktree: writing from here must still land in the main repo's store.
git -C "$REPO" worktree add -q "$TMP/wt" -b feat/STORY-2-8 2>/dev/null

ID=$(node --input-type=module -e "
  import { decisionId, writeDecision } from '$DEC'
  const WT = process.argv[1], REPO = process.argv[2]
  const run_id = '11111111-2222-4333-8444-555555555555'
  const base = {
    run_id, layer: 'score', subject: 'STORY-2-8', rubric: 4, floor: null,
    score: 7, inputs: { lane: 'deliberate', floor_hit: false },
    choice: 'PAIR', alternative: 'SOLO', overridden: false, fallback: false,
  }
  const must = (c, m) => { if (!c) { console.error(m); process.exit(1) } }
  const id = decisionId({ run_id, layer: 'score', subject: 'STORY-2-8' })

  // First write, from the story worktree.
  const rec1 = writeDecision(base, { cwd: WT })
  must(rec1.decision_id === id, 'record decision_id must equal decisionId(tuple), got ' + rec1.decision_id)
  must(rec1.run_id === run_id && rec1.subject === 'STORY-2-8', 'identity tuple (run_id, subject) must be stored in clear')
  must(rec1.layer === 'score' && rec1.rubric === 4 && rec1.floor === null && rec1.score === 7, 'layer/rubric/floor/score must round-trip')
  must(rec1.choice === 'PAIR' && rec1.alternative === 'SOLO' && rec1.overridden === false && rec1.fallback === false, 'choice/alternative/overridden/fallback must round-trip')
  must(JSON.stringify(rec1.inputs) === JSON.stringify(base.inputs), 'the input enums must be stored on the record')
  must(rec1.state === 'open', 'a new record is state open, got ' + rec1.state)
  must(Array.isArray(rec1.outcome_events) && rec1.outcome_events.length === 0, 'a new record carries an empty outcome_events array')
  must(rec1.verdict === null, 'a new record has verdict null, got ' + String(rec1.verdict))

  // AC2: the same tuple reached again — here from the main worktree, standing in
  // for a resumed build — returns the stored record; differing non-identity
  // fields (score, choice) must NOT overwrite it.
  const rec2 = writeDecision({ ...base, score: 999, choice: 'SOLO' }, { cwd: REPO })
  must(rec2.decision_id === id, 'the resumed write must resolve the same decision_id')
  must(rec2.score === 7 && rec2.choice === 'PAIR', 'the resumed write must return the stored record, never clobber it')
  process.stdout.write(id)
" "$TMP/wt" "$REPO"); rc=$?

if [ "$rc" -eq 0 ]; then
  ok "writeDecision returns an open record: identity tuple in clear, empty outcome_events, null verdict, report fields round-tripped"
  DECDIR="$REPO/.git/agentic-sdlc/decisions"
  [ -f "$DECDIR/$ID.json" ] \
    && ok "persisted to <git common dir>/agentic-sdlc/decisions/<id>.json, shared across worktrees" \
    || bad "no record at $DECDIR/$ID.json (git-common-dir not resolved from the worktree)"
  n=$(ls -1 "$DECDIR" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" = "1" ] && ok "a tuple reached twice yields exactly one record — no duplicate (AC2)" \
    || bad "expected exactly 1 record file, found $n"
else
  bad "writeDecision store write / idempotent lookup wrong"
fi

# 3. The correction-layer writer (brief: STORY-2-6/2-7 CALL this). A runtime
#    correction is a decision in layer `correction` carrying the trigger that
#    fired it, the mode it moved from, the mode it moved to, and a `seq` ordinal
#    because one subject can be corrected more than once in a run. The writer is
#    a thin, named wrapper over the store: it fixes layer to `correction`, feeds
#    seq into the ID so each correction on a subject is its own record, maps
#    to→choice / from→alternative (the report's mode tokens) and the trigger onto
#    the input enums, defaults rubric/floor/score to null (a correction is not
#    rubric-scored) and overridden/fallback to false, and inherits the store's
#    tuple idempotency so a resumed run re-reaching (run_id, subject, seq) gets
#    the one record back — never a duplicate, never clobbered.
REPO2="$TMP/repo2"
git init -q "$REPO2"
git -C "$REPO2" -c user.name=t -c user.email=t@t -c commit.gpgsign=false -c core.hooksPath=/dev/null \
  commit -q --allow-empty -m init
git -C "$REPO2" worktree add -q "$TMP/wt2" -b feat/STORY-2-6 2>/dev/null

node --input-type=module -e "
  import { decisionId, recordCorrection } from '$DEC'
  import { CLOSED } from '$CAT'
  const WT = process.argv[1], REPO = process.argv[2]
  const must = (c, m) => { if (!c) { console.error(m); process.exit(1) } }
  const run_id = '11111111-2222-4333-8444-555555555555'

  // First correction on a subject, seq 1, written from the story worktree.
  const c1 = recordCorrection(
    { run_id, subject: 'STORY-2-6', seq: 1, trigger: 'blocked_twice', from: 'SOLO', to: 'PAIR' },
    { cwd: WT },
  )
  must(c1.decision_id === decisionId({ run_id, layer: 'correction', subject: 'STORY-2-6', seq: 1 }),
    'id must be the correction tuple incl seq, got ' + c1.decision_id)
  must(c1.layer === 'correction', 'layer must be fixed to correction, got ' + c1.layer)
  must(c1.run_id === run_id && c1.subject === 'STORY-2-6' && c1.seq === 1,
    'identity tuple (run_id, subject, seq) must be stored in clear')
  must(CLOSED.correction_trigger.includes(c1.inputs.trigger) && c1.inputs.trigger === 'blocked_twice',
    'the trigger must be stored as a correction_trigger token on the input enums')
  must(c1.choice === 'PAIR' && c1.alternative === 'SOLO',
    'to maps to choice, from maps to alternative (the report mode tokens)')
  must(c1.rubric === null && c1.floor === null && c1.score === null,
    'a correction is not rubric-scored: rubric/floor/score default null')
  must(c1.overridden === false && c1.fallback === false, 'overridden/fallback default false')
  must(c1.state === 'open' && Array.isArray(c1.outcome_events) && c1.outcome_events.length === 0 && c1.verdict === null,
    'a correction opens like any decision: open, empty events, null verdict')

  // seq makes a second correction on the same subject a distinct record.
  const c2 = recordCorrection(
    { run_id, subject: 'STORY-2-6', seq: 2, trigger: 'gate_failed_same_ac', from: 'PAIR', to: 'SOLO' },
    { cwd: WT },
  )
  must(c2.decision_id !== c1.decision_id, 'a higher seq must mint a new record, not return the first')

  // AC2 idempotency inherited: the same (run_id, subject, seq) re-reached — here
  // from the main worktree, standing in for a resumed run — returns the stored
  // record; a differing trigger/to must not overwrite it.
  const again = recordCorrection(
    { run_id, subject: 'STORY-2-6', seq: 1, trigger: 'deferred_one_way', from: 'PAIR', to: 'SOLO' },
    { cwd: REPO },
  )
  must(again.decision_id === c1.decision_id, 'the resumed correction must resolve the first record id')
  must(again.inputs.trigger === 'blocked_twice' && again.choice === 'PAIR',
    'the resumed correction must return the stored record, never clobber it')
" "$TMP/wt2" "$REPO2"; rc=$?

if [ "$rc" -eq 0 ]; then
  ok "recordCorrection writes a layer-correction record: seq-distinct id, trigger + from/to mapped, store idempotency inherited"
  DECDIR2="$REPO2/.git/agentic-sdlc/decisions"
  n=$(ls -1 "$DECDIR2" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" = "2" ] && ok "two seqs → two records; the resumed seq-1 call adds none (AC2)" \
    || bad "expected 2 correction records, found $n"
else
  bad "correction-layer writer wrong"
fi

# 4. The store reader (brief: "the report should list decisions whose run_id =
#    this run"). readDecisions(run_id, { cwd }) is the inverse of writeDecision:
#    it resolves the SAME shared git-common-dir store — so a report built from
#    one worktree sees records written from another — and returns the FULL
#    stored records (identity tuple and all; the report projects/strips later)
#    for exactly the asked run_id, never another run's. Order is deterministic
#    (sorted by decision_id) so two builds of the same store are byte-identical,
#    and an absent/empty store reads as [] (the signal that lets the report omit
#    the section entirely rather than carry an empty array).
REPO3="$TMP/repo3"
git init -q "$REPO3"
git -C "$REPO3" -c user.name=t -c user.email=t@t -c commit.gpgsign=false -c core.hooksPath=/dev/null \
  commit -q --allow-empty -m init
git -C "$REPO3" worktree add -q "$TMP/wt3" -b feat/STORY-2-8 2>/dev/null

# A fresh repo whose store was never written must read as [] — the omit signal.
EMPTY="$TMP/repo-empty"
git init -q "$EMPTY"
git -C "$EMPTY" -c user.name=t -c user.email=t@t -c commit.gpgsign=false -c core.hooksPath=/dev/null \
  commit -q --allow-empty -m init

node --input-type=module -e "
  import { decisionId, writeDecision, readDecisions } from '$DEC'
  const WT = process.argv[1], REPO = process.argv[2], EMPTY = process.argv[3]
  const must = (c, m) => { if (!c) { console.error(m); process.exit(1) } }
  const runA = '11111111-2222-4333-8444-555555555555'
  const runB = '99999999-2222-4333-8444-555555555555'
  const base = { rubric: 4, floor: null, score: 7, inputs: {}, choice: 'PAIR', alternative: 'SOLO', overridden: false, fallback: false }

  // Three decisions for run A (written from the story worktree) and one for a
  // different run B — readDecisions(runA) must return A's three, never B's.
  const a1 = writeDecision({ ...base, run_id: runA, layer: 'score', subject: 'STORY-2-8' }, { cwd: WT })
  const a2 = writeDecision({ ...base, run_id: runA, layer: 'override', subject: 'STORY-2-8' }, { cwd: WT })
  const a3 = writeDecision({ ...base, run_id: runA, layer: 'lane', subject: 'lane', choice: 'deliberate', alternative: 'fast' }, { cwd: WT })
  writeDecision({ ...base, run_id: runB, layer: 'score', subject: 'STORY-2-8' }, { cwd: WT })

  // Read from the MAIN checkout: the store is the shared common dir, so records
  // written from the worktree must be visible here (and vice versa).
  const got = readDecisions(runA, { cwd: REPO })
  must(Array.isArray(got), 'readDecisions must return an array')
  must(got.length === 3, 'readDecisions(runA) must return exactly run A\\'s three records, got ' + got.length)
  must(got.every((r) => r.run_id === runA), 'readDecisions must return only the asked run_id, never another run\\'s')

  // Full stored records, not a projection: the reader is the store's inverse;
  // stripping identity and mapping tokens is the report builder's job.
  const byId = Object.fromEntries(got.map((r) => [r.decision_id, r]))
  const score = byId[a1.decision_id]
  must(score && score.subject === 'STORY-2-8' && score.layer === 'score' && score.state === 'open', 'records are returned whole, identity tuple included')

  // Deterministic order: sorted by decision_id, so two builds match byte for byte.
  const ids = got.map((r) => r.decision_id)
  const sorted = [...ids].sort()
  must(JSON.stringify(ids) === JSON.stringify(sorted), 'readDecisions must return records sorted by decision_id, got ' + ids.join(','))
  must(new Set(ids).size === 3 && ids.includes(a2.decision_id) && ids.includes(a3.decision_id), 'all three of run A\\'s ids must be present')

  // An absent/empty store reads as [] — not a throw, not undefined.
  must(JSON.stringify(readDecisions(runA, { cwd: EMPTY })) === '[]', 'an unwritten store must read as []')
" "$TMP/wt3" "$REPO3" "$EMPTY"; rc=$?

[ "$rc" -eq 0 ] \
  && ok "readDecisions returns this run's whole records from the shared store, sorted and run-scoped; empty store → []" \
  || bad "store reader wrong"

[ "$fail" -eq 0 ] || { printf '\ndecisions tests failed\n' >&2; exit 1; }
printf '\ndecisions tests passed\n'
