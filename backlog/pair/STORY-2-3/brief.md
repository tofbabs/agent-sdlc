# STORY-2-3: `mode-select.mjs` — floors and scoring

Branch feat/STORY-2-3 off feat/EPIC-2 (integration base `main`). Release-please scope: `agentic-sdlc`.
Gate: `./scripts/preflight.sh`. KNOWN PRE-EXISTING FAILURE: 3 cases in `scripts/meter.test.sh`
("marketplace fallback ran", "cache resolution ran", "override ran") fail on the epic tip
before this story — ignore those three, nothing else may fail.

A tested script applies hard floors first, then a versioned rubric score, so the same inputs
always produce the same decision and thresholds retune without code changes.

## Acceptance criteria (verbatim)
1. Given a one-way door touched, a review-bounced story, or a money/auth/destructive-data risk
   class, when `mode-select.mjs` scores it, then the floor fires and no score field changes the result.
2. Given identical selection fields and rubric version, when it runs twice, then it returns the
   identical decision (the determinism fixture test).
3. Given a borderline score, when it evaluates, then it returns the safer option (PAIR for rules
   or wiring, deliberate for a one-way door).
4. Given the rubric thresholds, when a maintainer retunes them, then the change is a one-file diff
   to the versioned rubric data file, no code change.

## Files owned
- NEW `plugins/agentic-sdlc/scripts/mode-select.mjs` — plain Node 22, no deps, header-comment style
  of `run-report-categories.mjs` / `pair-log.mjs` (comments say why, never what).
- NEW versioned rubric data file, e.g. `plugins/agentic-sdlc/scripts/mode-select-rubric.json`
  carrying `"version": 1`.
- NEW `scripts/mode-select.test.sh`, wired into `scripts/preflight.sh` the same way
  `scripts/mode-select-fields.test.sh` is (section 6c).
Out of scope: runtime correction (STORY-2-6/2-7); decision records/IDs (STORY-2-8); `/plan` and
`/build` wiring (2-4/2-5); verdict rules (2-9 adds them to this same script later).

## Binding: the field schema (STORY-2-1, landed) — import it, never re-hardcode
`plugins/agentic-sdlc/scripts/mode-select-fields.mjs` exports `FIELDS`, `FIELD_NAMES`,
`validate(fields)` → error strings, `parse(line)` → fields (throws), `format(fields)`.
Fields, each `{ value, evidence }`: `risk_class` none|money|auth|destructive_data;
`one_way_doors` int≥0; `existing_pattern` bool; `modules_crossed` int≥0; `review_bounced` bool;
`risk_kind` code|data. One-line form:
`- select: risk_class=none@AC1 one_way_doors=0@brief:L40 existing_pattern=yes@AC2 modules_crossed=1@AC1 review_bounced=no@AC1 risk_kind=code@brief:L12`
Invalid fields → refuse (non-zero exit / thrown error), never guess.

## Binding: ARCH-2 rubric v1 (verbatim from the epic)
- Score (per story): modules_crossed ≤1 → 0, =2 → +2, ≥3 → +3; no existing pattern → +2.
  Thresholds: ≥4 PAIR, ≤2 SOLO, =3 is the borderline band → safer option (PAIR). `data_risk`
  (risk_kind=data) does not score: it routes a SOLO result to SOLO-on-Opus.
- Lane: recommend deliberate when any floor fires on any story/task or ≥2 stories score PAIR;
  else FAST is eligible. Advisory only.
- Weights, thresholds and band live in the rubric data file; the floors are HARDCODED in the
  script (a retune must never be able to remove a floor).

## Binding: floors (orchestrator interpretation of the brief — apply first, no score overrides)
- `one_way_doors > 0` → floor `one_way_door`: story mode PAIR; lane deliberate (architect runs
  even under --fast).
- `review_bounced` → floor `review_bounced`: PAIR.
- `risk_class` in money|auth|destructive_data → floor `risk_class`: PAIR; never FAST (lane deliberate).

## Suggested output contract (later stories consume it — keep it stable)
Per story: `{ rubric: <version>, mode: "SOLO"|"SOLO_OPUS"|"PAIR", floor: <token>|null,
score: <number>|null, borderline: bool, reason: "<one line naming the floor or score parts>" }`.
Lane over a set of stories/tasks: `{ rubric, lane: "deliberate"|"fast", floors: [...], pair_count, reason }`.
CLI: e.g. `node mode-select.mjs story --line '<select line>'` and
`node mode-select.mjs lane --file <backlog file>` (reads every `- select:` line), JSON on stdout.
Export the pure functions too, so 2-4/2-5/2-9 can import them.
