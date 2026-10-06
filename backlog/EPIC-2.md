# EPIC-2: Mode selection — a deterministic, auditable choice of lane and pairing

- Outcome: PAIR/SOLO and FAST/deliberate are chosen by a tested script reading
  structured planner fields, not a free-text `risk:` line and a human's gut
  call, with every decision carrying a reason and, later, a verdict.
- Success metric: determinism (same fields + rubric version → same decision,
  100%, fixture-tested); explainability (100% of stories/tasks carry their
  decision, the floor/score that produced it, and its evidence lines); outcome
  coverage (every decision record closed/open/orphaned, ≥95% closed once its
  window passes, fixture-tested). Cost is tracked, not gated, in v1.
- Status: DONE
- Artifacts: docs/briefs/self-improvement/04-mode-selection.md,
  docs/adr/0002-decision-records-and-cross-run-outcome-join.md

## Architect handoffs

| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | Decision-record identity/storage, cross-run outcome join, ADR-0001 fit | STORY-2-8, STORY-2-9 | RESOLVED |
| ARCH-2 | v1 rubric: features/weights/band, outcome window, attribution, de-escalation N, exploration | STORY-2-3, STORY-2-7, STORY-2-9 | RESOLVED |
| ARCH-3 | Runtime-correction autonomy: auto-apply or human confirm | STORY-2-6, STORY-2-7 | RESOLVED |

### ARCH-1: Decision-record identity, storage and cross-run join

- status: RESOLVED
- reversibility: ONE-WAY → **ADR-0002** (amends one sentence of ADR-0001)

**Decision:** `decision_id` = first 16 hex of sha256(origin run_id + layer +
subject [+ seq]) — deterministic, so a resumed run re-derives the same ID, and
one-way, so story IDs never enter the report. Records live one-JSON-per-decision
in `<git common dir>/agentic-sdlc/decisions/` (shared by all worktrees,
machine-local, never committed, never exported); the record holds the identity
tuple in clear plus appended outcome events, state and verdict. Schema 1 gains
two optional sections (`decisions`, `outcome_events`) additively — no bump —
with new vocabularies in `run-report-categories.mjs`. Full field lists,
patterns and vocab tokens are in ADR-0002; implement from there.

### ARCH-2: v1 rubric content

- status: RESOLVED
- reversibility: TWO-WAY (versioned data file; 03 exists to retune it)

**Decision — rubric v1** (evidence: one pair log, 35 merged PRs; too thin to
fit statistically, so v1 transliterates build.md's measured prose rule — "every
defect in paired runs came from reviewing wiring steps, none from helpers" —
into data, biased safe; 03 retunes):

- **Score (per story):** modules_crossed ≤1 → 0, =2 → +2, ≥3 → +3;
  no existing pattern → +2. Thresholds: ≥4 PAIR, ≤2 SOLO, =3 is the borderline
  band → safer option (PAIR). `data_risk` does not score: it routes a SOLO
  result to SOLO-on-Opus (the current prose rule, unchanged).
- **Lane:** recommend deliberate when any floor fires on any story/task or ≥2
  stories score PAIR; else FAST is eligible. Advisory only, per the brief.
- **De-escalation:** N = **5** fixed alternations with zero recorded navigator
  rejections → PAIR→SOLO. Not scaled by AC count (n=1, no correlation
  evidence; fixed is simpler and retunable). Evidence: STORY-1-6's only
  navigator catch (the REDO) landed at alternation 4 of 5 — N=5 would not have
  cut that pair before its catch.
