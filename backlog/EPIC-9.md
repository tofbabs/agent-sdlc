# EPIC-9: Planner splits a brief into linked epics, with stubs, fill-in and `/build` link checks

- Brief: docs/briefs/epic-size-budget.md
- Part: 2 of 3
- Depends on: EPIC-8 (merged)
- Outcome: the planner splits an oversized brief into linked epics (Part 1 in full, later parts as stubs), `/plan EPIC-n` fills a stub in, and `/build` refuses an unmerged dependency or an unfilled stub. Part 1's `check` is its gate.
- Status: TODO
- Artifacts: none
- Lane: deliberate — recommended deliberate (rubric 1): 2 stories are PAIR, lane is deliberate
- Points: 14 against cap 15

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | Later epics of a split brief: planned in full, or as stubs filled in by `/plan EPIC-n`? | STORY-9-3, STORY-9-4 | RESOLVED |
| ARCH-2 | Are anchors (lines/files) enforced by `check`, or advisory with only the points cap enforced? | STORY-8-1, STORY-9-1 | RESOLVED |
| ARCH-3 | How does `/build` decide a `Depends on: EPIC-n (merged)` target is merged (git, gh, or a status field)? | STORY-9-2 | RESOLVED |

## Stories
### STORY-9-1: `reference/epic-budget.md`, anchors, and pointer-only prose in planner/plan
- status: DONE
- mode: SOLO — recommended SOLO (rubric 1): score 2 at or below 2 is SOLO
- estimate: S
- select: risk_class=none@brief:L142 one_way_doors=0@brief:L142 existing_pattern=yes@brief:L142 modules_crossed=2@brief:L142 review_bounced=no@brief:L142 risk_kind=code@brief:L142
- depends_on: []
- blocked_by_arch: [ARCH-2]

**As a** planner agent **I want** the budget, weights and anchors in one on-demand reference **So that** I size against a benchmark without paying for it in the boot path.
**Acceptance criteria**
1. Given `reference/epic-budget.md`, then it states weights S=3 M=5 L=15, cap 15, the 150-line and `## Stories`-by-line-40 limits, the anchors table, "the largest size any anchor dimension reaches wins", and that anchors are advisory (`check` never reads them).
2. Given `planner.md`'s `~150 lines` budget bullet, then it is replaced by a one-line pointer to the reference, and `planner.md` is no larger than before.
3. Given `plan-artifacts.test.sh`, then a case fails if the weights, cap or limits written in the reference differ from the constants in `plan-artifacts.mjs`.

**Technical notes:** new `plugins/agentic-sdlc/reference/epic-budget.md`; edit `agents/planner.md` and `commands/plan.md` (a `cat` pointer in STEP 1; plan.md has no budget prose to replace, so cut equal bytes in plan.md). No cap in `scripts/size-budget.json` may rise.
**Out of scope:** split rules and stub shape (STORY-9-3), `check` changes, config.

### STORY-9-2: `/build` stops when a `merged` dependency is not merged
- status: DONE
- mode: SOLO — recommended SOLO (rubric 1): score 2 at or below 2 is SOLO
- estimate: S
- select: risk_class=none@brief:L104 one_way_doors=0@brief:L104 existing_pattern=yes@brief:L186 modules_crossed=2@brief:L104 review_bounced=no@brief:L104 risk_kind=code@brief:L104
- depends_on: []
- blocked_by_arch: [ARCH-3]

