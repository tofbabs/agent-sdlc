# Runtime correction

Three corrections: SOLO to PAIR, PAIR to SOLO, and FAST to deliberate.

## SOLO to PAIR

A SOLO story that proves riskier than its score predicted escalates to PAIR
mid-run. Per ARCH-3 it applies itself: no human confirmation, logged, reported.

### Observe

`mode-select.mjs observe --id <STORY>` tallies facts per story and run, and
prints `{"escalate": bool, "trigger": <token>|null, "outside"?: [files]}`.
`escalate` is true once, at the crossing. Call it from the story worktree:

| When | Flag | Fires |
|---|---|---|
| The coder reports BLOCKED | `--block` | `blocked_twice` on the 2nd |
| The coder reports a gate failure on an AC | `--gate-fail AC<n>` | `gate_failed_same_ac` on the 2nd for one AC |
| Before LAND | `--declared <file,dir/,...> --base feat/EPIC-<n>` | `edited_outside_declared` on any file outside the set you named in the prompt |

A story that trips nothing records nothing.

### Escalate

On `escalate: true`:

1. `mode-select.mjs correct --file backlog/EPIC-<n>.md --id <STORY> --from SOLO --to PAIR --trigger <trigger>`
   writes `- correction: SOLO→PAIR trigger=<t>` in the story block and a
   `correction` decision record. Repeating it is a no-op.
2. In the same worktree, `pair-log.mjs init <STORY> --brief <tmp>` with only the
   ACs still open, then run `pair-run.mjs` for the rest (PAIR LOOP).

`correct` is generic over `--from`/`--to`/`--trigger`; other corrections reuse it.

## PAIR to SOLO

`pair-run.mjs` exits **6** (`"deescalate": true`) when `pair-log.mjs status`
reports `deescalate=yes`: N alternations (rubric `pair_to_solo`, 5) with
`rejections=0`. A rejection is counted only when the navigator appends with
`--rejected`; turns.md prose is never parsed. Applies itself (ARCH-3).

1. `pair-log.mjs handoff <STORY> --base <epic branch>` freezes the test files the
   branch touched (content hashes in the session).
2. `mode-select.mjs correct --file backlog/EPIC-<n>.md --id <STORY> --from PAIR --to SOLO --trigger navigator_no_rejections`.
3. Dispatch a SOLO coder in the same worktree for the remaining ACs. Its prompt
   must say: the navigator's tests are frozen; never edit them, fix the
   implementation (or report BLOCKED if a test is wrong).
4. Before LAND: `pair-log.mjs frozen-tests <STORY>`. Exit 1 lists the changed
   tests: refuse to land, send the coder back to restore them.

## FAST to deliberate

At the end of a fast run, before the report:
`mode-select.mjs lane-check --deferred-one-way <n> --redispatch-rounds <n>`
prints `{"recommend": "deliberate"|null, "trigger": ...}`. Thresholds are in the
rubric (`fast_to_deliberate`): 2 deferred one-way items, or a second re-dispatch
round. On a recommendation, record it and say so in the report; the current run
stays fast.

`mode-select.mjs correct --file backlog/FAST-<n>.md --id lane --from fast --to deliberate --trigger <deferred_one_way|second_redispatch>`
