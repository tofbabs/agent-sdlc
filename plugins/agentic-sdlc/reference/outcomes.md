# Outcomes — events, sweep, verdicts

Every decision record (ADR-0002) is closed with a verdict once its outcome
window passes. Telemetry only: each call exits 0 with a reason when it cannot
write, so none of them can fail a run.

## Calls

`node ${CLAUDE_PLUGIN_ROOT}/scripts/outcomes.mjs` plus:

| When | Who | Call |
|---|---|---|
| A story lands, any mode (SOLO, SOLO_OPUS, PAIR) | `/build` LAND | `event --subject <STORY> --event build --from-session [--tokens N --wall-s N]` |
| A FAST run opens its PR | `/build --fast` | `event --subject lane --event build` |
| A review round is posted | `/review`, per story ID in the PR (`lane` for `Mode: FAST`) | `event --subject <STORY> --event review --findings N` |
| A REVISE round lands | `/build` REVISE, per story it changed (`lane` for FAST) | `event --subject <STORY> --event review --revise-rounds 1` |
| Any pipeline run starts | the `run-report.sh` hook, detached | `settle` |
| Checking coverage | by hand | `account` (exit 1 if any decision is unaccounted for) |

`--from-session` reads blocks and gate failures from the observe tally and
alternations and rejections from the mirrored pair session. `--findings` counts
the round's findings that required a change in that story. An event lands on
the latest run's decision for that subject.

`settle` is `sweep`, then `mode-select.mjs verdicts` only when the sweep
returned `swept: true`. A verdict settled without the sweep's fixes and
reverts would be final, so a failed sweep defers settlement to the next run
start. Both stamp the current run: the sweep's events and the verdicts it
settled reach that run's report (`outcome_events`, `settlements`), including
those on earlier runs' decisions.

## Routing

Events go to the open decision in the subject's latest run: its highest
correction if one fired, else its override, else the score/floor/lane record.
After a correction, events belong to the correction's own record.

## Sweep

One `gh pr list` plus one `gh api .../commits` (override the binary with
`OUTCOMES_GH`). A PR naming `[STORY-x-y]` or `[EPIC-x]` in its title or body,
merged or closed after the decision was made, is the story's merge or
abandonment; one from before it delivered an earlier run's attempt. A later merged `fix:`/`Revert` naming one of
those tags, inside the rubric's `outcome_window_days` after the merge, is a
`post_merge_fix`/`post_merge_revert`. Unnamed fixes are never attributed. Lane
decisions carry no tag, so the sweep cannot attribute to them.

## Verdicts (rubric 1)

| Decision | Verdict |
|---|---|
| Corrected by a later correction | closes at once: SOLO `missed`, PAIR `wasted`, FAST `under_ceremony`, deliberate `over_ceremony`; an override `worse` |
| PAIR | `earned` if navigator rejections >= 1, else `wasted` |
| SOLO | `missed` if any post-merge fix/revert, finding or REVISE round, else `held` |
| FAST | as SOLO, but `under_ceremony` / `held` |
| deliberate | `needed` if anything was caught (rejection, finding, REVISE, block, gate failure, fix), else `over_ceremony` |
| Override | `better` if the chosen path's own rule says it was right, else `worse` |
| Selector record that was overridden | judged by its override: override `worse` means the selector was right |

Window passed with an abandoned PR and no merge: orphaned `pr_deleted` (a
replacement PR that merges inside the window still counts). No events:
`subject_missing`. Built but never merged: `other`. Verdicts are stamped with
the rubric version that applied the rule.
