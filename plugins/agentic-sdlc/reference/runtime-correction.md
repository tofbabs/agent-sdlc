# Runtime correction — SOLO to PAIR

A SOLO story that proves riskier than its score predicted escalates to PAIR
mid-run. Per ARCH-3 it applies itself: no human confirmation, logged, reported.

## Observe

`mode-select.mjs observe --id <STORY>` tallies facts per story and run, and
prints `{"escalate": bool, "trigger": <token>|null, "outside"?: [files]}`.
`escalate` is true once, at the crossing. Call it from the story worktree:

| When | Flag | Fires |
|---|---|---|
| The coder reports BLOCKED | `--block` | `blocked_twice` on the 2nd |
| The coder reports a gate failure on an AC | `--gate-fail AC<n>` | `gate_failed_same_ac` on the 2nd for one AC |
| Before LAND | `--declared <file,dir/,...> --base feat/EPIC-<n>` | `edited_outside_declared` on any file outside the set you named in the prompt |

A story that trips nothing records nothing.

## Escalate

On `escalate: true`:

1. `mode-select.mjs correct --file backlog/EPIC-<n>.md --id <STORY> --from SOLO --to PAIR --trigger <trigger>`
   writes `- correction: SOLO→PAIR trigger=<t>` in the story block and a
   `correction` decision record. Repeating it is a no-op.
2. In the same worktree, `pair-log.mjs init <STORY> --brief <tmp>` with only the
   ACs still open, then run `pair-run.mjs` for the rest (PAIR LOOP).

`correct` is generic over `--from`/`--to`/`--trigger`; other corrections reuse it.
