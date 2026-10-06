# EPIC-1: Run report — a code-free decision trace per run

- Outcome: every `/agentic-sdlc:plan`, `/agentic-sdlc:build` and
  `/agentic-sdlc:review` run leaves exactly one schema-versioned, code-free JSON
  run report in `<project>/.agentic-sdlc/runs/`, derived from artifacts the
  pipeline already writes (backlog files, pair-log session state, review
  comments, `docs/TOOLING-DEBT.md`, the existing meter record).
- Success metric: coverage of valid reports across bench fixtures and this
  repo's own runs, 0% → 100%; a schema test proves no field accepts an
  unbounded string, enforced in preflight and CI.
- Status: TODO
- Artifacts: docs/adr/0001-run-report-schema-and-vocabulary.md, docs/briefs/self-improvement/01-run-report.md

## Architect handoffs

| ID | Question | Blocks | Status |
|----|----------|--------|--------|
| ARCH-1 | Run-report schema shape and version, written as an ADR (one-way door once 02/03 export it) | STORY-1-1, STORY-1-2, STORY-1-3, STORY-1-4, STORY-1-5 | RESOLVED |
| ARCH-2 | Which lifecycle point builds the report (SessionEnd / last Stop / end-of-command) | STORY-1-6 | RESOLVED |
| ARCH-3 | Category sourcing for fields with no existing closed vocabulary (ARCH-handoff categories, review-finding categories, debt categories) and whether the vocabulary carries an `other` escape value | STORY-1-1, STORY-1-3, STORY-1-4, STORY-1-5 | RESOLVED |
| ARCH-4 | What `run-report.mjs` does for a run that spans multiple sessions (e.g. a build resumed the next day) | STORY-1-6 | RESOLVED |

### ARCH-1: Run-report schema shape and version

- status: RESOLVED
- reversibility: ONE-WAY — see `docs/adr/0001-run-report-schema-and-vocabulary.md`
- category: contract

**Decision:** Schema 1 as specified field-by-field in ADR 0001. Six sections
(`run`, `plan`, `build`, `review`, `debt`, `cost`) plus `degraded`, all always
present. Exactly three pattern-bounded strings in the whole schema
(`run.run_id` uuid-v4, `run.plugin_version` semver, `run.ended_at` ISO-8601
UTC); every other field is a vocabulary enum, a number, `null`, or a nested
object/array of the same. `null` means "input missing, named in `degraded`";
`0` means measured zero — the meter's no-silent-zeros rule. `cost` embeds the
meter record's `totals` and `derived` verbatim (all-numeric) and nothing else:
`label`/`by_agent`/`by_model`/`spawns` carry free strings and are excluded.
`run_id` is generated per run and doubles as 02's idempotency key, so it ships
now rather than forcing a schema bump later.

**Why:** Follows `meter.mjs`'s own precedent (integer `schema`, `degraded`
array), and the per-finding/per-story arrays keep the granularity 03's
grouping signature needs while staying enum-and-number only.

### ARCH-2: Lifecycle trigger point

- status: RESOLVED
- reversibility: TWO-WAY (local wiring only; the report file, not the trigger,
  is the contract)
- category: lifecycle

**Decision:** One hook template `templates/hooks/run-report.sh`, registered on
**two documented events** and dispatching on `hook_event_name`:

1. **`UserPromptSubmit` marks the run boundary.** The payload carries the raw
   `prompt` (verified against current hook docs, 2026-10-06). When the prompt
   starts with `/agentic-sdlc:plan`, `:build` or `:review`, the hook writes or
   rotates a gitignored marker `.agentic-sdlc/run-state.json` — generated
   `run_id`, command, lane (`--fast` present in the prompt), the raw target
   arg (local file only, never in the report), `started_at`, plus snapshots
   taken at run start: the set of `ARCH-<n>` IDs already in the backlog file
   and the count of `###` entries in the ledger's "Logged by agents" block
   (so mid-build handoffs and this-run debt rows are diffs, not guesses). Any
   other prompt: exit 0 immediately after the prefix check. **Print nothing
   to stdout** — UserPromptSubmit stdout is injected into the model's context.
   If a *different* pipeline command arrives while a marker exists, the hook
   first builds the superseded run's report (final rebuild), then writes the
   new marker — this closes the "/plan then /build in one session" hole.
