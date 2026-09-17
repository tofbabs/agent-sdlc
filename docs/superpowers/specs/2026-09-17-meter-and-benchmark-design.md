# Metering the harness, and making quality objectively measurable

**Date:** 2026-09-17
**Status:** meter + fixture tests + size ratchet SHIPPED; A0 probe scripted, NOT
yet run; benchmark (`bench/`) and Track C DESIGNED, not built.
**Touches:** new `plugins/agentic-sdlc/scripts/meter.mjs`, `scripts/meter.test.sh`,
`scripts/fixtures/meter/`, `scripts/probe-cache.mjs`, `scripts/size-budget.{json,mjs}`,
`templates/hooks/meter.sh`; edits to `commands/build.md`, `agents/*.md`,
`docs/build-rationale.md`, `docs/concepts.md`, `CONTRIBUTING.md`,
`scripts/preflight.sh`, `.github/workflows/validate.yml`.

---

## Why this exists

`CONTRIBUTING.md` roadmap items 1 and 6 say the repo cannot tell whether a cost cut
hurt the software, and `docs/concepts.md` ships a `~52 → ~6` spawn figure labelled
*"projected, not yet measured."* Two problems, one root cause: **no instrument.**

Worse, the cost model the pipeline reasons with — the `Σ (bytes × round_trips)`
model in the 2026-07-31 pair-log spec — is wrong in a way that changes which levers
matter. It prices every re-sent byte at full rate. Real billing:

| | tokens |
|---|---|
| naive "every byte re-sent at full price" (the old model) | 6,685,896 |
| actual billed input-equivalent (`in + 1.25×cw_5m + 2.0×cw_1h + 0.10×cache_read`) | **1,535,173** |

Re-sent bytes are cache reads at **0.10×**. For a long single session the old model
overstates static-content cost by ~4.4×. Meanwhile a term it lacks entirely — the
per-spawn **boot** cost (system prompt + tool defs + `CLAUDE.md`, at 1.25×/2.0×) —
is large: a narrow (5-tool) subagent booted at ~15,874 tokens and a broad (~15-tool)
one at ~30,872 in the measurements that motivated this work. A ~40-spawn PAIR story
spends ~0.8M–1.5M billed tokens *booting agents before any work* — plausibly the
largest single line item, and it scales with **tool count**, not prose length.

So: trimming protocol prose is worth ~a tenth of what the old model implies, while
per-spawn boot, round-trip count and output tokens are underweighted or absent. Fix
the instrument first; gate behaviour-changing cuts on it.

---

## What shipped

### The meter — `plugins/agentic-sdlc/scripts/meter.mjs`

Zero-dep Node 22, same house style as `pair-log.mjs`. Subcommands: `report`,
`record`, `enrich`, `diff`, `boot`, `capture`.

**Data sources, layered by trust** — the design decision that matters, because
Claude Code's docs warn the transcript format is internal:

| Layer | Source | Stability | Uniquely gives |
|---|---|---|---|
| **A (primary)** | `claude -p --output-format stream-json --verbose`, captured | Documented | Per-message usage, totals, `total_cost_usd`, model per message |
| **B (enrichment, guarded)** | `<session>.jsonl` + `<session>/subagents/agent-*.jsonl` | **Internal** | `attributionAgent` (agent *type*), per-spawn boot, 5m-vs-1h split |
| **C (production)** | OTel (`CLAUDE_CODE_ENABLE_TELEMETRY=1`) | Documented | Metering real runs in consuming projects (not parsed by the meter) |

