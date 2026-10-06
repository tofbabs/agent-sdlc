# 0001. Run-report schema 1 and the closed category vocabulary

- Status: ACCEPTED
- Date: 2026-10-06
- Reversibility: ONE-WAY (once `02-telemetry-export.md` uploads reports and
  `03-signal-routine.md` groups them, a loosened or renamed field breaks
  exported history and the edge validator)
- Resolves: ARCH-1, ARCH-3 of `backlog/EPIC-1.md`

## Context

Every pipeline run must leave one code-free JSON report in
`.agentic-sdlc/runs/`. "Code-free" is a schema property: no field may accept an
unbounded string, so no path, branch name, PR title, identifier or code can
leak — by construction, not redaction. The report is **derived after the fact**
by `run-report.mjs` (plain Node, no model), from artifacts the pipeline already
writes. Two of those artifacts carry no category today (review findings, debt
entries, ARCH handoffs), and a deterministic script cannot classify prose — so
if a category is not written at the source, it does not exist.

Precedents followed: `meter.mjs` (`schema: 1` integer, `degraded` array naming
missing inputs, never silent zeros), `pair-log.mjs` (`session.json` as the only
machine-readable surface), and the existing closed sets already in the repo
(SOLO/PAIR/FAST, BLOCKER/MAJOR/MINOR, LOW/MEDIUM/HIGH, deliberate/fast).

## Options

### Schema shape
- **A: per-finding/per-story arrays of enum objects** — keeps granularity 03
  needs (a round-2 BLOCKER is a different signal from a round-1 MINOR), still
  code-free because every element is enum/number.
- **B: flat count maps only** — smaller, but collapses round/severity/category
  joins that 03's grouping signature explicitly uses.

### Category sourcing
- **A: tag at source** — the agent that already writes the artifact adds one
  vocabulary token to it; the builder parses the token and nothing else.
- **B: classify at build time** — impossible: the builder is a script, and a
  model pass would reintroduce free text handling and cost.
- **C: no categories until vocabularies emerge from data** — defers exactly the
  drift the brief forbids, and gives 03 nothing to group on.

### `other`
- **A: every open vocabulary carries `other`; missing/unknown maps to it
  deterministically** — coverage stays 100% when a tag is absent or stale.
- **B: reject unknowns** — a single untagged finding voids the whole report and
  the 100%-coverage success metric, for no privacy gain (the tag is never
  echoed, only counted).

## Decision

Shape **A**, sourcing **A**, `other` **A**.

### Schema 1

One JSON object. All six sections plus `degraded` are **always present** — a
plan-only run still validates. A number field is number-or-`null`: `null` means
"input missing, named in `degraded`"; `0` means "measured zero" (the meter's
no-silent-zeros rule). Unknown fields are rejected. Exactly **three
pattern-bounded string fields exist in the whole schema** — `run.run_id`,
`run.plugin_version`, `run.ended_at` — every other field is an enum token from
the vocabulary module, a number, `null`, or a nested object/array of the same.
Count-map keys must themselves be vocabulary members.

```jsonc
{
  "schema": 1,
  "run": {
    "run_id": "<uuid v4>",            // ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
    "plugin_version": "<semver>",     // ^\d+\.\d+\.\d+$  (from the installed plugin.json)
    "command": "plan|build|review",
    "lane": "deliberate|fast",
    "outcome": "completed|blocked|aborted",
    "ended_at": "<ISO-8601 UTC>",     // ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$
    "wall_clock_s": 0,                // summed across sessions, see EPIC-1 ARCH-4
    "sessions": 1                     // sessions this run spanned
  },
  "plan": {
    "epics": 0, "stories": 0, "tasks": 0,
    "arch_handoffs": { "<arch_category>": 0 }      // raised at plan time
  },
  "build": {
    "stories": [                      // one entry per story the build touched,
      { "mode": "SOLO|PAIR|FAST",     // in backlog-file order — NO story IDs
        "alternations": 0 }
    ],
    "arch_blocks": { "<arch_category>": 0 },        // raised mid-build (run-level;
                                                    // per-story attribution is lost
                                                    // when session.json unblocks)
    "revise_rounds": 0,               // run-level, from PR round comments
    "gate_runs": null,                // no recorder exists yet — null + degraded
    "gate_failures": null
  },
  "review": {
    "rounds": 0,
    "verdict": "APPROVE|REQUEST_CHANGES|COMMENT|NONE",   // NONE = no review yet
    "findings": [ { "round": 1, "category": "<finding_category>", "severity": "BLOCKER|MAJOR|MINOR" } ]
  },
  "debt": {
    "rows_logged": 0,
    "by_risk": { "LOW": 0, "MEDIUM": 0, "HIGH": 0 },
    "by_category": { "<debt_category>": 0 }
  },
  "cost": {                           // null + degraded when no meter record
    "schema": 1,                      // the embedded meter record's own schema
    "totals": {},                     // meter record's totals, verbatim
    "derived": {}                     // meter record's derived, verbatim
  },
  "degraded": [ "<degraded_input>" ]
}
```