- **"Caught something"** = a navigator rejection recorded structurally: a
  `rejections` counter in `session.json`, written by a flag on the navigator's
  `pair-log.mjs append` (ADR-0001's tag-at-source pattern). Never parsed from
  turns.md prose. Absence-of-review-findings is verdict-time evidence only.
- **Outcome window: 14 days** post-merge. Evidence: observed fix-to-cause
  latencies here are same-day ×3, 2 days ×1, ~10 days ×1 (PR #26 fixing #21/
  #23 behaviour); 14 covers the max with margin.
- **Fix attribution:** by `[STORY-x-y]`/`[EPIC-n]` in the squash-commit subject
  or PR body — the existing convention, deterministic. Files-touched rejected
  for v1 (false positives, not auditable). An unnamed fix goes unattributed
  (see Debt).
- **Layer stacking:** a correction firing is itself the closing outcome of the
  decision it corrects (scored SOLO then escalated → score closes `missed`);
  events after a correction close the correction's own record (PAIR
  earned/wasted). An override's verdict compares outcomes against the
  selector's unchosen alternative, per the brief's table.
- **Exploration: none in v1.** At ~3 feature PRs/month any forced-opposite
  rate yields no usable sample before 02's cross-repo data exists; SOLO review
  findings by risk class are the v1 counterfactual signal (see Debt).
- **Rubric stamp:** in the plan file per decision AND one PR-body line
  (`Rubric: 1`, beside `Mode: FAST`) — the reviewer sees which policy chose.

### ARCH-3: Runtime-correction autonomy

- status: RESOLVED
- reversibility: TWO-WAY (a prose/flag change reverses it)

**Decision:** corrections apply themselves mid-run, logged and reported — no
human confirmation. **Why:** each direction is already safe by construction:
SOLO→PAIR only adds scrutiny (cost bounded by the alternation cap); PAIR→SOLO
freezes the navigator's tests (the brief's hard constraint keeps the safety
already bought); FAST→deliberate never switches mid-run — it stops and
recommends, which *is* the human gate. This matches the pipeline's existing
autonomy (mid-build architect dispatch is unconfirmed; the human's gate is the
merge), and every correction is a decision record 03 can audit.

## Stories

### STORY-2-1: Selection-field schema module

- status: DONE
- estimate: S
- risk: schema drift between the selection-field vocabulary and its readers
- depends_on: []
- blocked_by_arch: []

One module is the single source of truth for the selection fields a story or
task carries (risk class, one-way doors touched, existing-pattern flag,
modules-crossed count, came-back-from-review flag, data-risk vs code-risk), so
the planner and `mode-select.mjs` can never drift on a field's meaning.

**Acceptance criteria**
1. Given the schema module, when `mode-select.mjs` or the planner needs an
   enum's allowed values, then both read them from this one export, never a
   value hardcoded a second time.
2. Given a story or task, when the planner emits its selection fields, then
   every field carries exactly one evidence citation (a brief or AC line
   reference), never freestanding.
3. Given a field value with no evidence citation, when the schema validates
   it, then it is rejected.
4. Given EPIC stories and FAST tasks, when the schema is applied to either,
   then it is the same shape for both.

**Notes:** `plugins/agentic-sdlc/scripts/mode-select-fields.mjs`, plain Node
22, no deps, frozen-exports style of `run-report-categories.mjs`. Risk-class
enum = the brief's named floor classes (money, auth, destructive data).
Out of scope: floors/scoring (2-3); removing the `risk:` line (2-2).

---

### STORY-2-2: Planner emits selection fields instead of the `risk:` line

- status: DONE
- estimate: M
- risk: boot-path budget — `planner.md` must shrink to make room, not add
- depends_on: [STORY-2-1]
- blocked_by_arch: []

The planner emits compact, structured selection fields per story/task, each
citing the brief/AC line that supports it, so `/build` decides from evidence.

**Acceptance criteria**
1. Given a new plan, when the planner writes a story or FAST task, then it
   emits one compact line of selection fields, fitting the existing ~150-line
   epic / FAST budget.
2. Given `planner.md`'s current `risk:` prose rule, when this story lands,
   then it is replaced by a short pointer to the schema module and
   `reference/`, not kept alongside it.
3. Given `scripts/size-budget.mjs`, when it runs after this change, then
   `agents/planner.md` stays at or under its current cap.
4. Given a backlog file written before this story, when `mode-select.mjs` or
   `/build` reads it, then missing selection fields fall back to today's prose
   `risk:` rule, and the fallback is recorded.

**Notes:** `agents/planner.md`, `reference/` for the field-by-field guidance,
backlog templates — the tag-at-source split ADR-0001 used.
Out of scope: `mode-select.mjs` (2-3); backfilling existing `backlog/` files.