**The guard on layer B is the point.** `TRANSCRIPT_SCHEMA = 1` and a
`REQUIRED_FIELDS` probe (`attributionAgent`, first 200 assistant lines): a miss
degrades to layer A only, names the missing fields in `record.degraded` and on
stderr, and **still reports correct totals — never zeros.** Silent zeros would make
every cost claim in this programme false, so that is the one behaviour the test
suite pins hardest (the analogue of `pair-log.test.sh`'s cap test).

Price multipliers are named constants so the correction stays visible:

```js
const CACHE_WRITE_5M = 1.25, CACHE_WRITE_1H = 2.00, CACHE_READ = 0.10
```

Absolute per-model $/M prices (`PRICES`) are marked **VERIFY** — token-space
derived fields do not depend on them, and `capture`/`report` also record the CLI's
own `total_cost_usd` as `derived.cost_usd_reported` for cross-check.

Two fields carry the whole argument:
- `derived.overstatement_factor` recomputes the naive-vs-billed ratio **per lane**
  instead of assuming 4.4×.
- `spawns[].cache_read_on_first_call` is the direct answer to A0 — a nonzero value
  on spawn #2+ of the same agent type *is* cross-spawn prefix sharing.

The full record shape is in the fixture `scripts/fixtures/meter/expected.json`.

### Tests + fixtures — `scripts/meter.test.sh`, `scripts/fixtures/meter/`

Bash, beside `pair-log.test.sh`, wired into `preflight.sh` (§6) and `validate.yml`.
The fixture models a run of 1 orchestrator + 3 spawns (two of the same type, both
cache buckets, nonzero thinking). The numbers are hand-computable and hand-computed
in the test so a price or multiplier typo fails there, not silently:

- input 1900, output 3000, cw_5m 47000, **cw_1h 5000**, cache_read 40000
- `billed_input_equivalent = 1900 + 1.25·47000 + 2.0·5000 + 0.10·40000 = 74650`
- `naive = 1900 + 47000 + 5000 + 40000 = 93900`; `overstatement = 93900/74650 = 1.2579`
- `usd = 0.83835` across the opus/sonnet price table
- coder `boot_mean = (15000+5000)/2 = 10000`; spawn #3 (2nd coder) has
  `cache_read_on_first_call = 15000` — the A0 signal, present in a fixture.

The degradation case (`transcript-broken.jsonl`, `attributionAgent` removed) asserts
exit 0, `degraded: ["attributionAgent"]`, real totals (74650, not 0), and a stderr
warning.

### The size ratchet — `scripts/size-budget.{json,mjs}`

A byte added to `coder.md` is paid ~40× on a PAIR story, so the boot path gets a
byte budget. Ratchet-only in two directions: a file over its cap fails, and a cap
raised above `origin/main`'s fails — caps only go **down**. `reference/*.md` is
exempt (on-demand, never in the boot path). Wired into `preflight.sh` (§7) and
`validate.yml`.

**Caps are calibrated at measured post-A3/A4 sizes, not at the plan's aspirational
targets.** `build.md` is 17,242 B after A3, not ≤9,500; `coder.md` is 11,220 B, not
≤8,000. Reaching those aspirational numbers requires cutting *normative* content an
agent reasons about — behaviour-changing, so gated on `bench/` (Track C), not a
Track A structural move. The ratchet locks in the honest current sizes and forbids
regrowth; tightening the caps is a future PR with a bench artifact.

### Track A structural cuts (no quality risk)

- **A3** — `build.md`'s #77/#74/#73 post-mortem and release-please reasoning moved
  to `docs/build-rationale.md` (a doc, not a `reference/` file — nothing `cat`s it
  at runtime). The normative rules stay as four compact bullets. 20,624 → 17,242 B.
- **A4** — the five LSP-over-grep blocks shortened in place (not externalised: a
  `reference/` round trip would cost more than the ~310 tokens it saves). Each
  agent kept its specific cost clause.

A1 (tool-list trimming) and A2 (TTL) are **deliberately not done**: the plan gates
each on a `meter boot` measurement ("revert any cut that does not move
`boot_mean`") and on A0, and this environment cannot produce those measurements.
Landing them blind would violate the plan's own discipline.

---

## A0 — the prefix-sharing probe (scripted, NOT yet run)

`scripts/probe-cache.mjs` is ready to run and answers the two load-bearing,
currently-**unverified** questions. It spends real API budget (~$5) and its output
is empirical, so it is not in CI and has no fixture.

**Record the answer here when it is run:**

> **Temporal probe (`--mode temporal`)** — do consecutive fresh spawns of the same
> agent type share a cache prefix?
> _Result: NOT YET RUN._
>
> **Worktree probe (`--mode worktree`)** — is the injected cwd / git-state block
> inside the cached prefix (so per-story worktrees bust it)?
> _Result: NOT YET RUN._

The branch of the rest of the work turns on the temporal result: sharing ⇒ **A2**
(cache stabilisation) is the top lever and boot collapses to 0.10× after spawn #1;
no sharing ⇒ **A1** (tool trimming) is the top lever. Until it is run, neither A1
nor A2 nor C5 should land.

A concrete, measurable, currently-undocumented reason PAIR costs more than "double
the turns": PAIR **alternates** a Sonnet-5 coder with an Opus-4.8 navigator, and a
**model switch invalidates the prefix**, so each agent type sees a two-turn gap
rather than one — which on slow turns straddles the 5-minute subagent TTL. The
meter's `by_model` and per-spawn `cache_read_on_first_call` make this visible.

---

## Designed, not built

### The quality benchmark — `bench/`

No LLM judge; every signal is an exit code, a parsed test report, or a set
comparison. Corpus: **8 purpose-built micro-repos** (4 FAST, 4 deliberate incl. 2
multi-story epics; TS×6, Py×2), each of the four risk surfaces in ≥3 tasks. Hard
gate is binary (project four-command gate + seed tests still green + a committed
clean tree). Graded score 0–100:

| # | Signal | Weight |
|---|---|---|
| S1 | Held-out acceptance pass rate (JUnit, never seen by the agent) | 35 |
| S2 | Mutation score **on the diff** (Stryker/`mutmut`, deterministic) | 25 |
| S3 | Risk-surface **sentinel** kill rate (a patch that breaks the surface *as it would do harm*; the agent's own suite must kill it) | 15 |
| S4 | AC→test mapping | 10 |
| S5 | Diff economy vs a reference bound | 8 |
| S6 | Debt-ledger honesty (F1 of detected shortcuts vs. ledger rows) | 7 |

Acceptance is statistical and pre-registered: **k=7** paired repeats, paired
bootstrap (10,000 resamples, one-sided 95% lower bound), **δ=8 points** for 8 tasks
(δ=5 would need ~16 tasks — do not claim the tighter margin on the smaller corpus).
A change lands only if: quality lower-bound > −δ; `median(usd) ≤ 0.85×baseline`
with the cost CI excluding 0; **no new hard-gate failure**; and **no per-task S3
regression**. `bench/stats.mjs` exits non-zero if any rule fails, so the rule is
machine-enforced, not argued in a PR.

**Why not shipped now:** the corpus, the mutation determinism (the one-time "run 3×
against the reference, reject if score varies >1 point" calibration), and
`run/score/stats.mjs` cannot be validated without real pipeline runs against real
API budget. Shipping an unvalidated statistical harness that *claims* rigor is worse
than shipping none. It is fully specified above and in the source plan.

### Track C — evidence-gated cuts

C1 (collapse round trips: `gate.sh`, `story-start.sh`, `diff-digest.sh`), C2 (cut
output/thinking per agent type), C3 (bound the orchestrator's epic context:
`epic-log.mjs`, resumable-per-wave), C4 (prose budgets → `backlog-lint.mjs`), C5
(batch FAST tasks — only if A0 says no prefix sharing). Each lands only with a
`bench/` artifact showing cost down and quality non-inferior. None should land
before the benchmark and A0 exist.

---

## Verification performed

- `scripts/meter.test.sh` — 16 checks green, incl. byte-exact totals, by_agent
  reproduction, the 2.0× 1h-write correction, `diff` deltas, and the degradation
  case.
- `scripts/size-budget.mjs` — green at calibrated caps.
- `node --check` on all three new `.mjs` files.
- `build.md` / agent LSP edits verified by byte count and by re-reading the
  normative content that remains.

## Verification still owed (needs real API budget)

1. Cross-check `meter report` totals against `claude -p --output-format json`
   `total_cost_usd` on one real run (agree to within rounding, or the meter is
   wrong).
2. Cross-check per-agent attribution against OTel console output on one run.
3. Run `probe-cache.mjs` (both modes) and record the answer above.
4. Confirm the production hook lands a record with a nonzero
   `by_agent["coder"].spawns` from a live `/build`.
