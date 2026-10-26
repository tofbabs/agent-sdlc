# Feature: review judges a PR against the brief's intent, not just the story's ACs

## Problem

The code-reviewer never sees the original requirement. `agents/code-reviewer.md`
tells it to read **only the named `### STORY-…` sections** of the backlog file,
and `/review` inlines nothing from the brief. So the review answers "is every
acceptance criterion tested?" but never "does this deliver what the human asked
for?"

Those differ whenever the planner's decomposition drifted from the brief: an AC
that is a weaker reading of the brief's outcome, a `Scope — out` item that crept
back in through a story, or an epic whose stories all pass while the brief's
outcome is still not true. The brief is the only hand-written document in the
loop, and the last gate before a human merge never checks against it. The human
then has to do that check at merge time from memory.

There is also no reliable way for `/review` to find the brief. Only epics from a
split brief carry a `- Brief:` header line (`reference/epic-budget.md`). EPIC-1
to EPIC-7 and every FAST file have none.

This affects every PR reviewed by `/review`, in this repo and in every consuming
project.

## Users

- **The human who wrote the brief and merges the PR.** They need the review to
  say whether the PR meets the brief's outcome and stays inside its scope, so
  merging is not a re-read of the brief.
- **The code-reviewer.** It needs the brief's intent handed to it, cheaply,
  without reading the whole brief or the whole epic.
- **The coder in REVISE.** A fit-for-purpose finding must read like any other
  finding (F-ID, severity, fix) so REVISE needs no change.

## Outcome

Every `/review` spawn that can resolve a brief carries the brief's `Outcome` and
`Scope — out` into the reviewer's prompt. The reviewer checks the PR against
both and reports drift as an ordinary finding in the existing round comment. A
PR with no brief (the hotfix path, older backlog files) is reviewed exactly as
today, and the report says no brief was found.

## Success metric

Share of `/review` spawns whose prompt carries the brief's intent:
**0% → 100% of PRs whose backlog file names a brief.** Checked by a test on the
extraction script and by the reviewer's REPORT line (`brief: <path> | none`).

## Scope — in

- **The planner always writes `- Brief: <path>`** in the header block of every
  `EPIC-<n>.md` and `FAST-<n>.md` it creates, not only split-brief ones. Update
  the header formats in `reference/plan-artifacts.md` and `reference/fast-mode.md`
  (the FAST format is inlined from there).
- **A small shipped script** (or a subcommand of an existing one) that, given a
  backlog file, resolves its `Brief:` path and prints the brief's `## Outcome`
  and `## Scope — out` sections, or nothing with a clear status when there is
  no `Brief:` line or the file is missing. Plain Node, no dependencies, with its
  `scripts/<name>.test.sh`.
- **`/review` step 1 (GATHER)** runs it and **step 4 (SPAWN)** inlines the
  result (`Brief intent: <outcome + scope-out> | none`). The reviewer still
  never opens the brief itself.
- **`code-reviewer.md` THE BAR gains one item**: the PR delivers the brief's
  outcome for these stories and touches nothing in its `Scope — out`. Drift is a
  finding with the existing severities. Shipping something the brief excluded
  is `MAJOR`. An AC that is a weaker reading of the brief is `MAJOR` when the
  story's own outcome depends on it, otherwise `NON-BLOCKING`. The REPORT gains
  `brief: <path> | none`.
- **FAST PRs get the check too.** The fast floor narrows testing, not
  review, so a FAST PR is still judged against its brief's scope.

## Scope — out

- **Separate review agents or lenses** (tests, security, continuity,
  fit-for-purpose as subagents). We decided to keep the single reviewer. Do not
  add agents, parallel spawns or a merge step.
- **Any change to the round comment contract** (ADR-0005): format, F-IDs,
  verdict rule, round cap, and the rounds-2+ narrowing all stay as they are.
- **REVISE mode.** Fit-for-purpose findings must parse as ordinary findings, so
  the coder needs no change.
- **Backfilling `Brief:` into existing backlog files.** Old files take the
  "none" path.
- **Reviewing whole-epic outcome on a story PR.** The reviewer judges the
  stories in this PR against the brief. It does not demand the rest of the epic.
- **Reading the full brief in the reviewer**, or inlining sections beyond
  `Outcome` and `Scope — out`.

## Value dependency

The pieces land in order and each has value alone. Planner writing `Brief:` is
useful immediately (traceability, and the split-brief path already depends on
it). The extraction script is testable on its own. The reviewer change is only
useful once both exist, but it degrades safely to "none".

## Technical context

- Existing systems this must integrate with: `plugins/agentic-sdlc/commands/review.md`,
  `agents/code-reviewer.md`, `agents/planner.md`, `reference/plan-artifacts.md`,
  `reference/fast-mode.md`, `reference/epic-budget.md` (already defines
  `Brief:` for stubs, so keep one meaning), `templates/brief.md` (the section
  headings the script parses).
- House stack: plain Node 22, no dependencies, Bash tests run by
  `scripts/preflight.sh` and CI.
- **Hard constraint, boot-path budget:** `commands/review.md` is at 4472 bytes
  against a 4477 cap, so it has effectively no headroom. The `/review` change has
  to replace text, not add to it, or move existing text into `reference/`.
  `code-reviewer.md` (6774 vs 8552) and `planner.md` have room, but the
  `agents+commands` group cap applies too. Caps only go down.
- Deployment target: ships in the plugin. Use `feat:`. No consuming project has
  to act, because old backlog files keep working.
- Section parsing must tolerate the headings as written in `templates/brief.md`
  (`## Outcome`, `## Scope — out` with an em dash) and fail soft on a brief
  that renamed them.

## Constraints

- Data / compliance: none. The brief is already in the repo.
- Deadline: none.

## Open questions

- Should fit-for-purpose drift get its own `finding_category` value (for
  example `intent`) so outcomes can count it, or reuse `correctness`?
  `finding_category` is a closed vocabulary in `run-report-categories.mjs`
  under ADR-0001, so adding a value may be a one-way door. That is the
  architect's call.
- Should `Brief:` be a path or a path plus part (`Part: k of N` already exists
  for split briefs)? Keep it one meaning across stub and full epics.
- Where should the extraction live: a new script, or a subcommand on
  `plan-artifacts.mjs`, which already owns backlog headers?
