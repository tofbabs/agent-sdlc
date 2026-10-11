# Feature: Signal routine — turn cross-repo run reports into proposed briefs

## Problem

Once run reports arrive from many repos (`02-telemetry-export.md`), they are only
noise until something groups them and acts on them. Today, improvements to the
plugin come from whatever the maintainers happen to notice in this repo. Nothing
systematically says "PAIR stories in fast-moving repos average four review
rounds" or "architect blocks of category X cost N tokens each across twelve
repos", and nothing turns such a pattern into work. The goal is more
high-quality code at a much lower cost. That needs a loop from evidence to
backlog.

## Users

- **Plugin maintainers**, who want a short, evidenced list of what to fix next
  instead of a store full of JSON.

## Outcome

A daily routine reads the run reports that are new since its last run and
groups similar signals. It also deduplicates them, both against each other and
against signals already filed. Each group that crosses a threshold becomes a
**GitHub Issue** in this repo. The issue holds the evidence (counts, distinct
repos, cost and round impact versus baseline), a proposed brief draft in
`templates/brief.md` shape, and a label. Groups below the threshold are written
to a discard log with the reason. Every report is accounted for. A human reads
the issue and, if they agree, writes the brief into `docs/briefs/`. Briefs stay
hand-written, and the routine only proposes them.

## Success metric

- Accounting: every report processed ends up in exactly one issue or discard
  log entry. Baseline n/a → 100%, checked by the routine's own summary.
- Idempotency: re-running the routine over the same input files 0 new issues.
  Must pass a fixture test.
- Ultimate (lagging): cost per merged story falls while review rounds per PR
  stay flat or fall, against the `01-run-report.md` baseline. This is tracked, not
  gated, in v1.

## Scope — in

- Two-pass grouping:
  1. Deterministic: group by matching signature (command, lane, mode, event,
     category, severity) and by metric outliers against the baseline.
  2. Model-assisted: merge groups that mean the same thing. It runs only on
     already-structured groups, so it never sees free text from clients.
- Thresholds that require several runs **and** several distinct repos. Only
  tokens older than a minimum age count, and each token's contribution is
  capped. One noisy repo, or a burst of fake ones, cannot steer the backlog.
- Decision-outcome signals (`04-mode-selection.md`): the rate of each verdict
  (PAIR earned or wasted, SOLO held or missed, FAST held or under-ceremony,
  override better or worse), grouped by rubric version and layer. A drop in
  the "right" rate after a rubric change is a signal of its own.
- Matching against open and closed issues, so a known signal updates its issue
  (with new counts) instead of filing a duplicate.
- Issue format with labels, evidence and a proposed brief draft; a discard log
  with reasons.
- A routine prompt in `templates/routines/`, next to `gap-scan-prompt.md`, plus
  whatever script does the deterministic pass (tested by a `.test.sh`).
- Developing and testing against **local** run reports and fixtures, so this
  brief does not wait for `02-telemetry-export.md` to ship.

## Scope — out

- Writing briefs into `docs/briefs/` automatically, or opening PRs.
- Automatically running `/plan` or `/build` from a signal.
- Changing the plugin without a human in the loop.
- Dashboards or charts.
- Shipping any of this to consuming projects. This is agent-sdlc improving
  itself, so per CLAUDE.md it stays out of `plugins/`.

## Value dependency

It depends on the `01-run-report.md` schema. It can be built and proven against
local reports and fixtures in parallel with `02-telemetry-export.md`. On this
repo's own runs alone it already produces real, if thin, signal. It becomes
fully useful once export is live.

## Technical context

- Existing systems this must integrate with: the run-report schema and category
  vocabulary; the storage chosen in `02-telemetry-export.md`, read-only;
  `templates/routines/` and the existing gap-scan routine pattern; GitHub
  Issues through `gh`; the scheduled routines Claude Code offers.
- Hard constraints: **treat the store as untrusted input.** Validate every
  report against the schema again before using it; weight by token age and
  contribution caps; the model pass sees only grouped, structured data.
- House conventions: Node 22, no dependencies, tested scripts; comments say why.
- Add one line to CLAUDE.md making clear that the routine proposes briefs and
  humans write them. That way the "brief is the only hand-written document" rule
  is not misread later.

## Constraints

- Data / compliance: issues are public if the repo is public. They must contain
  only aggregates (counts, distinct-repo counts, ratios), never individual repo
  IDs or tokens.

## Open questions

- Threshold values: minimum runs, minimum distinct repos and minimum token age,
  and whether they should differ for cost signals and quality signals.
- What a "signal" is beyond category matches. Which metric outliers count
  (for example boot tokens per spawn, alternations per story, REVISE rounds),
  and outliers against what baseline?
- Where the discard log lives: a file in the repo, a store prefix, or a
  long-lived issue.
- Where the routine runs (a cloud scheduled routine or GitHub Actions), and
  which credential reads the store.
- How "make the system better" is checked after a brief built from a signal
  ships: does the routine report whether that signal's group shrank?