---

### STORY-2-3: `mode-select.mjs` — floors and scoring

- status: DONE
- estimate: L
- risk: the floors — a scoring bug costs one wrong recommendation, a floor bug
  removes the override-proof guarantee ("no score overrides them")
- depends_on: [STORY-2-1]
- blocked_by_arch: []

A tested script applies hard floors first, then a versioned rubric score, so
the same inputs always produce the same decision and thresholds retune without
code changes.

**Acceptance criteria**
1. Given a one-way door touched, a review-bounced story, or a money/auth/
   destructive-data risk class, when `mode-select.mjs` scores it, then the
   floor fires and no score field changes the result.
2. Given identical selection fields and rubric version, when it runs twice,
   then it returns the identical decision (the determinism fixture test).
3. Given a borderline score, when it evaluates, then it returns the safer
   option (PAIR for rules or wiring, deliberate for a one-way door).
4. Given the rubric thresholds, when a maintainer retunes them, then the
   change is a one-file diff to the versioned rubric data file, no code
   change.

**Notes:** `plugins/agentic-sdlc/scripts/mode-select.mjs` +
`scripts/mode-select.test.sh`, plain Node 22, no deps. Floors hardcoded;
thresholds in the versioned rubric data file. v1 features, weights, band and
lane rule: per ARCH-2 above, verbatim.
Out of scope: runtime correction (2-6, 2-7); decision records (2-8).

---

### STORY-2-4: `/plan` lane recommendation and override recording

- status: DONE
- estimate: S
- risk: none — follows `/plan`'s existing non-blocking advisory pattern
- depends_on: [STORY-2-3]
- blocked_by_arch: []

`/plan` gets an advisory FAST-vs-deliberate recommendation, with any
disagreement recorded, so the lane choice is auditable but stays the human's.

**Acceptance criteria**
1. Given a brief, when `/plan` runs, then it calls `mode-select.mjs` for a
   lane recommendation and writes it to the plan file alongside the human's
   chosen lane.
2. Given the human's flag disagrees with the recommendation, when the plan
   file is written, then the disagreement is recorded as an override with
   both values visible.
3. Given no disagreement, when the plan file is written, then no override
   entry is added.

**Notes:** `commands/plan.md` gets a call, not inline policy — must not
meaningfully grow its byte count under the ratchet.
Out of scope: per-story modes (2-5); decision-record mechanics (2-8).

---

### STORY-2-5: `/build` per-story mode selection via `mode-select.mjs`

- status: DONE
- estimate: M
- risk: wiring — the MODE SELECTION section runs before every coder dispatch;
  a wrong call changes which stories pair across the whole epic
- depends_on: [STORY-2-3]
- blocked_by_arch: []

`/build` calls `mode-select.mjs` per story instead of the prose rule, keeping
the prose only as fallback, so SOLO/SOLO-on-Opus/PAIR is chosen the same way
every time.

**Acceptance criteria**
1. Given a story with selection fields, when `/build` dispatches it, then it
   calls `mode-select.mjs` and dispatches exactly the mode returned.
2. Given a story with no selection fields (old-format backlog), when `/build`
   dispatches it, then it falls back to today's `risk:` prose rule, and the
   fallback is recorded in the run.
3. Given a human override flag disagreeing with the recommended mode, when
   `/build` dispatches, then the override is recorded, same shape as 2-4.
4. Given `commands/build.md`'s MODE SELECTION section, when this lands, then
   the body is a call and a short stub with the floor/score prose moved to
   `reference/`, and `build.md` stays under its ratchet cap.

**Out of scope:** runtime correction after dispatch (2-6, 2-7).

---

### STORY-2-6: Runtime correction — SOLO to PAIR escalation

- status: DONE
- estimate: M
- risk: data sourcing — the escalation facts (block count, same-AC gate
  failures, out-of-declared-files edits) are not all recorded today
- depends_on: [STORY-2-5]
- blocked_by_arch: []

A SOLO story escalates to PAIR when it proves riskier than its score
predicted, before it goes further wrong.

