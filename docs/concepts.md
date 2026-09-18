# Concepts — the quality dial and the token story

Back to the [README](../README.md).

This is the "why it works" reference: the full quality ladder, the two lanes side
by side, how a story gets built solo or as a pair, and how the two recent changes
(LSP-first navigation and the `--fast` lean lane) spend tokens where they buy
quality and nowhere else.

---

## The quality ladder

Everything this plugin does sits on one axis: **how much rigor you spend per unit
of work.** You pick the rung; the rung decides how many agents run, how many
tests are required, and whether decisions get written to paper. The one thing that
does **not** change with the rung is that **the corners you cut are always
recorded** — every rung writes its shortcuts to `docs/TOOLING-DEBT.md`. That is
the difference between a shortcut and drift: a shortcut you recorded is a decision
you can pay back; one you didn't is a surprise later.

From least to most rigor:

### 1. `--fast` SOLO — the lean lane
The lowest rung. Direct requirements, one observable check per task, the coder
**decides and logs** instead of stopping for an architect, and it writes only the
tests that would catch an expensive bug. One branch, no worktrees, one gate, one
PR. Right for prototypes, spikes, internal tools, and anything you would be
content to rewrite.
**Debt recorded:** every shortcut is one row in `docs/TOOLING-DEBT.md`; the PR
body stamps `Mode: FAST`. The mode is a debt *generator* by design — that is the
trade, and the condition of the trade is that it is written down.

### 2. Deliberate SOLO
One coder runs a fully-specified story end to end against 2–5 Gherkin acceptance
criteria. The default for small stories with an existing pattern to follow. Full
test expectations, an epic branch, and the architect available to unblock.
**Debt recorded:** the architect and coder append any deliberate gap to the
ledger.

### 3. Deliberate PAIR — ping-pong TDD
The highest-rigor way to *write* a story. Two agents alternate one increment at a
time: the **navigator** (Opus 4.8 / Gemini Pro) writes the next failing test and reviews the
last increment; the **coder** (Sonnet 5 / Gemini Flash, the driver) makes it pass with the
simplest thing that works. The driver *not* owning the tests is what keeps them
honest. Chosen for M/L, novel, or previously-bounced stories, where the risk
justifies roughly doubling the story's turns.
**Debt recorded:** same ledger discipline; pairing narrows nothing about what
gets written down.

### 4. Reviewed — the code-reviewer gate
The highest rung overall, and it sits *on top of* any of the three above. The
**code-reviewer** (Opus 4.8 / Gemini Pro) reads the PR head in a throwaway worktree and posts
one round comment with stable, ID'd findings; the coder's **REVISE** mode rules
on each finding by ID and closes the loop. A `Mode: FAST` PR is judged against the
*fast floor* — a missing unit test is the mode working, not a defect — but a
missing **negative** test on a risk surface (auth, money, destructive data,
external contract) is a finding at every rung, ledger entry or not. Fast mode
narrows what gets tested, never what gets reviewed.

**Rule of thumb.** Pick the lowest rung you would be comfortable defending if the
code outlived its intended life. Persisted data models, contracts another team
consumes, and anything touching money, auth or PII always climb — those five hit
the one-way-door list and pull in the architect *even in fast mode*.

---

## The two lanes, side by side

The `--fast` flag is per command, so the lanes mix: `/build EPIC-3 --fast` builds
a deliberately-planned epic the lean way. And `/review` judges a `Mode: FAST` PR
against the fast floor instead of the deliberate bar — same command, no flag
needed.

|  | deliberate | `--fast` |
|---|---|---|
| Artifact | `backlog/EPIC-<n>.md`, ~150 lines, 2–5 Gherkin criteria per story | `backlog/FAST-<n>.md`, ~40 lines, one `done when` per task |
| Decisions | `ARCH-<n>` handoff, coder blocks and waits | coder decides and logs; five one-way doors are tagged and batched, never blocking |
| Tests | the story's criteria; PAIR stories are strict ping-pong TDD | the `done when`, plus the **negative** case on each risk surface touched — auth, money, destructive data paths, external contracts — nothing else |
| Branching | epic branch, story worktrees off the epic tip, one squash commit per story | one branch, sequential, gate once |
| Agents | planner, architect (Fable / Gemini Pro), coder, navigator (Opus 4.8 / Gemini Pro), code-reviewer (Opus 4.8 / Gemini Pro) at the PR | planner + coder (Sonnet 5 / Gemini Flash); architect at most once, usually zero; code-reviewer judges the fast floor |
| Spawns, 5 tasks | ~52 with two PAIR stories | ~6 *(projected, not yet measured)* |
| Debt ledger | required | required |

**Pick `--fast`** for prototypes, spikes, internal tools, and anything you would
be content to rewrite. **Pick the deliberate lane** for a persisted data model, a
contract another team consumes, or anything touching money, auth or PII — and note
that those five hit the one-way-door list and get the architect even in fast mode.

---

