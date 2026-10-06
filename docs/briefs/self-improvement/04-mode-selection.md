# Feature: Mode selection — a deterministic, auditable choice of lane and pairing

## Problem

Two choices set most of what a run costs, and neither is made consistently:

- **PAIR vs SOLO.** `/build` picks per story from a free-text `risk:` line and a
  prose rule ("risk in rules or wiring → pair; when unsure, pair"). Pairing
  roughly doubles a story's turns and puts the navigator, on the escalation
  tier, on every other one. When it is chosen wrongly in either direction, the
  cost is real: a wasted pair, or a SOLO story that comes back from review.
- **`--fast` vs deliberate.** This is entirely the human's gut call, made
  before anything has looked at the brief. Over-ceremony is never flagged.
  Under-ceremony is caught only by the one-way-door tags.

Neither choice is reproducible, because the same story can be judged
differently on a different day or model version. Neither is auditable, because
the plan does not say why a story was paired. Neither can be tuned, because
there is no function whose thresholds a signal could adjust. And once chosen,
neither is corrected when the run shows the prediction was wrong.

## Users

- **Developers running `/plan` and `/build`**, who want pairing only where it
  catches something, and a lane recommendation they can trust or override.
- **Plugin maintainers**, who need to tune the policy from evidence
  (`03-signal-routine.md`) instead of rewriting prose.

## Outcome

Mode selection runs in four layers. Judgment stays where it is unavoidable, and
decisions are made in code:

1. **Feature extraction (model).** The planner emits compact, structured
   selection fields for each story or task, instead of a free-text `risk:`
   line. Every field cites the brief or AC line that supports it.
2. **Hard floors (deterministic).** These rules are applied first and no score
   overrides them. A one-way door brings in the architect even under `--fast`.
   A story that came back from review is PAIR. A risk class of money, auth or
   destructive data is never FAST.
3. **Scoring (deterministic).** A tested script maps the fields to a lane
   recommendation and a per-story mode: SOLO, SOLO on Opus, or PAIR. A
   borderline score takes the safer option. The thresholds live in a versioned
   data file, not in prose.
4. **Runtime correction (deterministic, on observed signals).**
   - **SOLO → PAIR** when the coder blocks twice, fails the gate twice on the
     same AC, or edits outside its declared files.
   - **PAIR → SOLO** when the navigator has rejected nothing in the first N
     alternations.
   - **FAST → deliberate** is recommended when a run defers two or more one-way
     items, or needs a second re-dispatch round.

The plan file shows each decision with its reason. A human can override any
decision, and every override is recorded.

**Every decision is observable through to its outcome.** Each lane
recommendation, floor, score, override and runtime correction gets a decision
record with a stable ID. The outcomes of that decision attach to the same ID as
they happen, and they happen in different runs:

- **build:** tokens, wall time, alternations, navigator rejections, gate
  failures, blocks;
- **review:** findings by severity and surface, REVISE rounds;
- **merge:** merged or abandoned, time to merge;
- **after merge:** a later `fix:` or revert that names the story.

Once the outcome window has passed, a deterministic rule closes the decision
with a verdict:

| Decision | Verdicts |
|---|---|
| PAIR | earned or wasted |
| SOLO | held or missed |
| FAST | held or under-ceremony |
| Deliberate | needed or over-ceremony |
| Override | better or worse than the selector's choice |

Verdicts are written to the run report, so `03-signal-routine.md` can report
how often each kind of decision was right, by rubric version and by layer. It
then proposes threshold changes as issues, with that evidence attached.

## Success metric

- **Determinism:** the same fields and rubric version give the same decision,
  100% of the time. A fixture test enforces this in CI.
- **Explainability:** 100% of stories and tasks in a plan carry their decision,
  the floor or score that produced it, and the evidence lines it rests on.
- **Outcome coverage:** every decision record ends up in exactly one of three
  states: closed with a verdict, open inside its window, or orphaned with a
  reason (for example, the PR was deleted). Baseline n/a → 100% accounted for,
  and ≥95% closed once the window has passed. A fixture test checks the
  accounting.
- **Cost (lagging, tracked not gated in v1):** the share of story tokens spent
  in PAIR falls against the `01-run-report.md` baseline. Over the same period,
  review findings and REVISE rounds on SOLO stories of the same risk class stay
  flat or fall.

## Scope — in

- **The selection-field schema.** Fields include: risk class (enum), the
  one-way doors touched, whether there is an existing pattern to follow, the
  number of modules crossed, whether the story came back from review, and
  whether it is data-risk or code-risk. Each field has an evidence quote. The
  schema is the same for EPIC stories and FAST tasks.
- **Planner changes** so it emits the fields compactly (one line per story),
  within the existing ~150-line epic budget.
- **`plugins/agentic-sdlc/scripts/mode-select.mjs`**, with
  `scripts/mode-select.test.sh`. It contains the floors and scoring, and reads
  a versioned rubric data file. `/plan` calls it to recommend a lane. `/build`
  calls it to choose a mode per story.
- **The lane recommendation at `/plan`.** It is advisory: the human's flag
  wins, and a disagreement is recorded as an override.