2. **`SessionEnd` builds the report.** SessionEnd cannot block and has a
   **1.5-second budget shared across all SessionEnd hooks**, so the hook
   spawns `node run-report.mjs report …` **detached** (nohup/setsid, output
   to /dev/null) and exits 0 at once; the detached build does the file reads
   and the single short-timeout `gh pr view` for the review section. No
   marker on disk → exit 0, write nothing.

Not chosen: `Stop` (fires every turn — exactly the problem the handoff names);
end-of-command instructions in `commands/*.md` (misses aborted runs, and every
byte there is ratcheted boot-path budget); `UserPromptExpansion` (newer event,
no advantage over the prefix check that justifies depending on it).

**Why:** The pair covers every exit path — completed, superseded in-session,
and aborted-by-closing-the-laptop — with zero agent/boot-path bytes, and the
builder stays a pure after-the-fact derivation, which the brief prefers.

**Note:** The run marker is local state and may carry IDs/paths; only the
report is code-free. Mirror `meter.sh`'s degrade style throughout: `node`
missing, marker unreadable, anything odd → exit 0.

### ARCH-3: Category sourcing and `other`

- status: RESOLVED
- reversibility: ONE-WAY — vocabularies are part of the exported contract;
  see `docs/adr/0001-run-report-schema-and-vocabulary.md`
- category: contract

**Decision:** **Tag at source.** The agent that already writes an artifact
adds exactly one vocabulary token to it, and `run-report.mjs` parses that
token and never the surrounding prose (a plain-Node builder cannot classify
text, so an untagged category simply does not exist):

- ARCH handoff detail blocks gain `- category: <arch_category>` (planner at
  plan time, architect for mid-build handoffs).
- Review finding lines become `F<n>: <SEVERITY> [<finding_category>] — …`.
- Debt entries gain `- Category: <debt_category>` beside `Risk:`.

Vocabulary contents are fixed in ADR 0001: `arch_category` (contract, data,
lifecycle, dependency, security, cost, process, other), `finding_category`
(correctness, testing, security, performance, consistency, clarity, process,
other), `debt_category` (missing_test, hardcoded_value, stubbed_integration,
deferred_migration, robustness, observability, other), plus the closed
operational enums and `degraded_input`. All live in ONE module,
`plugins/agentic-sdlc/scripts/run-report-categories.mjs`.

**`other`: yes, on the three open vocabularies only.** A missing or unknown
token maps to `other` deterministically — never a rejected report, because a
single untagged finding must not void the 100%-coverage metric. The dumping-
ground risk is handled by measurement, not prohibition: `other` share per
vocabulary is a first-class drift signal for 03, and ADR 0001's revisit line
triggers a vocabulary extension at ~20% sustained.

**Why:** Tagging where the artifact is already written costs three one-line
template changes (each byte-offset under the size ratchet) instead of an
event-emission protocol, and keeps the builder deterministic.

### ARCH-4: Multi-session runs

- status: RESOLVED
- reversibility: TWO-WAY (write semantics are local; `run.sessions` and
  `run.wall_clock_s`, the only schema-visible parts, are fixed by ADR 0001)
- category: lifecycle

