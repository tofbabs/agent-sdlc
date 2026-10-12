# EPIC-10: Plan budget configurable through `config.mjs`

- Brief: docs/briefs/epic-size-budget.md
- Part: 3 of 3
- Depends on: EPIC-9 (merged)
- Outcome: `.claude/agentic-sdlc.json` tunes the epic budget (cap, weights, line budget, anchors) through a validated `config.mjs`, and the planner and `check` read the same numbers. A missing file means the defaults.
- Status: TODO
- Artifacts: docs/adr/0007-config-file-shared-with-consent.md
- Lane: deliberate — recommended deliberate (rubric 1): 2 stories are PAIR, lane is deliberate
- Points: 8 against cap 15

## Architect handoffs
| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | `consent.mjs` already reads/writes `.claude/agentic-sdlc.json` (`telemetry`, no `schema`); ADR-0006 makes `config.mjs` the only opener and rejects `schema` != 1. Coexistence? | STORY-10-1 | RESOLVED (ADR-0007) |
| ARCH-2 | How does the planner get the effective numbers `check` uses, and does `reference/epic-budget.md` keep literal defaults? | STORY-10-2 | RESOLVED |
| ARCH-3 | Validation ranges and cross-field rules for `plan.epic`; errors or warnings? | STORY-10-1, STORY-10-2 | RESOLVED |

## Stories

### STORY-10-1: `config.mjs` reader with the `plan` key; `check` and `consent` use it

- status: TODO
- mode: PAIR — recommended PAIR (rubric 1): score 3 in the gap resolves to PAIR, flagged borderline
- estimate: M
- select: risk_class=none@brief:L125 one_way_doors=0@brief:L125 existing_pattern=yes@brief:L190 modules_crossed=3@brief:L125 review_bounced=no@brief:L125 risk_kind=code@brief:L125
- depends_on: []
- blocked_by_arch: [ARCH-1, ARCH-3]

**As a** developer on a consuming project **I want** `check` to take its cap, weights, line budget and stories-by-line limit from `.claude/agentic-sdlc.json` **So that** my right-sized epic is not the plugin's.

**Acceptance criteria**
1. Given no `.claude/agentic-sdlc.json`, or one holding only `{"telemetry": {...}}` with no `schema`, when `plan-artifacts.mjs check EPIC-n` runs, then it behaves exactly as today (15 points, 150 lines, Stories by line 40), exits 0 where it did, and prints nothing on stderr.
2. Given `plan.epic` `{ "cap": 8, "points": { "S": 2, "M": 4, "L": 8 } }`, when `check` runs on 2 M + 1 S, then it exits non-zero and the message names 8 as the cap; on 2 M (exactly 8) it exits 0.
3. Given `plan.epic.max_lines` or `stories_by_line` set, when `check` runs, then the limits it reports are the configured ones.
4. Given invalid JSON, a wrong type, a value breaking an ARCH-3 rule, or a `schema` present and not 1, when `config.mjs get plan.epic.cap` or `check` runs, then it prints `config: <dotted.key>: <problem>`, exits 2, and `check` never falls back to a default. An unknown key prints one stderr warning and is ignored.
5. Given `node config.mjs get plan.epic.cap`, then it prints the effective value bare. `readConfig`, `readRaw` and `updateConfig` are exported (ADR-0007). `consent.mjs` does its file I/O only through them, and `consent.mjs set true` on a file with a JSON syntax error exits non-zero and leaves the file byte-identical.

**Technical notes**
- New `plugins/agentic-sdlc/scripts/config.mjs` + `scripts/config.test.sh`, built to ADR-0006 as amended by ADR-0007. Defaults live there once; delete `POINTS`, `EPIC_CAP`, `MAX_LINES`, `STORIES_BY_LINE` from `plan-artifacts.mjs` (lines 38-41) and import `readConfig()`.
- `scripts/plan-artifacts.test.sh` case 8 and the drift test (~l.214-225) read those constants; repoint them at `config.mjs` defaults. Add the invalid-JSON `set` case to `scripts/consent.test.sh`; its existing cases must pass unchanged.
- Plain Node, no dependencies.

**Out of scope**
- `plan.epic.anchors` and the planner's reading of the numbers (STORY-10-2); any other key (EPIC-7 adds `review.*`).

### STORY-10-2: Config covers anchors and the planner's numbers end to end

- status: TODO
- mode: PAIR — recommended PAIR (rubric 1): score 3 in the gap resolves to PAIR, flagged borderline
- estimate: S
- select: risk_class=none@brief:L125 one_way_doors=0@brief:L125 existing_pattern=yes@brief:L190 modules_crossed=3@brief:L125 review_bounced=no@brief:L125 risk_kind=code@brief:L125
- depends_on: [STORY-10-1]
- blocked_by_arch: [ARCH-2, ARCH-3]

**As a** planner agent **I want** the effective weights, line budget and anchors from the same source as `check` **So that** I size and split against the numbers that will gate me.