`cost` embeds **only** `totals` and `derived` from the newest meter record of
the run: they are all-numeric. The record's `label`, `by_agent`, `by_model` and
`spawns` carry free strings (session IDs, model names) and are excluded.
`run_id` doubles as the idempotency key `02-telemetry-export.md` requires, so
it ships in schema 1 rather than forcing a bump later.

### Vocabulary

One module, `plugins/agentic-sdlc/scripts/run-report-categories.mjs`, exports
every enum below and is the only place any of them is written down — the
schema validator imports it, the leak-proof test walks it, and agents read it
on demand (it is not boot-path content). Casing matches the artifact each set
already lives in; new vocabularies are lower_snake.

Closed operational enums (no `other` — the pipeline cannot produce anything
else):

- `command`: `plan` | `build` | `review`
- `lane`: `deliberate` | `fast`
- `outcome`: `completed` | `blocked` | `aborted`
- `mode`: `SOLO` | `PAIR` | `FAST`
- `verdict`: `APPROVE` | `REQUEST_CHANGES` | `COMMENT` | `NONE`
- `severity`: `BLOCKER` | `MAJOR` | `MINOR`
- `risk`: `LOW` | `MEDIUM` | `HIGH`

Open vocabularies (carry `other`; tagged at source):

- `arch_category` — what kind of decision an ARCH handoff asks for:
  `contract` (a schema/API/format others build on), `data` (storage, layout,
  retention), `lifecycle` (hooks, triggers, ordering, run boundaries),
  `dependency` (library/tool/platform choice), `security`, `cost`
  (token/infra spend trade-offs), `process` (branching, release, workflow),
  `other`.
- `finding_category` — what a review finding is about: `correctness`,
  `testing`, `security`, `performance`, `consistency` (contradicts an ADR or
  a house pattern), `clarity` (naming, comments, docs), `process` (CI,
  release, budgets, PR conventions), `other`.
- `debt_category` — what a debt row defers, taken from the ledger's own
  "what belongs here" prose: `missing_test`, `hardcoded_value`,
  `stubbed_integration`, `deferred_migration`, `robustness` (no retry /
  pooling / validation), `observability`, `other`.
- `degraded_input` — which input a build could not use: `run_state`,
  `meter_record`, `backlog_file`, `pair_sessions`, `pr_comments`,
  `debt_ledger`, `gate_history`, `plugin_version`.

### Tag at source

The agent that already writes an artifact adds exactly one token to it; the
builder parses the token and never the surrounding prose. Missing or unknown
token → `other`, deterministically, never a rejected report.

- ARCH handoff detail block (planner at plan time, architect mid-build) gains
  `- category: <arch_category>`.
- Review finding line becomes `F<n>: <SEVERITY> [<finding_category>] — …`.
- Debt entry template gains `- Category: <debt_category>` beside `Risk:`.

These are one-line additions to budgeted files; the ratchet means each must be
byte-offset within its file. The `other` share per vocabulary is a first-class
drift signal for `03-signal-routine.md` — a dumping ground is detected, not
assumed away.

### Versioning policy

`schema` is an integer. Adding an optional field or an enum value is **not** a
bump but must ship in lockstep with the edge validator from 02 (which rejects
unknown values). Removing or renaming a field or value, or changing a field's
meaning, bumps `schema` and starts a new history line.

## Consequences

- Becomes easy: leak-proofing is a mechanical walk of one module (three
  whitelisted patterns, everything else enum/number); 02 validates against the
  same module; 03 groups on `(command, lane, mode, category, severity)` with
  no free-text handling anywhere.
- Becomes easy: a report is rebuildable at any time from artifacts — no event
  stream, no boot-path growth beyond three one-line tags.
- Becomes hard: renaming a category (schema bump + coordinated edge release);
  per-story attribution of resolved architect blocks (run-level only, logged
  as debt in EPIC-1); any future field that wants prose (forbidden by design).

## Revisit if

- `other` exceeds ~20% of any open vocabulary across a month of reports —
  extend that vocabulary (additive, no bump).
- A gate recorder ships — flip `gate_runs`/`gate_failures` from
  perpetually-degraded to measured (additive, no bump).
- 02's edge validator needs a constraint this schema cannot express (e.g.
  array length caps for the 16 KB body limit) — cap `review.findings` and
  `build.stories` lengths; additive tightening, no bump.