- **The runtime correction rules** in `/build` and `pair-run.mjs`. They read
  facts the pipeline already produces: block count, gate results, the diff
  against declared files, and the navigator's rejections in `pair-log.mjs
  status`.
- **Recording overrides** in the plan file and the run report.
- **The decision-outcome loop:**
  - **Decision records.** Each record holds an ID, its layer, the rubric
    version, the input enums, the choice made and the alternative not taken.
  - **Outcome events.** They are appended from `/build` and `/review`, and
    joined to the record by its ID.
  - **An outcome sweep.** At the start of each run it uses `gh` to collect
    merge states and post-merge `fix:` or revert commits for open decisions.
    The human merges outside the pipeline, so something has to go and look.
  - **Verdict rules.** These live in the same tested script as the scoring,
    and their version is stamped on every verdict.
- **Run-report fields for every layer,** added to `01-run-report.md` before its
  schema ADR is accepted. Besides the decision IDs and verdicts, these are:
  - the extracted fields and their evidence;
  - which floor fired;
  - the score and rubric version;
  - any override;
  - each runtime correction and its trigger;
  - the pairing-value outcomes: navigator rejections, tokens and wall time per
    story, and review findings on SOLO stories.

## Scope — out

- Letting a model pick the mode or override the score. The model reads the
  brief, and code decides.
- Applying threshold changes automatically. `03-signal-routine.md` proposes
  them, and a human edits the rubric file.
- Changing the inside of the PAIR loop: the navigator and driver roles, the
  alternation cap and the pair-log shape.
- Changing the fast review floor or the model tiers, beyond the existing
  "SOLO on Opus" mode.
- Re-planning existing `backlog/` files. A plan without selection fields falls
  back to today's prose rule, and the fallback is recorded.
- Making `--fast` automatic. The lane stays a human choice, and the plugin only
  recommends.

## Value dependency

The value is mostly independent of the other briefs:

- **Layers 1–3 have value on their own.** They make choices reproducible and
  explained from the first run, with no telemetry.
- **Layer 4 saves cost on its own.** A pair that hands off to SOLO stops
  paying for a navigator that catches nothing.
- **Calibration needs 01's fields and 03's routine.**

Build it after the 01 schema ADR is accepted, so its run-report fields are part
of that contract. It can run in parallel with 02 and 03.

**What this asks of the other briefs:**
- **01** must carry decision IDs that stay stable across runs, and outcome
  events that a *later* run appends to an *earlier* run's decision. One run
  per report is not enough: a story's decision is made in `/plan` or `/build`,
  and its outcome arrives in `/review` and after merge.
- **02** must export outcome events as they arrive, not only finished runs.
- **03** must group decisions by verdict, rubric version and layer, and treat
  a falling "right" rate after a rubric change as a signal in its own right.

## Technical context

- Existing systems this must integrate with:
  - `agents/planner.md` (the `risk:` line rule)
  - `commands/build.md` `MODE SELECTION`
  - `reference/fast-mode.md` (the five one-way doors, the re-dispatch cap)
  - `scripts/pair-run.mjs` and `scripts/pair-log.mjs`
  - `scripts/plan-artifacts.mjs`
  - `scripts/meter.mjs`
  - `reference/review-fast-floor.md`
- House conventions:
  - Node 22 with no dependencies; every shipped script has a `.test.sh`.
  - Comments say why.
  - `feat:`, because it changes `plugins/**`.
- Hard constraints:
  - **The boot-path size budget can only shrink.** Rubric prose and the
    correction rules go in `reference/` or the script. The command bodies get a
    call and a stub, not the policy.
  - **The data split is fixed.** The rubric thresholds are data, so a proposal
    from 03 is a one-file diff. The floors are code, because a floor that can
    be tuned away is not a floor.
  - **A PAIR → SOLO handoff keeps the navigator's tests as written.** The coder
    that takes over may not edit them. This is the same rule the driver works
    under, so de-escalation cannot weaken the tests already written.
  - **A FAST → deliberate correction never switches the lane mid-run.** It
    stops and recommends, the same as today's escalation to the human.

## Constraints

- Data / compliance: the run-report fields are enums and numbers, per the
  "structured only" decision in `README.md`. Evidence quotes stay in the
  local plan file and never go into the report.

## Decisions already made

- The model extracts the fields, and a deterministic function decides. The
  model never picks the mode.
- A borderline score takes the safer option: PAIR for rules or wiring,
  deliberate for a one-way door.
- Overrides are allowed and always recorded.
- Runtime corrections are deterministic rules on observed facts, not a model
  judging how a run is going.
- No decision without an outcome. A decision type whose outcome cannot be
  observed is not shipped until it can be.

## Open questions

- **The v1 features, weights and borderline band.** Ideally these are derived
  from this repo's existing pair logs and PR history, not invented.
- **What counts as "pairing caught something".** Candidates are a rejected
  increment, a navigator-written test that failed against the driver's first
  attempt, or the absence of review findings on the story. Which of these does
  the de-escalation rule count?
- **N for PAIR → SOLO.** Should it scale with the story's AC count?
- **Whether runtime escalation needs a human to confirm.** It may run
  automatically, with the correction logged and reported.
- **How to measure the counterfactual.** A PAIR story never shows what SOLO
  would have missed. Is a small, recorded exploration rate (forcing the
  opposite mode on a share of borderline stories) worth its cost, or do
  SOLO-story review findings by risk class give enough signal?
- **The outcome window.** How long after merge does a `fix:` or revert still
  count against a decision? How is a fix tied to a story? A story ID in the PR
  body, or the files touched?
- **Attribution when layers stack.** If a story was scored SOLO, then
  corrected to PAIR, then found by review, which decision gets the verdict?
- **Where the rubric version is stamped.** In the plan file only, or also in
  the PR body next to `Mode: FAST`, so the reviewer knows which policy chose
  the mode?