**Acceptance criteria**
1. Given a SOLO coder blocks twice, fails the gate twice on the same AC, or
   edits a file outside its declared set, when `/build` observes this, then
   the story escalates to PAIR for its remaining work — automatically, no
   human confirmation, per ARCH-3.
2. Given the escalation fires, when the run report is built, then the
   correction and its trigger are recorded.
3. Given a story that never trips a trigger, when `/build` runs it, then no
   escalation fires and nothing is recorded for it.

**Notes:** `commands/build.md`, `scripts/pair-run.mjs`. "Edits outside
declared files" and "same-AC gate failure" have no recorder today — this story
is the trigger `docs/TOOLING-DEBT.md`'s gate-recorder row names.
Out of scope: PAIR→SOLO, FAST→deliberate (2-7); record mechanics (2-8, 2-9).

---

### STORY-2-7: Runtime correction — PAIR to SOLO, and FAST to deliberate

- status: DONE
- estimate: M
- risk: rules — de-escalation must not weaken tests already written (the
  brief's hard constraint)
- depends_on: [STORY-2-5]
- blocked_by_arch: []

A PAIR story hands off to SOLO once the navigator stops rejecting anything,
and a run recommends FAST→deliberate when it defers too much.

**Acceptance criteria**
1. Given a PAIR story's navigator records zero rejections in the first 5
   alternations (N=5 per ARCH-2, read from the `rejections` counter in
   `session.json`), when `pair-log.mjs status` reports this, then `/build`
   hands the story to a SOLO coder for its remaining work — automatically,
   per ARCH-3.
2. Given the handoff, when the SOLO coder continues, then it may not edit the
   navigator's already-written tests — the same rule the driver works under.
3. Given a run defers two or more one-way items, or needs a second
   re-dispatch round, when `/build` finishes, then it recommends
   FAST→deliberate for the next run, without switching the current run's
   lane mid-flight.
4. Given either correction fires, when the run report is built, then it is
   recorded with its trigger, same shape as 2-6.

**Notes:** `scripts/pair-log.mjs` — add the `rejections` counter to
`session.json`, written by a flag on the navigator's `append` (tag-at-source,
never parsed from turns.md prose), per ARCH-2. `reference/fast-mode.md` has
the existing one-re-dispatch rule.
Out of scope: SOLO→PAIR (2-6).

---

### STORY-2-8: Decision records with stable IDs

- status: DONE
- estimate: M
- risk: contract — the join key every outcome event and verdict depends on;
  ADR-0002 is the spec, deviation from it is the one-way mistake
- depends_on: [STORY-2-4, STORY-2-5]
- blocked_by_arch: []

Every floor, score, override and runtime correction writes a decision record
with a stable ID, its layer, the rubric version, the input enums, the choice
made and the alternative not taken, so later outcomes have something fixed to
join against.

**Acceptance criteria**
1. Given a floor firing, a score, an override, or a runtime correction, when
   it is decided, then a decision record with all the fields above is written
   to `<git common dir>/agentic-sdlc/decisions/<decision_id>.json`, with
   `decision_id` derived per ADR-0002.
2. Given the same decision point reached on a later run (e.g. a resumed
   build), when a new record would be written, then the store lookup on the
   identity tuple returns the existing record — same ID, no duplicate.