## Solo vs. pair

Every story is built one of two ways, chosen per story by `/agentic-sdlc:build`:

- **SOLO** — one coder runs the story end to end. The default for small,
  well-specified stories with an existing pattern to follow. This is the original
  behaviour and remains fully supported.
- **PAIR** — ping-pong TDD split across two agents (navigator + coder), one
  increment at a time through a shared pair log at `backlog/pair/<STORY-ID>.md`.
  Chosen for M/L, novel, or previously-bounced stories — where the driver *not*
  owning the tests is what keeps them honest.

Pairing roughly doubles a story's turns, so `/agentic-sdlc:build` sends it only
where the risk justifies it. Mode is orthogonal to the epic cascade: a wave can
hold SOLO and PAIR stories side by side, each in its own worktree.

Review is `/agentic-sdlc:review <PR-n>`: the code-reviewer reads the PR head in a
throwaway worktree and posts one round comment. Run it by hand or let the hourly
routine call it; the coder's **REVISE** mode closes the loop, ruling on each
finding by ID.

---

## Token utility and output quality

Two recent changes — **LSP-first navigation** and the **`--fast` lean lane** — are
both about the same thing: spending tokens where they buy quality and not spending
them anywhere else. The mechanisms compound.

### Why the token math matters here
An agent's system prompt and instructions are **re-sent on every internal
tool-call round trip**, and a single build turn can be 18–42 round trips. So every
kilobyte of protocol prose an agent carries is paid for dozens of times per turn,
and every long-lived agent's context grows monotonically as it works. The design
responses:

> **A correction on the arithmetic.** Re-sent bytes are billed as **cache reads at
> 0.10×**, not at full rate, so the raw "paid dozens of times" figure overstates
> the cost of *static* content by a lane-dependent factor (~4.4× on one long
> session; much less on a burst of short subagent spawns). The larger, previously
> unpriced term is per-spawn **boot** — the system prompt + tool definitions +
> injected `CLAUDE.md`, billed at 1.25×/2.0× on each spawn's first call, scaling
> with *tool count*, not prose length. `plugins/agentic-sdlc/scripts/meter.mjs`
> measures both, per lane; see
> `docs/superpowers/specs/2026-09-17-meter-and-benchmark-design.md`. The ranking of
> the three responses below is unchanged by the correction.

- **On-demand protocol loading.** PAIR, REVISE, FAST and the fast-review floor
  live in `reference/` and are read *only* when that path is actually taken. A
  deliberate run never pays for the fast-mode prose; a SOLO story never pays for
  the pairing loop. The command bodies carry stubs, not the full protocol.
- **Fresh-spawned pair agents.** Both pair agents are **re-spawned fresh every
  turn**, and a compact pair log — a fixed header, a rewritten-in-place `STATE`
  block, and short append-only entries — is the only thing that carries between
  them. That holds a pair story's cost roughly *linear* in alternations.
  Continuing one live agent across turns instead makes it *quadratic*: its context
  is re-sent on every round trip and only grows. (See `COST NOTE` and
  `PAIR LOG SHAPE` in `commands/build.md`.)
- **Bounded artifacts.** An epic file is long and mostly not about any one story,
  so the orchestrator inlines a story's criteria into the coder's prompt rather
  than making every coder re-read the whole epic. `CLAUDE.md` is never opened by
  agents — Claude Code already injects it, and opening it pays for the same bytes
  twice.

### LSP-first navigation → fewer tokens, better answers
Every agent carries the `LSP` tool and is told to use it — not `Grep` — for
anything semantic: where a symbol is defined, all its references, its type, what
an edit broke.

- **Token utility.** `Grep` returns raw text matches — comments, strings, unrelated
  files — and the agent burns tokens reading and discarding them. An LSP
  "references" query returns the *actual* call sites and nothing else, so the agent
  reads less to learn more.
- **Output quality.** Grep is blind to re-exports, shadowing and dynamic call
  sites, so a grep-driven edit silently misses places it should have touched. LSP
  navigates by the language's own resolution, so the coder finds every real use,
  the reviewer sees the true blast radius of a change, and `diagnostics` catch what
  an edit broke before the PR is opened. Agents keep `Grep`/`Glob` only for
  non-code text, finding a file by name, or a language with no server running.

### `--fast` → quality spent where it counts
Fast mode is not "lower quality everywhere." It removes ceremony (no handoffs, no
worktrees, one gate) and it removes tests that would only catch cheap bugs — but
it **keeps the negative test on every risk surface** and it **keeps full review**.
The projected effect on a 5-task feature is roughly `~52 → ~6` agent spawns
(projected, not yet measured — the meter keeps this label until the `bench/`
benchmark replaces it with a measured figure and its IQR), and the single largest
saving is that the
navigator — Opus 4.8, running every other turn in a PAIR story — does not run at
all. The quality you keep is the quality that protects data, money and contracts;
the quality you spend less on is the quality a prototype does not need.
