# Feature: Run report — a code-free decision trace per run

## Problem

`meter.mjs` records what a run *cost* (tokens, spawns, per-agent USD) but not
*why*. Nothing records which lane was taken, how a story was put into SOLO or
PAIR, how many ARCH handoffs or mid-build blocks were raised, how many pair
alternations ran, how many review rounds a PR needed, or which finding and debt
categories came up. So when a run is expensive or needs three review rounds,
there is no record of the decisions that led there, and no way to compare runs
or spot a pattern. Every maintainer of the plugin feels this, on every
optimisation question.

This brief is the first of three. The second exports these reports
(`02-telemetry-export.md`); the third turns them into improvement signal
(`03-signal-routine.md`).

## Users

- **Plugin maintainers**, who need to know where the pipeline spends tokens and
  rounds so they can make it cheaper without making it worse.
- **Consuming-project developers**, who want to see after the fact how a run
  behaved, without reading transcripts.

## Outcome

Every `/agentic-sdlc:plan`, `/agentic-sdlc:build` and `/agentic-sdlc:review`
run leaves exactly one JSON run report in `<project>/.agentic-sdlc/runs/`
(gitignored). The report says how the run made its decisions and what they cost,
using **structured fields only**: enums from a closed vocabulary that ships with
the plugin, plus counts and numbers. It contains no free text, file paths,
identifiers, branch names, PR titles or code, and the schema makes that
impossible rather than relying on redaction.

## Success metric

- Coverage: share of pipeline runs that leave a valid report. Baseline 0% →
  target 100% across the bench fixtures and this repo's own runs.
- Leak-proofing: a schema test proves no field accepts an unbounded string.
  Must pass in preflight and CI.
- Baseline established: after this ships, cost per story, review rounds per PR
  and spawns per story are readable from reports. The later briefs measure
  against these numbers.

## Scope — in

- A versioned run-report schema (`schema: 1`), with at least:
  - run: plugin version, command, lane (deliberate/fast), outcome (completed /
    blocked / aborted), wall-clock.
  - plan: epic/story/task counts, ARCH handoffs raised, by category enum.
  - build: per story, its mode (SOLO/PAIR/FAST), alternations, blocks to the
    architect by category, gate runs and failures, REVISE rounds.
  - review: round number, verdict, findings by category and severity enum.
  - debt: tooling-debt rows logged, by category.
  - cost: the existing meter record's totals and derived fields, embedded
    as-is.
- A closed category vocabulary, one file that the agents and the schema both
  read, so a category cannot drift between them.
- `plugins/agentic-sdlc/scripts/run-report.mjs`, which builds the report, with
  `scripts/run-report.test.sh` (plain Node, no dependencies).
- A hook template in `templates/hooks/` that builds the report when the session
  ends, best-effort and always exiting 0, like `meter.sh`.

## Scope — out

- Sending the report anywhere (that is `02-telemetry-export.md`).
- Aggregating across sessions or repos, and dashboards.
- Any free-text field, including "reason" strings, even if redacted.
- Changing how agents make decisions. This brief observes; it does not steer.

## Value dependency

It has value on its own. A local report answers "why was this run expensive"
for a single project today, and it sets the baseline the other two briefs
measure against. The schema is the contract both later briefs build on, so it
must be settled before they start.

## Technical context

- Existing systems this must integrate with: `meter.mjs` and the `meter.sh`
  Stop/SubagentStop hook (reuse its record, do not re-parse costs); the
  pair-log (`pair-log.mjs`); backlog files; review comments ("Review — round
  <k>", finding IDs); `docs/TOOLING-DEBT.md`.
- Preferred approach: **derive** the report after the fact from artifacts the
  pipeline already writes, rather than having agents emit events. Emitting
  would add output and round trips to every spawn and grow the agent boot path,
  whose size budget (`scripts/size-budget.json`) can only shrink.
- Hard constraints: Node 22, zero dependencies; never fail the session; degrade
  and name what is missing (as `meter.mjs` does with `degraded`) rather than
  report zeros.
- House conventions: comments say why; anything only sometimes needed goes in
  `reference/`, not in `agents/*.md` or `commands/*.md`.

## Constraints

- Data / compliance: the report must be safe to leave the machine later, so
  "code-free" is a schema property, enforced by tests, not a policy.

## Open questions

- The schema and vocabulary are a one-way door once reports are exported. The
  architect should write an ADR.
- Which lifecycle point builds the report: `SessionEnd`, the last `Stop`, or the
  end of each command? `Stop` fires every turn, so it alone cannot mean "the run
  is done".
- Where do the categories come from where none exist yet (for example blocks to
  the architect)? Should the vocabulary have an `other` value, and how does an
  agent pick a category without writing free text?
- What does `run-report.mjs` do when a run spans several sessions (for example a
  build resumed the next day)?
