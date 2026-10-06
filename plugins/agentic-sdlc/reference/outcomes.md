# Outcomes — events, sweep, verdicts

Every decision record (ADR-0002) is closed with a verdict once its outcome
window passes. Telemetry only: each call exits 0 with a reason when it cannot
write, so none of them can fail a run.

## Calls

| When | Call |
|---|---|
| A story lands (build outcome) | `outcomes.mjs event --subject <STORY> --event build --from-session [--tokens N --wall-s N]` |
| A REVIEW round is posted | `outcomes.mjs event --subject <STORY> --event review --findings N --revise-rounds N` |
| A run starts | `outcomes.mjs sweep`, then `mode-select.mjs verdicts` |
| Checking coverage | `outcomes.mjs account` (exit 1 if any decision is unaccounted for) |

`--from-session` reads blocks and gate failures from the observe tally and
alternations and rejections from the mirrored pair session. `--findings` counts
findings that required a change. A lane decision uses subject `lane`; an event
lands on the latest run's decision for that subject.

## Routing

Events go to the open decision in the subject's latest run: its highest
correction if one fired, else its override, else the score/floor/lane record.
After a correction, events belong to the correction's own record.

## Sweep

One `gh pr list` plus one `gh api .../commits` (override the binary with
`OUTCOMES_GH`). A PR naming `[STORY-x-y]` or `[EPIC-x]` in its title or body is
the story's merge or abandonment. A later merged `fix:`/`Revert` naming one of
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

Window passed with an abandoned PR: orphaned `pr_deleted`. No events:
`subject_missing`. Built but never merged: `other`. Verdicts are stamped with
the rubric version that applied the rule.
