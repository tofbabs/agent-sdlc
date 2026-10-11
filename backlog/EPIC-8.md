# EPIC-8: Epic size budget that splits a brief into linked epics

- Brief: docs/briefs/epic-size-budget.md
- Part: 1 of 3
- Depends on: none
- Outcome: every planned epic fits a points budget (S=3, M=5, L=15, cap 15); a big brief comes back as linked epics, each its own PR; a deterministic check enforces it.
- Success metric: share of newly planned epics over the points budget, 5 of 6 to 0
- Status: TODO
- Artifacts: none
- Lane: deliberate — recommended fast (rubric 1): no floor fired and 0 PAIR stories, lane is fast
- Override: lane recommended=fast chosen=deliberate
- Points: 11 against cap 15

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-2 | Are anchors (lines/files) enforced by `check`, or advisory with only the points cap enforced? | STORY-8-1 | RESOLVED |

### ARCH-2: Anchors enforced or advisory

- status: RESOLVED
- reversibility: TWO-WAY
- blocks: [STORY-8-1]
- category: contract (run-report-categories.mjs)

**Context:** At plan time no diff exists, so anchors (lines, files, new modules per size) can only be checked against the planner's own estimate. The brief recommends enforcing only the points cap and treating anchors as estimation guidance. Also open: does a lone L that hits the files anchor but not the lines anchor still fill a whole epic?

**Decision:** Anchors are advisory. `check` never reads them. `check` fails only on: points over the cap, a story with no estimate or one outside S|M|L, the line budget or the `## Stories` line limit, and a missing `Depends on` target. Sizing rule for the planner, stated in `reference/epic-budget.md`: **the largest size any anchor dimension reaches wins.** So a story at L's files anchor is L even if its lines say M, and as an L it fills its epic alone (15 points). `config.mjs` still validates `anchors` values (positive integers) per ADR-0006, because a bad config value fails loudly even when nothing enforces it.
**Why:** At plan time no diff exists, so checking an estimate against an anchor would only check the planner's number against itself. Starting advisory is the reversible direction, because enforcing later only tightens; the calibration debt row below is the trigger for that.
**Note:** The coder for STORY-8-1 must not add anchor logic to `check`.

## Linked epics

- EPIC-9 (Part 2 of 3, STUB): planner splits a brief into linked epics, stubs and fill-in, `/build` link checks.
- EPIC-10 (Part 3 of 3, STUB): `config.mjs` and configurable budget numbers.

## Stories

### STORY-8-1: `check` rejects over-cap and unsized epics (hard-coded defaults)

- status: TODO
- estimate: M
- select: risk_class=none@brief:L111 one_way_doors=0@brief:L111 existing_pattern=yes@brief:L186 modules_crossed=2@brief:L111 review_bounced=no@brief:L111 risk_kind=code@brief:L111
- depends_on: []
- blocked_by_arch: [ARCH-2]

**As a** developer **I want** `plan-artifacts.mjs check <EPIC-n>` to score an epic **So that** an oversized epic is stopped by a deterministic check.

**Acceptance criteria**
1. Given an epic whose stories sum to 15 or less (S=3, M=5, L=15), when `check` runs, then it exits 0; at 16 it exits non-zero naming the total and the cap.
2. Given a story with no `estimate:` or one outside S|M|L, when `check` runs, then it fails naming the story.
3. Given `FAST-<n>`, when `check` is asked for it, then it is ignored and exits 0.

**Technical notes**
- Extend `plugins/agentic-sdlc/scripts/plan-artifacts.mjs`; tests in `scripts/plan-artifacts.test.sh`. Defaults are constants for now (EPIC-10 swaps in config).
- Per ARCH-2, no anchor logic in `check`. A `Status: STUB` epic gets no special case.

**Out of scope**
- Line budget, dependency checks, config.

### STORY-8-2: `check` enforces the epic line budget and Depends-on links

- status: TODO
- estimate: S
- select: risk_class=none@brief:L117 one_way_doors=0@brief:L117 existing_pattern=yes@AC1 modules_crossed=1@brief:L117 review_bounced=no@brief:L117 risk_kind=code@brief:L117
- depends_on: [STORY-8-1]
- blocked_by_arch: []

**As a** developer **I want** the line budget and dependency links checked **So that** epics stay readable and links are real.

**Acceptance criteria**
1. Given an epic over 150 lines, or with `## Stories` after line 40, when `check` runs, then it fails and names which limit.
2. Given `Depends on: EPIC-<n> (merged|released)` naming a file absent from `backlog/`, when `check` runs, then it fails naming the missing target.
3. Given `Depends on: none` or no header on an epic, when `check` runs, then those do not fail.

**Technical notes**
- Same script and test file as STORY-8-1.

**Out of scope**
- Anchor enforcement.

### STORY-8-3: preflight runs `check` on epics changed on the branch

- status: TODO
- estimate: S
- select: risk_class=none@brief:L123 one_way_doors=0@brief:L123 existing_pattern=yes@brief:L123 modules_crossed=2@brief:L123 review_bounced=no@brief:L123 risk_kind=code@brief:L123
- depends_on: [STORY-8-1]
- blocked_by_arch: []

**As a** maintainer **I want** preflight to fail an oversized epic **So that** it cannot reach a PR.

**Acceptance criteria**
1. Given a branch that adds or changes an over-cap `EPIC-n`, when `./scripts/preflight.sh` runs, then it fails naming the epic.
2. Given EPIC-1..3 are edited, when preflight runs, then they are skipped (grandfathered).
3. Given a branch that changes no epic, then preflight's result is unchanged.

**Technical notes**
- `scripts/preflight.sh`; changed-file list from git against `main`.

**Out of scope**
- CI workflow changes beyond what preflight already feeds.

## Debt

Ledgered in docs/TOOLING-DEBT.md by the plan commit.

