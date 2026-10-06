# 0002. Decision records: identity, local store, and the cross-run outcome join

- Status: ACCEPTED
- Date: 2026-10-06
- Reversibility: ONE-WAY (02 exports these fields and 03 groups on them; the
  decision ID is the join key every outcome event and verdict hangs off, so a
  changed identity scheme strands all closed history)
- Resolves: ARCH-1 of `backlog/EPIC-2.md`
- Amends: ADR-0001 (one sentence of its schema-1 contract; see "Fit with
  ADR-0001" below). ADR-0001 otherwise stands unchanged.

## Context

`04-mode-selection.md` requires every lane/mode/override/correction decision to
carry a stable ID, with outcome events appended by *later* runs (`/review`, a
post-merge sweep) and closed with a verdict. ADR-0001's report is per-run,
rebuildable from artifacts, carries NO story IDs, and allows exactly three
pattern-bounded strings. Three problems follow: what a decision ID is built
from without free text; where the record lives when `/build` worktrees,
`/plan`, and `/review` are different checkouts; and whether the report gains
these fields additively or needs a schema bump.

## Options

### Identity
- **A: random UUID per decision** — a resumed build re-reaches the same
  decision point and mints a duplicate; dedupe needs the very join this ID
  was meant to provide.
- **B: deterministic hash of (origin run_id, layer, subject[, seq])** — a
  resumed run re-derives the identical ID; the story ID feeds the hash but
  never appears in the report (one-way), so ADR-0001's no-story-ID stance
  holds.

### Store
- **A: fields embedded only in run reports** — the join authority would be
  scattered across N per-run files, and the subject (story ID) could not be
  stored anywhere, killing the later-run join.
- **B: committed records (e.g. `backlog/decisions/`)** — every run churns
  files into every PR, and story-level telemetry enters git history.
- **C: `<git common dir>/agentic-sdlc/decisions/<decision_id>.json`** — shared
  by all worktrees of the repo (the exact boundary `/build`'s cascade
  crosses), machine-local, never committed. Mirrors how `.agentic-sdlc/runs/`
  already behaves.

### Report fit
- **A: additive optional sections, no bump** — ADR-0001's own policy: adding
  optional fields is not a bump, shipped in lockstep with 02's edge validator.
- **B: schema 2** — forces a new history line for a purely additive change the
  policy explicitly exempts.

## Decision

Identity **B**, store **C**, report fit **A**.

### Identity

`decision_id = first 16 hex chars of sha256("<run_id>\n<layer>\n<subject>[\n<seq>]")`
— pattern `^[0-9a-f]{16}$`. `run_id` is the originating run's uuid (stable
across resumed sessions per the run marker), `layer` a `decision_layer` token,
`subject` the story/task ID or the literal `lane` for the run-level lane
decision, `seq` an ordinal only where one subject can carry several decisions
of one layer (corrections). The writer looks the tuple up in the store before
writing: same tuple → same record, never a duplicate (STORY-2-8 AC2). The hash
is the exportable face of the tuple; the tuple itself stays local.

### Store

One JSON file per decision at `<git common dir>/agentic-sdlc/decisions/
<decision_id>.json`, resolved via `git rev-parse --git-common-dir` so every
worktree sees the same store. The record is the join authority and MAY hold
what the report may not: the identity tuple in clear (story ID, run_id), the
PR number once known, appended outcome events, state
(`open|closed|orphaned`), and the closing verdict. Later runs join by subject
from the store; nothing re-parses prose. The store is never exported — 02's
export surface is the run report only, so the code-free guarantee is
untouched.

Machine-local is accepted in v1: a decision made on machine A and reviewed on
machine B closes as `orphaned` with reason `machine_local`. The gh-based
outcome sweep narrows this (merge states and post-merge fixes come from `gh`,
which works from any checkout); full portability is 02's storage problem, not
this record's.

### Fit with ADR-0001 (the amendment)

Schema 1 gains three **optional, always-omittable** top-level sections, no bump,
lockstep with 02's edge validator per ADR-0001's versioning policy. An absent
value is an omitted key, never a null:

- `decisions`: array of `{ decision_id, layer, rubric?, floor?, score?,
  choice (mode|lane token), alternative?, overridden (bool), fallback (bool),
  verdict?, verdict_rubric?, trigger? (correction_trigger, corrections only) }`
  — decisions this run made.
- `outcome_events`: array of `{ decision_id, event (outcome_event token),
  ...numeric measures }` — events this run appended, including to decisions
  from earlier runs' reports.
- `settlements`: array of `{ decision_id, verdict, verdict_rubric }` — verdicts
  this run's verdict pass settled, including on earlier runs' decisions, whose
  reports are already written.

A decision store that exists but cannot be read is named in `degraded`
(`decision_store`), never reported as a run with no decisions.

This amends exactly one sentence of ADR-0001: "exactly three pattern-bounded
string fields exist in the whole schema" becomes "every pattern-bounded string
field is whitelisted, with its pattern, in the vocabulary module" — the
leak-proof test still walks one module; `decision_id` is the fourth whitelisted
pattern. Everything else in each element is an enum token or a number, so the
code-free property is preserved by construction.

New vocabularies land in `run-report-categories.mjs` (additive):
`decision_layer` (lane|floor|score|override|correction), `correction_trigger`
(blocked_twice|gate_failed_same_ac|edited_outside_declared|
navigator_no_rejections|deferred_one_way|second_redispatch), `outcome_event`
(build|review|merged|abandoned|post_merge_fix|post_merge_revert|corrected),
`decision_verdict` (earned|wasted|held|missed|under_ceremony|over_ceremony|
needed|better|worse), `decision_state` (open|closed|orphaned), and
`orphan_reason` (pr_deleted|machine_local|subject_missing|other — open, since
orphaning causes are not fully enumerable).

## Consequences

- Becomes easy: resumed runs are idempotent on decisions; `/review` and the
  sweep append by store lookup, no prose parsing; 03 groups verdicts by
  `(layer, rubric, choice)` from reports alone; leak-proofing stays a
  mechanical walk of one module.
- Becomes hard: cross-machine pipelines leave orphans until 02 centralises
  storage; renaming a decision vocabulary token is a schema bump like any
  other; the store adds a second local artifact dir to clean-up logic.

## Revisit if

- 02's central storage is live — move the join authority behind its endpoint
  and demote the local store to a cache.
- `orphaned` exceeds ~10% of closed-window decisions in a month — the
  machine-local trade was wrong; accelerate the 02 move.
- One subject accumulates >2 same-layer decisions per run — the `seq` ordinal
  is hiding a modelling gap; widen the layer vocabulary instead.