**Acceptance criteria**
1. Given `plan.epic.points` `{ "S": 2, "M": 4, "L": 12 }` and `cap` 12, when `check` runs on an epic of 2 M + 1 S, then it scores 10/12 and passes. An unknown size key under `points` or `anchors`, or anchors that decrease from S to M to L, fails validation.
2. Given `plan.epic.anchors` set, when `config.mjs get plan.epic` runs, then it prints one line of compact JSON of the whole effective `plan.epic`, with defaults merged per leaf and the configured anchors included. `check` still never reads anchors.
3. Given `reference/epic-budget.md`, then it names `.claude/agentic-sdlc.json` as the source, labels its numbers as defaults, and tells `/plan` to run `config.mjs get plan.epic` before spawning the planner (STEP 1 and FILL-IN), paste the JSON into the planner prompt as the effective budget, and stop on a non-zero exit. `planner.md` and `plan.md` are byte-identical to before.
4. Given the test suite, then a case fails if the numbers in `reference/epic-budget.md` differ from the `config.mjs` defaults, and cases cover a custom config, a bad config and a missing file.

**Technical notes**
- Edit only `reference/epic-budget.md` (exempt from the size budget) and `docs/setup.md` (a short settings note beside "Telemetry consent"). The planner has no Bash tool, so the orchestrator runs the call.

**Out of scope**
- Enforcing anchors in `check` (EPIC-9 ARCH-2: advisory); estimate-vs-actual calibration (ledgered in `docs/TOOLING-DEBT.md`).

### ARCH-1: `consent.mjs` and `config.mjs` sharing one file
- status: RESOLVED
- reversibility: ONE-WAY — docs/adr/0007-config-file-shared-with-consent.md
- category: contract (run-report-categories.mjs)

**Decision:** Per ADR-0007 (amends ADR-0006). `config.mjs` owns all file I/O through `readConfig` (strict, defaults applied), `readRaw` (parse only) and `updateConfig` (read, mutate, write; it refuses unparseable files and never writes defaults). `consent.mjs` moves onto `readRaw`/`updateConfig` and keeps its fail-soft meaning. A missing `schema` means 1. `telemetry` is a registered key that `readConfig` neither warns about nor validates.
**Why:** Consenting projects already have this file committed with no `schema`, so rejecting a missing `schema` would break `/plan` on upgrade. One writer also fixes `consent set` silently erasing a file it can't parse.

### ARCH-2: How the planner reads the numbers
- status: RESOLVED
- reversibility: TWO-WAY
- category: contract (run-report-categories.mjs)

**Decision:** There is one call, `config.mjs get plan.epic`. `get` prints a string bare, a number or boolean as its literal, and an object as one line of compact JSON. The planner has no Bash, so `/plan` runs the call and pastes the JSON into the planner prompt. The instruction lives in `reference/epic-budget.md`, which `/plan` already `cat`s in STEP 1 and follows for FILL-IN. `planner.md` and `plan.md` are unchanged. The reference keeps its literal numbers, labelled as defaults that the prompt's JSON overrides, and the drift test pins them to `config.mjs`.
**Why:** One call is one Bash round-trip and can't mix keys. Putting it in `reference/` costs the boot path nothing, and `plan.md` has 2 bytes of headroom. Literal defaults keep the reference readable for anyone without a config.

### ARCH-3: `plan.epic` validation
- status: RESOLVED
- reversibility: TWO-WAY
- category: contract (run-report-categories.mjs)

**Decision:** Validate the effective config: the file merged over the defaults per leaf, so a partial override is checked against the defaults it sits beside. Every rule below is an **error** (exit 2, `config: <key>: <problem>`). A message that cites a default says so ("15, the default").
- `plan` and `plan.epic` are objects. Arrays and null are errors.
- `points.{S,M,L}`, `cap`, `max_lines`, `stories_by_line` and `anchors.{S,M,L}.{lines,files}` are integers ≥ 1. There are no upper bounds.
- `points.S ≤ points.M ≤ points.L ≤ cap`. An L must fit one epic alone.
- `stories_by_line ≤ max_lines`.
- For each anchor dimension, S ≤ M ≤ L.
- A size name other than S|M|L under `points` or `anchors` is an error.

The only **warning** (stderr, then ignored) is an unknown key name anywhere else, such as `plan.foo`, `plan.epic.foo` or `anchors.M.modules`, as ADR-0006 rule 3 says.
**Why:** ADR-0006 has exactly one warning class, so every other rule is an error. An unknown size is a typo like `"m"`, and ignoring it would quietly apply the plugin's weight, which is the silent fallback the ADR forbids. Starting strict is the reversible direction, because relaxing a rule later breaks no file.
**Note:** STORY-10-1 implements the points, cap and lines rules. STORY-10-2 implements the anchors rules.

## Debt

Ledgered in docs/TOOLING-DEBT.md by the plan commit.