3. Given a plan or epic file, when a human reads it, then every decision
   shows its reason inline ("the plan file shows each decision with its
   reason").

**Notes:** shape, store path, ID derivation and the report's additive
`decisions` section per ADR-0002. New vocabularies go in
`run-report-categories.mjs` additively — no schema bump.
Out of scope: outcome events and verdict closing (2-9).

---

### STORY-2-9: Outcome events, outcome sweep, and verdict rules

- status: DONE
- estimate: L
- risk: data sourcing — joining later-run `/review` and post-merge facts to an
  earlier run's decision ID across checkouts; ADR-0002's common-dir store is
  the resolution, orphaned-with-reason is the escape
- depends_on: [STORY-2-8]
- blocked_by_arch: []

Build/review outcomes and post-merge facts append to the decision they
resulted from, and a tested script closes each decision with a verdict once
its window passes, so 03 has evidence of which decisions were right.

**Acceptance criteria**
1. Given a build or review run, when it produces tokens/wall-time/
   alternations/navigator-rejections/gate-failures/blocks (build) or
   findings/REVISE-rounds (review), then it appends an outcome event joined
   to the originating decision's ID via the ADR-0002 store.
2. Given a run starts, when the outcome sweep runs, then it uses `gh` to
   collect merge states and post-merge `fix:`/revert commits for every open
   decision — attributed by `[STORY-x-y]`/`[EPIC-n]` in the commit subject or
   PR body, within the 14-day window (both per ARCH-2) — and attaches them as
   outcome events.
3. Given a decision's outcome window has passed, when the verdict script
   runs, then it closes the decision with one verdict from the brief's table
   (PAIR earned/wasted; SOLO held/missed; FAST held/under-ceremony;
   deliberate needed/over-ceremony; override better/worse), applying ARCH-2's
   layer-stacking rule (a correction closes the decision it corrects;
   post-correction events close the correction's own record), stamped with
   the rubric version that made the rule.
4. Given every decision record, when the accounting check runs, then each one
   is in exactly one of closed-with-verdict, open-inside-window, or
   orphaned-with-reason — the 100%-accounted-for fixture test.

**Notes:** verdict rules live in `mode-select.mjs` with the scoring, per the
brief. The sweep follows `run-report.mjs`'s `gh` precedent: capped timeout,
degrade to exit 0/null on failure. `scripts/<name>.test.sh` per
`CONTRIBUTING.md`.
Out of scope: 03's threshold proposals; applying threshold changes
automatically.

### STORY-2-10: Pair logs are local scaffolding, never committed

- status: DONE
- estimate: S
- risk: data sourcing — run-report's PAIR evidence moves from a committed
  file to the machine-local ADR-0002 common-dir store; the in-tree path stays
  as the fallback for pair logs committed before the change
- depends_on: []
- blocked_by_arch: []

Added mid-epic at the human's request: `backlog/pair/` is gitignored, so the
pair log no longer lands with the squash, while run-report still reports a
paired story as PAIR after its worktree is gone.

**Acceptance criteria**
1. Given this repo, when a pair log is created, then `backlog/pair/` is
   ignored by `.gitignore` and the STORY-2-3 pair log is untracked.
2. Given a PAIR story closing, when the navigator runs CLOSE, then it does not
   commit the pair log; navigator.md and pair-loop.md call the log local
   scaffolding that dies with the worktree, and navigator.md does not grow.
3. Given a PAIR story whose worktree was removed after landing, when
   run-report builds the build section, then the story is still PAIR —
   `pair-log.mjs` mirrors session.json to
   `<git common dir>/agentic-sdlc/pair/<STORY-ID>/`, run-report reads it, and
   the in-tree path remains a fallback.
4. Given consuming projects, when they adopt this version, then their setup
   guidance tells them to ignore `backlog/pair/`.
5. Given the shipped scripts, when preflight runs, then `pair-log.test.sh`
   (mirror written, kept in sync) and `run-report.test.sh` (PAIR from the
   mirror with no in-tree log; in-tree fallback) cover the change.

### STORY-2-11: preflight's feat/fix check no longer trips on SIGPIPE

- status: DONE
- estimate: S
- risk: none
- depends_on: []
- blocked_by_arch: []

Fixed `scripts/preflight.sh` section 4 to avoid SIGPIPE errors when `grep -q`
closes the pipe under `set -euo pipefail`, which was causing false negatives
on the feat/fix release-ability check.

**Acceptance criteria**
1. Given `scripts/preflight.sh` section 4, when it checks for feat/fix commits
   in branches with multiple commits, then the SIGPIPE trap from `grep -q`
   closing the pipe is avoided by capturing output first.
2. Given the fixed script, when run on a branch with feat commits since
   origin/main and edited plugins/, then the check passes with "plugins/
   edited, and a feat/fix commit will cut a release".

## Debt

Ledgered in docs/TOOLING-DEBT.md by the plan commit.

