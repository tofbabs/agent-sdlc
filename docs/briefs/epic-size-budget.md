# Feature: an epic size budget that splits a brief into linked epics

## Problem

`/plan` turns one brief into one epic, whatever the brief's size, and `/build`
turns one epic into one PR. So a large brief becomes a large PR. Of the six
epics planned so far, five are over any reasonable size for one build session.
Their PRs ran 4,064 lines (EPIC-1, 36 files) and 4,916 lines (EPIC-2, 39 files).
Reviewers cannot hold that much, and review rounds grow with it.

Two causes are measured, not suspected:

1. **Nothing counts story size.** The planner tags each story `estimate: S | M |
   L`, but nothing adds the tags up and there is no cap. EPIC-2 has 2 L, 5 M and
   4 S in one epic.
2. **The tags have no benchmark, so they don't mean anything.** Actual code
   changes per story (excluding `backlog/` and `docs/`), from the story commits
   of EPIC-1..3:

   | Estimate | Lines changed, range | Median |
   |----------|----------------------|--------|
   | S        | 7 – 355              | ~157   |
   | M        | 113 – 1,139          | ~274   |
   | L        | 436 – 869            | ~650   |

   Three of nine M stories came out larger than the L median.

The epic *line* budget in `agents/planner.md:120` (~150 lines, `## Stories`
inside the first 40) is prose, and every epic breaks it: 280–483 lines, with
`## Stories` at lines 22–153. Nothing checks it.

## Users

- **The developer writing a brief.** They want a big brief to come back as a
  sequence of PRs they can review, not one PR they can't.
- **The planner agent.** It needs a concrete benchmark for S/M/L and a hard rule
  for when to split.
- **The reviewer, human or agent.** It needs PRs small enough to actually read.
- **Consuming projects.** Their right-sized epic is not ours, so they need to
  tune the numbers.

## Outcome

- **Every epic fits the budget.** `/plan` emits one or more epics, each within a
  points budget (default: **one L, or three M, or five S, or the equivalent**).
- **A big brief splits into linked epics.** Each epic is its own PR, built in
  its own `/build` session, and declares what it depends on.
- **S, M and L are benchmarked.** Each size has a concrete anchor, so an
  estimate is a measurement rather than a mood.
- **The developer can change the numbers.** The budget, the point weights and
  the anchors are configurable per repo.
- **A deterministic check enforces it.** It is not left to the planner's
  judgement.

## Success metric

Share of newly planned epics over the points budget: **5 of 6 → 0**.

Baseline, scored with the default weights below:

| Epic | Points vs cap 15 |
|------|------------------|
| EPIC-1 | 27 |
| EPIC-2 | 67 |
| EPIC-3 | 14 (the only one inside, and the smallest PR) |
| EPIC-5 | 53 |
| EPIC-6 | 48 |
| EPIC-7 | 49 |

Measured by re-running `/plan` on the briefs behind EPIC-5, 6 and 7 after this
ships. Each brief must come back as epics that all pass the check.

## Scope — in

- **Points and budget.**
  - Default weights: **S = 3, M = 5, L = 15**. Default cap per epic: **15
    points**. That makes 1 L = 3 M = 5 S = the cap, and any mix up to 15 is
    allowed (e.g. 2 M + 1 S = 13).
  - An L story fills its epic alone.
  - Nothing larger than L, as today: split it.
- **A benchmark for each size.** Defaults come from the measurements above,
  over production plus test lines, excluding `backlog/` and `docs/`:

  | Size | Lines changed | Files touched | New modules |
  |------|---------------|---------------|-------------|
  | S | ≤ ~150 | ≤ ~4 | none |
  | M | ≤ ~400 | ≤ ~8 | at most one |
  | L | ≤ ~800 | ≤ ~12 | — |

  The planner sizes each story against these anchors, using LSP for blast
  radius as it does now. A story it expects to land above the L anchor is split.
- **Rules for splitting a brief into several epics.**
  - **When:** the brief's stories sum to more than the cap.
  - **How each epic is cut:**
    - It is **one PR that is releasable on its own**: preflight is green, and
      it ships either user value or a proven seam (a contract plus its tests).
    - Cut where the release signal changes (`feat` vs `feat!`), where a
      contract has to merge before its callers, or where value lands.
    - Never cut mid-story.
  - **Linked, not coupled.** Each epic's header carries:
    - `Brief:` the path.
    - `Part:` k of N.
    - `Depends on:` `EPIC-<n> (merged | released)` or `none`.

    The epics are built in separate `/build` sessions, in any order their
    dependencies allow. `/build EPIC-n` stops, with a one-line message, when a
    `merged` dependency is not merged yet.
  - `/plan`'s summary table lists the epics in build order, with points and
    dependencies.