**Decision:** **One run = one report, amended by full rebuild.** The report
file is `.agentic-sdlc/runs/<run_id>.json` and every trigger (SessionEnd, or
supersession at the next pipeline prompt) rebuilds the whole report from
current artifacts and **overwrites** that one file — derivation is idempotent,
so there is nothing to stitch and no append conflict. Run identity comes from
the marker: a new pipeline prompt naming the **same command and target** as
the existing `.agentic-sdlc/run-state.json` continues that run (`sessions` +1,
`started_at` for the new session recorded); a different command or target
finalizes the old run and starts a new marker with a fresh `run_id`.
`wall_clock_s` is the sum over sessions of (session end − command start),
accumulated in the marker — approximate by design (logged under ## Debt).
`outcome` is derived at build time: `blocked` if any pair `session.json` says
blocked or an un-resolved mid-build ARCH exists; `completed` if the command's
completion artifact exists (plan: backlog file with stories; build: epic PR
open/stories DONE; review: a round comment for the latest round); else
`aborted` — and a later resume simply rebuilds the same file and flips it.

**Why:** Overwrite-by-rebuild is the only semantics that makes double-fires,
crashes and resumes all harmless, and it matches 02's idempotency key
(stable `run_id`, last write wins locally, first write wins at the store).

## Stories

### STORY-1-1: Category vocabulary module

- status: TODO
- estimate: S
- risk: schema drift between the vocabulary file and the agents/tests that read it
- depends_on: []
- blocked_by_arch: [ARCH-1, ARCH-3]

**As a** plugin maintainer
**I want** one file that is the single source of truth for every closed
category enum the run report uses (ARCH-handoff categories, review-finding
categories, debt categories, build-mode values)
**So that** a category can never drift between what an agent writes and what
the schema accepts

**Acceptance criteria**
1. Given the vocabulary file, when `run-report.mjs`'s schema validates a
   report, then every enum field's allowed values come from this one file, not
   from a value hardcoded a second time in the validator.
2. Given a value not in the vocabulary, when it is passed into any enum field,
   then validation rejects it rather than silently accepting it as text.
3. Given ADR 0001, when the vocabulary file is built, then it matches the
   ADR's "Vocabulary" section exactly — no enum or value added or omitted.
4. Given the three source artifacts, when their templates are updated, then
   each carries its one-token tag per ARCH-3: the ARCH handoff block's
   `- category: <arch_category>` line (planner.md / architect.md), the
   finding line's `[<finding_category>]` token (code-reviewer.md), and the
   debt entry's `- Category: <debt_category>` line (the ledger's "Logged by
   agents" template and the plugin doc that mirrors it) — and every budgeted
   file touched is byte-offset so `scripts/size-budget.mjs` still passes.

**Technical notes**
- Plain Node, zero deps, following `meter.mjs` / `plan-artifacts.mjs` style.
- `plugins/agentic-sdlc/scripts/run-report-categories.mjs` (ADR 0001 fixes
  the path): exports frozen enum objects for import by the validator/test,
  and prints JSON when invoked directly so an agent can read it on demand
  without it ever entering the boot path.
- Comments explain why a category exists, not what it is.

**Out of scope**
- Any free-text fallback for an uncategorizable case — missing/unknown tags
  map to `other` at build time (ARCH-3), they are never stored as text.

---

### STORY-1-2: `run-report.mjs` — run, plan and cost sections

- status: TODO
- estimate: M
- risk: embedding the meter record wrong (re-deriving costs instead of reusing `meter.mjs`'s own totals, which the brief explicitly forbids)
- depends_on: []
- blocked_by_arch: [ARCH-1]

**As a** plugin maintainer
**I want** `run-report.mjs` to build the `run`, `plan` and `cost` sections of
the schema — plugin version, command, lane, outcome, wall-clock; epic/story/task
counts and ARCH handoffs by category; the existing meter record's totals
embedded as-is
**So that** a plan run already produces a readable, schema-valid partial
report before build/review sections exist

**Acceptance criteria**
1. Given a completed `/agentic-sdlc:plan` run with a meter record on disk, when
   `run-report.mjs report` runs against the backlog file and the meter record,
   then the output's `cost` section equals the meter record's totals/derived
   fields verbatim (no re-parsing of transcripts).
2. Given a backlog epic file with N stories and M `ARCH-<n>` handoffs, when the
   report is built, then `plan.story_count` and `plan.arch_handoffs` (by
   category) match the file.
3. Given a required input is missing (no meter record, unreadable backlog
   file), when the report is built, then the dependent fields are `null` and
   the input is named in `degraded` using the `degraded_input` enum from the
   vocabulary module — never a zero in its place, and never a free-text
   degraded message (ADR 0001 tightens `meter.mjs`'s pattern here: the report
   is exported later, so even `degraded` is enum-only).
4. Given any field in these sections, when the schema test runs, then no field
   accepts an unbounded string (ties into STORY-1-7's test, but each section
   must not regress it on its own).

**Technical notes**
- New `plugins/agentic-sdlc/scripts/run-report.mjs`, with
  `scripts/run-report.test.sh` (plain Node, no deps) per `CONTRIBUTING.md`'s
  "shipped scripts are tested" rule.
- `run.run_id`, `run.sessions`, lane, command and the wall-clock sum come
  from the `.agentic-sdlc/run-state.json` marker (ARCH-2/ARCH-4); no marker →
  `run_state` in `degraded`. `run.plugin_version` comes from the installed
  `plugin.json`. `cost` embeds ONLY the meter record's `totals` and `derived`
  (verbatim) plus its `schema` — `label`/`by_agent`/`by_model`/`spawns` carry
  free strings and must not be embedded (ADR 0001).
- Reuse `meter.mjs`'s record shape by reading its JSON output, not its internals.
- Backlog epic/story/ARCH-handoff counts are parsed from `backlog/EPIC-<n>.md`
  / `FAST-<n>.md` structure (same files `plan-artifacts.mjs` already parses
  for `- Artifacts:` and `## Debt`).

**Out of scope**
- The `build` and `review` sections (STORY-1-3, STORY-1-4).
- Sending or exporting the report anywhere.

---

### STORY-1-3: `run-report.mjs` — build section

- status: TODO
- estimate: M
- risk: data sourcing — per-story mode/alternation/block counts live across pair-log session.json, git history and the epic file, not one place
- depends_on: [STORY-1-2]
- blocked_by_arch: [ARCH-1, ARCH-3]

**As a** plugin maintainer
**I want** the report's `build` section populated per story — its mode
(SOLO/PAIR/FAST), alternation count, architect blocks by category, gate
runs/failures, REVISE rounds
**So that** an expensive or stuck build leaves a record of where the decisions
were made

**Acceptance criteria**
1. Given a PAIR story's `backlog/pair/<STORY-ID>/session.json`, when the report
   is built, then the story's `alternation` count in the report matches the
   session file's `alternation` field exactly.
2. Given an ARCH handoff raised mid-build (an `ARCH-<n>` present in the epic
   file but absent from the run marker's start-of-run snapshot), when the
   report is built, then it is counted in `build.arch_blocks` under the
   handoff's `- category:` token (unknown/missing token → `other`) — never as
   free text, and at build level, not per story: `session.json` clears `arch`
   on resume, so per-story attribution of a resolved block is not derivable
   (see ## Debt).
3. Given a SOLO story with no pair log, when the report is built, then its
   `mode` reads `SOLO` and its `alternations` reads `0`, not an omitted field.
4. Given a story the build never touched, when the report is built, then it is
   absent from `build.stories`, not present with zeroed fields.

**Technical notes**
- Reads `pair-log.mjs`'s `session.json` / `status` output, not its markdown —
  the markdown is free text and exactly what this brief must never carry.
- Per-story fields are `mode` and `alternations` only, in backlog-file order,
  with NO story IDs (ADR 0001). PAIR: `alternations` from `session.json`;
  SOLO/FAST: `alternations: 0`.
- `build.revise_rounds` is run-level, not per story: count the PR's
  "Review — round <k>" comments addressed by a REVISE invocation (revise
  branches are local and deleted, so git history cannot attribute rounds to
  stories). ARCH decision, not a guess.
- `build.gate_runs` / `build.gate_failures`: nothing records gate executions
  today — always `null` plus `gate_history` in `degraded` (see ## Debt). Do
  not invent a source.

**Out of scope**
- Changing what `pair-log.mjs` records — this story only reads it.
- The `review` and `debt` sections.

---

### STORY-1-4: `run-report.mjs` — review section

- status: TODO
- estimate: S
- risk: data sourcing — parsing review-round structure out of GitHub PR comments without capturing any of their free text
- depends_on: [STORY-1-2]
- blocked_by_arch: [ARCH-1, ARCH-3]

**As a** plugin maintainer
**I want** the report's `review` section populated with round number, verdict,
and findings by category and severity
**So that** "this PR needed three review rounds" is a readable fact, not
something only visible by re-reading transcripts

**Acceptance criteria**
1. Given a PR with comments `## Review — round 1` and `## Review — round 2`,
   when the report is built, then `review.rounds` reads `2`.
2. Given a round's findings `F1..Fn` written as `F<n>: <SEVERITY>
   [<finding_category>] — …`, when the report is built, then each finding
   contributes one `{round, category, severity}` entry — the bracketed token
   parsed, never the finding's text, and a missing/unknown token maps to
   `other` (ARCH-3).
3. Given the GitHub verdict on the latest round, when the report is built,
   then `review.verdict` reads `APPROVE`, `REQUEST_CHANGES`, `COMMENT` (the
   reviewer's COMMENT-fallback), or `NONE` when no review exists — matching
   the source exactly, from the vocabulary module's `verdict` enum.
4. Given no review has run yet, when the report is built, then `review` is
   present with zero rounds and verdict `NONE`, not omitted — so a
   `plan`-only or `build`-only report still validates against the same schema.

**Technical notes**
- Source is the PR's review comments (`"Review — round <k>"` heading, finding
  IDs `F1..Fn`, from `code-reviewer.md` / `review.md`) — via `gh pr view
  --json comments` or similar, not a stored transcript.
- Category/severity enums come from ARCH-3's vocabulary file (STORY-1-1).

**Out of scope**
- Changing the review comment format itself.
- Capturing anything from a finding beyond its category and severity.

---

### STORY-1-5: `run-report.mjs` — debt section

- status: TODO
- estimate: S
- risk: none: follows the backlog-file-parsing pattern `plan-artifacts.mjs`'s `## Debt` regex already uses
- depends_on: [STORY-1-2]
- blocked_by_arch: [ARCH-1, ARCH-3]

**As a** plugin maintainer
**I want** the report's `debt` section to count tooling-debt rows logged
during the run, by category
**So that** "this run added three debt rows" is visible without opening
`docs/TOOLING-DEBT.md`

**Acceptance criteria**
1. Given `docs/TOOLING-DEBT.md`'s "Logged by agents" block gained N `###`
   entries during this run, when the report is built, then `debt.rows_logged`
   reads `N`.
2. Given each logged entry's `Risk:` field (LOW/MEDIUM/HIGH per the ledger's
   own template), when the report is built, then the debt section counts rows
   by that risk enum, never the entry's free-text body.
3. Given a run that logged no debt, when the report is built, then
   `debt.rows_logged` reads `0`, not an omitted field.

**Technical notes**
- Run boundary is settled (ARCH-2/ARCH-4): the run marker snapshots the count
  of `###` entries in the ledger's "Logged by agents" block at run start;
  `debt.rows_logged` = current count − snapshot, and only those new entries
  are classified.
- Category comes from each entry's `- Category: <debt_category>` line
  (added to the template by STORY-1-1); a missing/unknown token maps to
  `other` (ARCH-3). Risk counts come from the existing `Risk:` line.

**Out of scope**
- Changing `docs/TOOLING-DEBT.md`'s template or triage tables.
- The gap-scan routine that triages these rows — unaffected by this story.

---

### STORY-1-6: lifecycle hook and end-to-end report

- status: TODO
- estimate: M
- risk: hook wiring — the one spot where a bug silently drops every report this epic exists to produce
- depends_on: [STORY-1-2, STORY-1-3, STORY-1-4, STORY-1-5]
- blocked_by_arch: [ARCH-2, ARCH-4]

**As a** plugin maintainer
**I want** a hook template in `templates/hooks/` that builds the full run
report at the lifecycle point ARCH-2 settles, writes it to
`<project>/.agentic-sdlc/runs/`, and never fails the session
**So that** every real pipeline run leaves a report without anyone invoking
`run-report.mjs` by hand

**Acceptance criteria**
1. Given a completed pipeline run matching ARCH-2's trigger point, when the
   hook fires, then a valid `schema: 1` JSON file exists under
   `<project>/.agentic-sdlc/runs/` within that session.
2. Given `node` is missing or any input the hook needs is absent, when the hook
   fires, then it exits `0` and writes nothing, exactly like `meter.sh`'s
   degrade path — the session is never failed by this hook.
3. Given a run that spans multiple sessions (ARCH-4: same command and target
   as the existing marker), when the second session's hook fires, then the
   SAME `.agentic-sdlc/runs/<run_id>.json` is rebuilt in place with
   `run.sessions` incremented and wall clock accumulated — one run, one file,
   no duplicate report; and a different command/target instead finalizes the
   old run and starts a new `run_id`.
4. Given `.agentic-sdlc/runs/` is new, when the hook writes to it, then the
   directory is gitignored, matching `.agentic-sdlc/meter/`'s existing
   treatment.

**Technical notes**
- `templates/hooks/run-report.sh`, registered on **UserPromptSubmit and
  SessionEnd** in `templates/hooks/settings.hooks.json`, dispatching on
  `hook_event_name` (ARCH-2). Mirrors `meter.sh`: best-effort, advisory,
  always exits 0, resolves `run-report.mjs` via `RUN_REPORT_MJS` override or
  the conventional installed location.
- UserPromptSubmit branch: cheap prefix check for `/agentic-sdlc:plan|build|
  review` before any other work (it fires on EVERY prompt), write/rotate
  `.agentic-sdlc/run-state.json` with the snapshots ARCH-2 lists, build the
  superseded run's report on rotation, and **never write to stdout** (it is
  injected into the model's context).
- SessionEnd branch: **1.5-second shared budget** — spawn the report build
  detached (`nohup … >/dev/null 2>&1 &` or setsid) and exit 0 immediately.
  Report path is `.agentic-sdlc/runs/<run_id>.json`, overwritten on every
  rebuild (ARCH-4).
- `.gitignore` already excludes all of `.agentic-sdlc/` in this repo, which
  covers `runs/`; AC4 is about consuming projects — `docs/setup.md` /
  `templates/` must say the same ignore rule applies there.

**Out of scope**
- Sending the report anywhere (02-telemetry-export.md).
- Any UI or digest over multiple reports.

---

### STORY-1-7: schema leak-proofing test

- status: TODO
- estimate: S
- risk: none: follows the existing `scripts/<name>.test.sh` pattern (`meter.test.sh`, `pair-log.test.sh`)
- depends_on: [STORY-1-1, STORY-1-2]
- blocked_by_arch: []

**As a** plugin maintainer
**I want** a test that walks the run-report schema and asserts no field
accepts an unbounded string
**So that** "code-free" is a property preflight and CI enforce, not a policy
someone has to remember

**Acceptance criteria**
1. Given the schema's full field list, when the test runs, then every field is
   asserted to be one of: a closed enum (from the vocabulary module), a number,
   a boolean, or a nested object/array of the same — and the test fails loudly
   if a new field is added without being one of these.
2. Given a crafted report payload with a long arbitrary string stuffed into any
   field, when the schema validates it, then validation rejects it.
3. Given `scripts/run-report.test.sh` exists, when `./scripts/preflight.sh`
   runs, then it is invoked exactly like `scripts/meter.test.sh` and
   `scripts/pair-log.test.sh` are today (section 6/6b of `preflight.sh`), and
   CI runs the same script.

**Technical notes**
- `scripts/run-report.test.sh`, plain Node, no deps, run from `preflight.sh`
  and `.github/workflows/validate.yml` per `CONTRIBUTING.md`'s testing rule.
- This is the test the success metric's "leak-proofing" line names directly —
  treat it as the story that makes that metric true, not an afterthought on
  STORY-1-2.

**Out of scope**
- Testing the hook's lifecycle timing (STORY-1-6 covers that).

## Debt

Ledgered in docs/TOOLING-DEBT.md by the plan commit.