**As a** developer **I want** `/build EPIC-n` to refuse a stub or an unmerged dependency **So that** I never build on code that is not on `<base>`.
**Acceptance criteria**
1. Given `ready <EPIC-n> --base <base>` on a `Status: STUB` epic, then it exits non-zero with `EPIC-n is a stub: run /plan EPIC-n first`.
2. Given `Depends on: EPIC-m (merged)` where `origin/<base>` lacks `backlog/EPIC-m.md`, or any `### STORY-<id>` in that copy has no `[STORY-<id>]` in `git log origin/<base>` messages, then it exits 3 with one line naming EPIC-m and the first missing story; `released`, `none` or no header pass.
3. Given a shallow checkout and a story not found, then it fails closed and the message names `git fetch --unshallow origin <base>`.
4. Given `--deps-only`, then the stub rule is skipped and only the dependency half runs (for STORY-9-4's fill-in).
5. Given `build.md`, then `ready EPIC-<n> --base <base>` replaces the PRECONDITIONS epic-file line, and `build.md` is no larger than its cap in `scripts/size-budget.json` (6 bytes of headroom).

**Technical notes:** `plan-artifacts.mjs` (new `ready`; `check` never reads anchors), `scripts/plan-artifacts.test.sh` (fixture repo with an `origin` remote, plus a `--depth 1` clone), `commands/build.md`. `ready` also fails when the epic file is missing or has no `### STORY-` blocks. Base is resolved in BASE BRANCH, after PRECONDITIONS: reorder, do not duplicate.
**Out of scope:** `released` dependencies, `gh`, a status field.

### STORY-9-3: Planner splits a brief into linked epics; `/plan` runs `check`
- status: TODO
- mode: PAIR — recommended PAIR (rubric 1): score 5 at or above 4 is PAIR
- estimate: M
- select: risk_class=none@brief:L92 one_way_doors=0@brief:L92 existing_pattern=no@brief:L121 modules_crossed=3@brief:L92 review_bounced=no@brief:L92 risk_kind=code@brief:L92
- depends_on: [STORY-9-1]
- blocked_by_arch: [ARCH-1]

**As a** developer **I want** a big brief to come back as linked epics **So that** each is a PR I can review.
**Acceptance criteria**
1. Given a brief whose stories sum over the cap, when `/plan` runs, then Part 1 is written in full to the claimed path and each later part is a stub (header with `Brief:`, `Part: k of N`, `Depends on:`, `Status: STUB`; stories with only `estimate` and `depends_on`; binding RESOLVED ARCH entries kept), each at its own `claim`ed number.
2. Given a brief within the cap, then one epic is written, as today, with `Part: 1 of 1` and `Depends on: none`.
3. Given any epic or stub written, when `/plan` finishes STEP 3, then `check` has run on every epic it wrote; on failure the planner gets one re-split attempt with the error text, and a second failure is reported as "still over" and `/plan` stops.
4. Given the REPORT, then it lists epics in build order with points and `Depends on`.
5. Given a stub in the template shape, when `check` runs on it, then it exits 0 (case in `plan-artifacts.test.sh`).

**Technical notes:** `reference/epic-budget.md` (split rules: cut at release-signal or contract seams, never mid-story; stub shape), `commands/plan.md`, `agents/planner.md` (pointers only, no growth), `templates/backlog/EPIC-template.md` (the three header lines). Assumption: the orchestrator `claim`s once for the first call; the planner returns the later parts' outline and `/plan` claims one number per part, then has the planner write each stub. Lane is recorded for Part 1 only.
**Out of scope:** fill-in, the `ready` call, config, building epics in sequence.

### STORY-9-4: `/plan EPIC-n` fills in a stub; `carry` replaces a stub
- status: TODO
- mode: PAIR — recommended PAIR (rubric 1): score 5 at or above 4 is PAIR
- estimate: S
- select: risk_class=none@brief:L104 one_way_doors=0@brief:L104 existing_pattern=no@brief:L121 modules_crossed=3@brief:L104 review_bounced=no@brief:L104 risk_kind=code@brief:L104
- depends_on: [STORY-9-3, STORY-9-2]
- blocked_by_arch: [ARCH-1, ARCH-3]

**As a** developer **I want** `/plan EPIC-n` to turn a stub into a full plan **So that** later parts are planned against merged code.
**Acceptance criteria**
1. Given `/plan EPIC-m` on a stub whose `merged` dependency is not merged, then `ready --deps-only` stops it with that one-line message and the stub is unchanged.
2. Given a stub with merged dependencies, then the planner re-reads the brief (path from `Brief:`, limited to that part's stories) and the merged code, overwrites the same file with no new `claim`, the architect and `check` run, and `Status:` is `TODO`; a result over the cap is reported and stops.
3. Given `/plan EPIC-m` on an epic that is not `Status: STUB`, then it refuses and changes nothing.
4. Given the build branch holds `backlog/<ID>.md` with `Status: STUB` and the planning copy differs, when `carry` runs, then it overwrites and commits; any other differing copy is still refused.

**Technical notes:** `commands/plan.md` (arg `EPIC-<n>` selects fill-in; replace prose, no growth), `reference/epic-budget.md` (fill-in protocol), `plan-artifacts.mjs` (`carry` guard only), `scripts/plan-artifacts.test.sh`. Resizing in fill-in is allowed.
**Out of scope:** re-splitting an over-cap fill-in (Debt), committing stubs for other machines.

### ARCH-1: Full plan or stubs for later epics of a split brief
- status: RESOLVED
- reversibility: TWO-WAY
- blocks: [STORY-9-3, STORY-9-4]
- category: lifecycle (run-report-categories.mjs)
**Context:** Epic 3 of 3 planned in full has ACs written against code that epics 1 and 2 haven't built, so they go stale. Stubs (title, goal, story titles with sizes, no ACs) avoid that but need a fill-in path. The brief recommends stubs, with `/plan EPIC-n` filling one in. Stubs also need to pass `check` (sizes present, points counted), and `/build` must refuse an unfilled stub.
**Decision:** Stubs. Part 1 is planned in full. Parts 2..N are written in the same `/plan` run as stubs, each with its own claimed number.
- **Stub shape:** the normal header with `- Status: STUB`, plus `Brief:`, `Part:`, `Depends on:` and `Outcome:`. Under `## Stories`, each story is `### STORY-<e>-<k>: <title>` with `- estimate:` and `- depends_on:` only: no ACs, no `select:`, no notes. It keeps any RESOLVED ARCH entries that bind its stories, because those are decisions, not ACs. A question it anticipates goes in as an OPEN ARCH row, which the architect resolves at fill-in.
- **`check`** treats a stub like any epic: sizes, cap, line budget and `Depends on` targets. It needs no stub-specific rule, so Part 1's `check` already accepts stubs.
- **Fill-in:** `/plan EPIC-m` on a STUB first runs `ready`'s dependency half (ARCH-3) and stops with the same one-line message if a `merged` dependency isn't merged. Otherwise the planner overwrites the stub in place, keeping the same number with no new claim. It re-reads the brief and the merged code, and resizing is allowed. Then the architect runs, `check` runs, and the result is `Status: TODO`. A fill-in that comes out over the cap is reported and stops. It is not re-split in v1 (see Debt).
- **`/build`** refuses a STUB through `ready` (STORY-9-2).
- **`carry`** may overwrite a branch copy of `backlog/<ID>.md` only when that copy is `Status: STUB` for the same ID. This repo commits plans through docs PRs, so a filled stub would otherwise hit "exists with different content". Every other refusal stays.
- Stubs aren't added to Part 1's `Artifacts`. They stay where `/plan` wrote them, like any plan today. `claim` already reserves their numbers across worktrees.
**Why:** ACs for Part 3 written before Parts 1 and 2 exist go stale, and that's the brief's own measured complaint. The stub format is transient: changing it later costs only a re-plan of outstanding stubs, so this is a two-way door and needs no ADR.
**Note:** The STUB status and fill-in come from STORY-9-3 and STORY-9-4. The released pipeline has no fill-in yet, so this epic's own Part 2 stub gets filled by re-running `/plan` on the brief limited to Part 2's stories, overwriting the stub. Part 3 uses `/plan EPIC-<part 3>` once Part 2 is released.

### ARCH-2: Anchors enforced or advisory
- status: RESOLVED
- reversibility: TWO-WAY
- blocks: [STORY-8-1, STORY-9-1]
- category: contract (run-report-categories.mjs)
**Context:** At plan time no diff exists, so anchors (lines, files, new modules per size) can only be checked against the planner's own estimate. The brief recommends enforcing only the points cap and treating anchors as estimation guidance. Also open: does a lone L that hits the files anchor but not the lines anchor still fill a whole epic?
**Decision:** Anchors are advisory. `check` never reads them. `check` fails only on: points over the cap, a story with no estimate or one outside S|M|L, the line budget or the `## Stories` line limit, and a missing `Depends on` target. Sizing rule for the planner, stated in `reference/epic-budget.md`: **the largest size any anchor dimension reaches wins.** So a story at L's files anchor is L even if its lines say M, and as an L it fills its epic alone (15 points). `config.mjs` still validates `anchors` values (positive integers) per ADR-0006, because a bad config value fails loudly even when nothing enforces it.
**Why:** At plan time no diff exists, so checking an estimate against an anchor would only check the planner's number against itself. Starting advisory is the reversible direction, because enforcing later only tightens; the calibration debt row below is the trigger for that.
**Note:** The coder for STORY-8-1 must not add anchor logic to `check`.

### ARCH-3: Merged-dependency detection in `/build`
- status: RESOLVED
- reversibility: TWO-WAY
- blocks: [STORY-9-2]
- category: dependency (run-report-categories.mjs)
**Context:** `/build EPIC-n` must stop when a `merged` dependency isn't merged. The options are git ancestry on `main`, `gh pr` state, or a status field in the epic file. It must work in cloud sessions that have only a checkout.
**Decision:** Git only, against the `origin/<base>` that `/build` already fetches. Add a new subcommand `plan-artifacts.mjs ready <EPIC-n> --base <base>`:
1. `Status: STUB` → exit non-zero with `EPIC-n is a stub: run /plan EPIC-n first`.
2. For each `Depends on: EPIC-m (merged)`, read `git show origin/<base>:backlog/EPIC-m.md`. If it's absent, EPIC-m isn't merged. If it's present, every `### STORY-<id>` in that copy must appear as `[STORY-<id>]` in `git log origin/<base>` full messages (`-F --grep`). A missing story means not merged. The message is one line naming the dependency and the first missing story, with exit 3.
3. `released`, `none` or no header → pass. Don't check `released` (out of scope).
4. If the checkout is shallow (`git rev-parse --is-shallow-repository`) and a story isn't found, fail closed and name `git fetch --unshallow origin <base>`.
**Why:** `[STORY-<id>]` landing tags are already a contract: `/review` derives story IDs from them, and epic PRs are merge-committed, so the tags reach `<base>`. The plan file alone isn't proof of a build, because this repo merges plans through docs PRs. A status field is set on the branch before merge and goes stale (build.md HARD RULES). `gh` adds an auth dependency that cloud sessions may lack, and no shipped script needs it to succeed.
**Note:** `/build`'s call to `ready` must *replace* the PRECONDITIONS line about the epic file. `build.md` has 6 bytes of headroom under `scripts/size-budget.json`. `/plan`'s fill-in (STORY-9-4) reuses step 2.

## Debt

Ledgered in docs/TOOLING-DEBT.md by the plan commit.