- **Enforcement.**
  - **The checks** (`check <EPIC-n>`) are added to the existing
    `plan-artifacts.mjs`. A new script is only allowed if it is justified. The
    subcommand fails when:
    - the points are over the cap;
    - a story is unsized;
    - a story is bigger than L;
    - the epic file is over its line budget, or `## Stories` starts after its
      line limit;
    - a dependency is missing.
  - **Where it runs:**
    - `/plan` runs it after the planner writes. On failure, the planner gets
      one re-split attempt, then `/plan` reports what is still over.
    - This repo's `preflight.sh` runs it on epics added or changed on the
      branch. EPIC-1..3 are grandfathered.
- **Configuration.** The settings go under a `plan` key in
  `.claude/agentic-sdlc.json`, read only through `config.mjs`, per ADR-0006:

  ```json
  { "schema": 1,
    "plan": { "epic": {
      "points": { "S": 3, "M": 5, "L": 15 },
      "cap": 15,
      "max_lines": 150,
      "stories_by_line": 40,
      "anchors": { "S": { "lines": 150, "files": 4 },
                   "M": { "lines": 400, "files": 8 },
                   "L": { "lines": 800, "files": 12 } } } } }
  ```

  - A missing file or a missing key means the defaults.
  - A bad value fails loudly, as ADR-0006 already specifies.
- **Documentation.** The rules and the benchmark go in a new
  `reference/epic-budget.md`. `planner.md` and `plan.md` change by
  *replacing* their current prose budget lines with a pointer, and must not get
  larger.
- **Tests.** `scripts/plan-artifacts.test.sh` and `scripts/config.test.sh` cover:
  - under, at and over the cap;
  - a custom config;
  - bad config;
  - the line budget;
  - a missing `Depends on` target.

## Scope — out

- **Rewriting EPIC-1..7 by hand.** EPIC-5..7 get re-planned with the shipped
  check (that is the success metric); EPIC-1..3 are history.
- **Estimate-vs-actual calibration** (measuring each story's real diff against
  its tag). Log it in the debt ledger with the trigger "after 3 epics planned
  under the budget". The numbers above were measured by hand once, and that is
  enough for v1.
- **A size finding in `/review`, and keeping planning documents out of feature
  PRs.** Both are separate briefs.
- **Size caps for `reference/` and shipped scripts.** Separate brief.
- **Triaging the debt ledger.** Separate work.
- **The `meter.sh` bash 3.2 fix.** That is its own `fix:` PR and should land
  first, so preflight is green when this is built.
- **Splitting the FAST lane.** FAST files are already flat and small. The check
  must ignore `FAST-<n>.md`.
- **Any automation that builds linked epics in sequence.** That is the waves
  briefs' job. This brief only makes the links machine-readable.

## Value dependency

Partial delivery has value, in this order:

1. **The `check` subcommand with hard-coded defaults.** On its own, preflight
   stops oversized epics.
2. **The planner splitting into linked epics.**
3. **Configuration.**

Step 3 should not block steps 1 and 2.

## Technical context

- **Existing systems:**
  - `plugins/agentic-sdlc/scripts/plan-artifacts.mjs`, already called by
    `/plan`, is the home for `check`.
  - The planner's output format is at `agents/planner.md:63-130`.
  - `templates/backlog/EPIC-template.md` needs the three header lines.
- **Config:** ADR-0006 is ACCEPTED, but `config.mjs` does not exist yet;
  STORY-7-8 of the unbuilt EPIC-7 creates it. This brief lands before EPIC-7
  is re-planned, so **it creates `config.mjs` exactly to ADR-0006's contract**,
  with only the `plan` key. EPIC-7 then adds its keys to the existing reader.
  This is not a new decision, only a change of which brief builds the reader
  first.
- **Hard constraints:**
  - Plain Node, no dependencies.
  - Every shipped script has a `scripts/<name>.test.sh`.
  - The boot-path size budget (`scripts/size-budget.json`) can only go down.
- **Release:** `feat:`. Existing consuming projects keep working with no file,
  and their next `/plan` simply splits more.

## Constraints

- Data / compliance: none.
- Deadline: before EPIC-5, 6 or 7 is built. All three would be re-planned
  under this rule.

## Open questions

- **Should later epics be planned in full, or as stubs?** Planning epic 3 of 3
  in full means its ACs are written against code that epics 1 and 2 haven't
  built yet, so they go stale. The alternative is stubs (title, goal, story
  titles with sizes, no ACs) that get re-planned once their dependency merges.
  Recommendation: stubs, with `/plan EPIC-n` filling one in. The architect
  should decide (ARCH).
- **What should a lone L story do?** Should a single L story that hits the
  anchor on files but not on lines still fill a whole epic, or should anchors
  be advisory and only the points cap be enforced? Recommendation: only the cap
  is enforced. Anchors guide estimation.
