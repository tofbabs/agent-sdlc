# agentic-sdlc

A versioned, reusable **planner → architect → coder → reviewer** pipeline for
Claude Code, distributed as a plugin so many projects can pull the same protocol
in at a pinned version and move forward deliberately instead of drifting.

## Who this is for

You are probably here because you have hit one of these:

- **Agents that sprawl.** You hand an AI coding agent a one-line brief and get
  back a plausible, confident, *wrong* backlog — ten epics where you wanted two,
  a stack nobody chose, decisions buried in code that should have been decisions
  on paper. The failure is cheap to produce and expensive to unwind.
- **Copy-paste protocol rot.** You wrote a good `.claude/agents` setup once, then
  copied it into three more repos. Now they have all drifted, and nobody can say
  what changed or why. The fix that landed at 11pm in one project never came
  back to the others.
- **No dial between "quick" and "careful".** A throwaway spike and a payments
  migration get the same ceremony, so you either over-engineer prototypes or
  under-engineer the things that hold real data.
- **Silent, unaccounted shortcuts.** The corners you cut to ship are cut in
  people's heads, not written down, so the debt is invisible until it bites.
- **Token bills that scale with ceremony, not value.** Long-lived agents re-send
  their whole context on every internal round trip; protocol prose you never use
  on this run gets paid for anyway; agents `grep` their way around a codebase and
  drown in noise.

If a team ships product with Claude Code across more than one repository, and
wants the *how* to be reviewable, pinned, and shared rather than folklore, this
is the shape of the answer. It is stack-agnostic and language-agnostic — the
protocol lives in the plugin; everything a specific project learned about itself
stays in that project (see [What stays in the project](#what-stays-in-the-project-deliberately)).

## What it does, in three commands

```
/agentic-sdlc:plan <brief>     planner → epics, stories, ARCH handoffs
                               architect → resolves the handoffs, decides
                               you skim (non-blocking)

/agentic-sdlc:build EPIC-<n>   per story, SOLO or PAIR:
                                 SOLO  coder builds the story end to end
                                 PAIR  navigator ⇄ coder ping-pong TDD, one increment a turn
                               both cascade onto one feat/EPIC-<n> branch
                               architect → unblocks mid-build
                               ends at "one PR is open"

/agentic-sdlc:review <PR-n>    code-reviewer reads the PR head in its own worktree
                               posts `## Review — round <k>` + a verdict
                               REQUEST_CHANGES → /build's REVISE loop closes it
                               APPROVE → the human merges
```

Or the lean lane, on the same commands:

```
/agentic-sdlc:plan <brief> --fast    planner → a ~40-line task list, one `done when` each
                                     no ARCH handoffs — one-way doors tagged, not blocked
                                     architect runs only if something was tagged

/agentic-sdlc:build FAST-<n> --fast  SOLO throughout, one branch, no worktrees
                                     tests: the check, plus the negative case on any
                                     auth/money/destructive-data/contract surface
                                     gate once, one PR, every shortcut in the ledger
```

`/review` judges a `Mode: FAST` PR against the fast floor instead of the
deliberate bar — same command, no flag needed.

**The one blocking gate is the human.** Nothing here merges its own PR.

---

## The quality ladder

Everything this plugin does sits on one axis: **how much rigor you spend per unit
of work.** You pick the rung; the rung decides how many agents run, how many
tests are required, and whether decisions get written to paper. The one thing
that does **not** change with the rung is that **the corners you cut are always
recorded** — every rung writes its shortcuts to `docs/TOOLING-DEBT.md`. That is
the difference between a shortcut and drift: a shortcut you recorded is a
decision you can pay back; one you didn't is a surprise later.

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
time: the **navigator** (Opus 4.8) writes the next failing test and reviews the
last increment; the **coder** (Sonnet 5, the driver) makes it pass with the
simplest thing that works. The driver *not* owning the tests is what keeps them
honest. Chosen for M/L, novel, or previously-bounced stories, where the risk
justifies roughly doubling the story's turns.
**Debt recorded:** same ledger discipline; pairing narrows nothing about what
gets written down.

### 4. Reviewed — the code-reviewer gate
The highest rung overall, and it sits *on top of* any of the three above. The
**code-reviewer** (Opus 4.8) reads the PR head in a throwaway worktree and posts
one round comment with stable, ID'd findings; the coder's **REVISE** mode rules
on each finding by ID and closes the loop. A `Mode: FAST` PR is judged against
the *fast floor* — a missing unit test is the mode working, not a defect — but
a missing **negative** test on a risk surface (auth, money, destructive data,
external contract) is a finding at every rung, ledger entry or not. Fast mode
narrows what gets tested, never what gets reviewed.

**Rule of thumb.** Pick the lowest rung you would be comfortable defending if the
code outlived its intended life. Persisted data models, contracts another team
consumes, and anything touching money, auth or PII always climb — those five hit
the one-way-door list and pull in the architect *even in fast mode*.

### The two lanes, side by side

The `--fast` flag is per command, so the lanes mix: `/build EPIC-3 --fast` builds
a deliberately-planned epic the lean way.

|  | deliberate | `--fast` |
|---|---|---|
| Artifact | `backlog/EPIC-<n>.md`, ~150 lines, 2–5 Gherkin criteria per story | `backlog/FAST-<n>.md`, ~40 lines, one `done when` per task |
| Decisions | `ARCH-<n>` handoff, coder blocks and waits | coder decides and logs; five one-way doors are tagged and batched, never blocking |
| Tests | the story's criteria; PAIR stories are strict ping-pong TDD | the `done when`, plus the **negative** case on each risk surface touched — auth, money, destructive data paths, external contracts — nothing else |
| Branching | epic branch, worktrees, dependency waves, `--no-ff` merge-backs | one branch, sequential, gate once |
| Agents | planner, architect (Fable), coder, navigator (Opus 4.8), code-reviewer (Opus 4.8) at the PR | planner + coder (both Sonnet 5); architect at most once, usually zero; code-reviewer judges the fast floor |
| Spawns, 5 tasks | ~52 with two PAIR stories | ~6 *(projected, not yet measured)* |
| Debt ledger | required | required |

---

## Token utility and output quality

Two recent changes — **LSP-first navigation** and the **`--fast` lean lane** —
are both about the same thing: spending tokens where they buy quality and not
spending them anywhere else. The mechanisms are worth understanding because they
compound.

### Why the token math matters here
An agent's system prompt and instructions are **re-sent on every internal
tool-call round trip**, and a single build turn can be 18–42 round trips. So every
kilobyte of protocol prose an agent carries is paid for dozens of times per turn,
and every long-lived agent's context grows monotonically as it works. The design
responses:

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
  "references" query returns the *actual* call sites and nothing else, so the
  agent reads less to learn more.
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
(projected, not yet measured), and the single largest saving is that the
navigator — Opus 4.8, running every other turn in a PAIR story — does not run at
all. The quality you keep is the quality that protects data, money and contracts;
the quality you spend less on is the quality a prototype does not need.

---

## Install

Add the marketplace and enable the plugin, pinned to a tag:

```bash
claude plugin marketplace add kodobe/agent-sdlc@v0.1.1
claude plugin install agentic-sdlc@kodobe-sdlc
```

Better, do it declaratively so the pin is checked in and reviewable. In the
consuming project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "kodobe-sdlc": {
      "source": {
        "source": "github",
        "repo": "kodobe/agent-sdlc",
        "ref": "v0.1.1"
      }
    }
  },
  "enabledPlugins": { "agentic-sdlc@kodobe-sdlc": true }
}
```

Teammates are prompted to install on folder-trust. **Upgrading is a one-line diff
to `ref`** — reviewable, revertable, and visible in `git log`.

> **The install is bound to one directory.** `enabledPlugins` declares the intent,
> but the install is recorded in `~/.claude/plugins/installed_plugins.json` against
> a specific `projectPath`. A second directory with the same settings — a workspace
> root above the repo, a git worktree, a sibling checkout — gets **nothing** until
> it is installed there too, and the symptom is silent: `/agentic-sdlc:plan` simply
> is not offered. Fix it from that directory with
> `claude plugin install agentic-sdlc@kodobe-sdlc --scope local`, then restart.

The plugin is listed by relative path inside this repo, so the marketplace `ref`
pins the plugin transitively. One knob, not two.

> A marketplace source accepts `ref` (branch or tag) but **not** `sha`. Only
> plugin entries inside `marketplace.json` accept both. Tags are the currency here.

> **Everything is namespaced by the plugin name.** `plugin.json`'s `name` is what
> namespaces components, so the commands are `/agentic-sdlc:plan`,
> `/agentic-sdlc:build` and `/agentic-sdlc:review`, and the agents register as
> `agentic-sdlc:planner`, `agentic-sdlc:architect`, `agentic-sdlc:coder`,
> `agentic-sdlc:navigator`, `agentic-sdlc:code-reviewer` —
> there are no bare `/plan`, `/build`, `/review` or `planner` variants. A project moving off
> local `.claude/agents`
> loses the unprefixed names it was used to; the docs it wrote against them need
> updating with the pin.

---

## The contract a consuming project must satisfy

The agents assume these exist. Nothing enforces it — a missing one shows up as an
agent reading a path that isn't there.

| Path | Purpose | Required |
|---|---|---|
| `CLAUDE.md` | Conventions, and **the check command** the coder runs before opening a PR | yes |
| `backlog/` | Where `/plan` writes `EPIC-<n>.md` (or `FAST-<n>.md` under `--fast`), and where `/build` and `/review` read them | yes |
| `docs/TOOLING-DEBT.md` | The ledger. Appended to by architect and coder; triaged by the gap-scan routine. `--fast` runs write one row per shortcut here — the mode's whole justification | yes |
| a brief, per feature | **The input to `/plan`** — the one document written by hand. Path is yours; `/plan <path>` takes it | yes, per feature |
| `docs/adr/` | ACCEPTED ADRs are binding on every agent | created on first one-way door |

`templates/` has a starting point for each. Copy them in on first setup:

```bash
cp templates/TOOLING-DEBT.md          <project>/docs/
cp templates/backlog/EPIC-template.md <project>/backlog/
cp templates/backlog/FAST-template.md <project>/backlog/   # only if you use --fast
cp templates/brief.md                 <project>/docs/templates/
cp templates/ADR.md                   <project>/docs/templates/
```

### The brief is part of the protocol

`/plan` takes a brief and generates everything downstream from it, so its shape
decides what the backlog looks like. `templates/brief.md` is that shape.

Two sections carry most of the weight and the template says so in place:
`Scope — out`, which is what stops the planner inventing epics, and `Technical
context`, which on a greenfield repo is the only evidence the architect has for
choosing a stack. A brief thin on either produces a plausible, sprawling,
wrong backlog — cheaply, and in parallel.

### ADRs use a house format, deliberately

`templates/ADR.md` has no "Options Considered" section. MADR and its relatives
do, and that contradicts `architect.md`, which is told to decide rather than
produce an options paper. Rejected alternatives appear under **Decision**, as
things already ruled out and why.

An ADR is for a **one-way door** only. Everything cheaper is resolved in place in
the epic file as `ARCH-<n>` with `reversibility: TWO-WAY`.

### CLAUDE.md must state the check command

`coder.md` tells the coder to run "whatever checks exist (`CLAUDE.md` lists
them)". If `CLAUDE.md` doesn't name them, the coder either invents a toolchain or
skips verification. Both are bad. Put a literal line in the project's `CLAUDE.md`:

> **Always run before opening a PR:** `<the actual command>`

### Code navigation is LSP-first

Every agent carries the `LSP` tool and is told to use it — not `Grep` — for
anything semantic: where a symbol is defined, all its references, its type, what
an edit broke. Grep matches raw text, so it misses re-exports, shadowing and
dynamic call sites and buries the reader in comments and strings; the agents keep
`Grep`/`Glob` only for non-code text, finding a file by name, or a language with
no server running.

The `LSP` tool needs a **code-intelligence plugin installed for the project's
language** (TypeScript, Python, Rust, …), and it is not available in cloud
sessions. Install that plugin once per machine and the agents navigate by the
language's own resolution; without it they fall back to grep, correctly but more
noisily. Nothing here enforces the install — it is one more line in the contract.

---

## Solo vs. pair, in one place

Every story is built one of two ways, chosen per story by `/agentic-sdlc:build`:

- **SOLO** — one coder runs the story end to end. The default for small,
  well-specified stories with an existing pattern to follow. This is the original
  behaviour and remains fully supported.
- **PAIR** — ping-pong TDD split across two agents (navigator + coder), one
  increment at a time through a shared pair log at `backlog/pair/<STORY-ID>.md`.
  Chosen for M/L, novel, or previously-bounced stories.

Pairing roughly doubles a story's turns, so `/agentic-sdlc:build` sends it only
where the risk justifies it. Mode is orthogonal to the epic cascade: a wave can
hold SOLO and PAIR stories side by side, each in its own worktree. (The token
economics of the fresh-spawned pair agents are covered under
[Token utility](#token-utility-and-output-quality).)

---

## What stays in the project, deliberately

This plugin carries the **protocol**. It does not carry anything a project
learned the hard way about itself. Those belong in the project's own `CLAUDE.md`
and `.claude/settings.json`, and they should never be upstreamed here:

- Domain non-negotiables ("this service is not internet-facing", "idempotency
  keys are load-bearing")
- Infrastructure deny-rules specific to that project's blast radius
- Stack, commands, module layout, wire format

**Permissions are not contributed by plugins.** Each project owns its own
`permissions.deny`. `templates/settings.baseline.json` holds only the three
categories that are wrong everywhere — force-push, self-merge, secret reads —
as a copy-in starting point, not a live dependency.

---

## Routines

`templates/routines/` holds the two prompts that run **outside** the pipeline as
Claude Code cloud routines — hourly PR review, weekly gap scan. They are not
plugin components; they are pasted into the routine configuration. They live here
so the review bar and the maturity ladder are diffable and versioned alongside
the agents that they judge.

The review routine is now a thin caller of `/agentic-sdlc:review`, so the bar
itself lives in the agent, not the routine — the routine needs only the plugin
enabled in the project's settings. A cloud routine starts from a checkout of
`main`; `/agentic-sdlc:review` builds its own worktree of the PR head from
there.

---

## Where this sits among other SDLC tools

The AI-coding landscape splits roughly three ways, and this plugin is
deliberately in the third:

- **Inline assistants** — Copilot, Cursor's autocomplete, Cody. They complete the
  line and answer questions in the editor. Fast, local, and stateless about your
  process: they have no opinion about *how* a feature gets planned, tested and
  reviewed.
- **Autonomous single agents** — Devin, Cursor Composer/Agent, Aider, OpenAI
  Codex, and plain Claude Code used ad hoc. You hand one agent a task and it works
  the whole thing. Powerful, but the *process* is implicit and unversioned:
  quality depends on the prompt you happened to write that day, and two repos
  running "the same" agent are running whatever each person typed.
- **Opinionated, versioned pipelines** — where this lives. The unit of reuse is
  not a completion or a single agent but a **multi-agent protocol** with roles
  (planner, architect, coder, navigator, reviewer), explicit handoffs, a debt
  ledger, model tiering, and a human merge gate — shipped as a plugin and **pinned
  by tag** so every consuming repo runs a known version.

The nearest cousins to the *idea* are spec-driven kits like GitHub's **spec-kit**
(spec → plan → tasks) and role/skill libraries like **superpowers**. The
differences that matter:

- **Spec-kit** structures the artifacts; it does not tier models, split solo/pair,
  carry a tooling-debt ledger, or ship a review agent with a fast-floor. This is
  the *execution* pipeline around such a spec, with cost as a first-class concern.
- **superpowers** sits **underneath** this pipeline, not in front of it — see the
  next section. It supplies skills; this supplies the workflow that decides when a
  skill is worth reaching for.

What distinguishes this plugin specifically: **versioning as the anti-drift
mechanism** (pin a tag, bump with a one-line diff, changelog derived from commit
type), a **two-lane quality dial** with the same commands, **an explicit debt
ledger at every rung**, and **token cost treated as a design constraint** rather
than an afterthought.

### Relationship to superpowers

Superpowers sits **underneath this pipeline, not in front of it.** `/plan` and
`/build` are the entry points for product work — running the brainstorm →
write-plan → execute-plan loop as well produces a backlog *and* a plan file that
disagree about which is real.

Each agent has the `Skill` tool and a short section naming the superpowers skills
that fit its role. **When to reach for one is the agent's judgment**, not a gate.
Skipping one is a shortcut like any other, and the ledger rule applies.

### Roadmap — what it should and can do next

The pipeline is real and in use; these are the honest gaps and the direction,
roughly in priority order:

1. **Measure the fast-lane savings.** The `~52 → ~6` spawn figure is *projected,
   not yet measured*. Instrument real runs and publish per-lane token/spawn
   numbers so the trade-off is evidence, not estimate.
2. **Automate the pin bump.** A routine that compares each consuming project's
   pinned `ref` against the latest tag and opens a bump PR — turning "keep
   current" from a discipline into a notification (the last of the anti-drift
   rules, not yet built as tooling).
3. **Close the cloud/LSP gap.** LSP navigation is unavailable in cloud sessions
   today; agents fall back to grep silently. Detect the fallback and surface it,
   and explore a server-backed navigation path for cloud routines.
4. **Debt paydown as a first-class flow.** A `Mode: FAST` PR generates ledger
   rows by design; there is no command yet that reads the ledger back and plans
   the promotion of a fast task to the deliberate bar. A `/promote` or
   debt-triage command would close that loop.
5. **Broader language and skill coverage.** The contract assumes a per-language
   code-intelligence plugin and a project-stated check command; smoothing that
   setup (and expanding the superpowers skill hints per agent) lowers the
   first-run cost.
6. **Metrics surface.** Cost, review round counts, and rung distribution per
   feature are latent in the artifacts; a lightweight report would make the
   quality dial tunable from data.

Roadmap items are candidates, not commitments — they are written here so the
direction is diffable, same as everything else.

---

## Releasing

**release-please owns the version, the tag and `CHANGELOG.md`.** Nobody bumps a
version by hand and nobody remembers to write release notes — which is the whole
point, because "remembering" is what produces a stale `/build` inside forty
minutes of a repo existing.

```
conventional commits on main
   → release-please opens a release PR (bumps the version files, drafts notes)
      → you edit its CHANGELOG section if the release deserves narrative
         → you merge it            ← the human gate
            → tag v<version> ships
```

Match the commit type to what a consuming project has to do:

| Commit | Bump (pre-1.0) | Means |
|---|---|---|
| `fix:` | patch — `0.1.1 → 0.1.2` | Nothing to do. Bump the pin when convenient. |
| `feat:` | patch — `0.1.1 → 0.1.2` | New capability. Nothing to do. |
| `feat!:` / `BREAKING CHANGE:` | minor — `0.1.1 → 0.2.0` | **The consuming project must act** — a new required path, a renamed agent, a changed contract. |
| `docs:` | none | Shows in the changelog, cuts no release. |
| `chore:` `ci:` `test:` | none, hidden | Invisible. |

Below 1.0 the config sets `bump-minor-pre-major` and
`bump-patch-for-minor-pre-major`, so **a minor bump means and only means "you have
work to do."** That is a more useful signal than semver's default here, where
every consumer is a repo whose settings file names a `ref`.

### Where the narrative goes

release-please drafts from commit subjects and single-line body bullets; it will
not carry a paragraph, and it truncates multi-line bullets. So:

- **Reasoning that a future reader needs** goes in the README, an ADR, or a
  comment beside the thing it explains — not only in the changelog.
- **Release-specific narrative** — "supersedes 0.1.0", "do not pin this" — goes
  in the **release PR**. It is an ordinary PR: push a commit rewriting its
  `CHANGELOG.md` section, then merge. Nothing regenerates it afterwards.

### The three version files

`plugins/agentic-sdlc/.claude-plugin/plugin.json` is the authority Claude Code
reads. `version.txt` and `.release-please-manifest.json` are release-please's
bookkeeping. **All three are machine-written — never hand-edit any of them**; CI
checks they agree, because a release that tags without moving `plugin.json` bumps
nothing that Claude Code can see and reaches no existing install.

Never put a `version` in `marketplace.json`: `plugin.json` beats it silently.

```bash
./scripts/preflight.sh   # runs the CI invariants locally. Does not tag.
```

### Two things this repo needs configured once

- **`RELEASE_PLEASE_TOKEN`** — a PAT with `repo` + `workflow` scope. The
  `GITHUB_TOKEN` fallback cannot work if the organisation refuses "Allow GitHub
  Actions to create and approve pull requests" org-wide, so without the PAT
  release-please can never open a release PR and nothing ever ships.
- **Required status checks** — `validate`, `conventional-title` and
  `shipped-content-is-releasable`. The last one fails a PR that edits `plugins/**`
  under a type release-please ignores, which would otherwise merge, cut no
  version, and reach nobody.

`name` is the stable identifier — it is what `enabledPlugins` keys on in every
consuming project. To change the label, set `displayName` and leave `name` alone.
If it ever must change, add a `renames` entry to `marketplace.json` and treat that
map as append-only.

---

## Avoiding drift — the rules that make this work

1. **Consuming projects do not keep local copies.** No `.claude/agents`,
   `.claude/commands`, no symlinks. If there is a file to edit at 11pm, someone
   edits it and the fix never comes back here.
2. **Fixes land here first**, then propagate as a pin bump. Two small PRs.
3. **Deliberate divergence gets written down** in the project's
   `docs/PIPELINE-LOCAL.md`, with a trigger, same as the tooling-debt ledger. A
   divergence you recorded is a decision; one you didn't is drift.
4. **The changelog is generated, not remembered.** release-please derives it
   from commit types, so "what must a consuming project do" is answered by
   whether you wrote `feat!:` or `feat:` — a decision taken while the change is
   fresh, rather than reconstructed at release time by whoever is cutting it.
5. **Automate the nudge.** A routine that compares each project's pinned `ref`
   against the latest tag and opens a bump PR turns "keep current" from a
   discipline into a notification.

---

## Repository layout

```
.claude-plugin/marketplace.json          catalog — the thing projects add
plugins/agentic-sdlc/
  .claude-plugin/plugin.json             manifest — the version authority
  agents/{planner,architect,coder,navigator,code-reviewer}.md
  commands/{plan,build,review}.md
  reference/                             protocols loaded on demand, never by default
    pair-loop.md, coder-pair-mode.md, coder-revise-mode.md
    fast-mode.md, coder-fast-mode.md     read only when --fast is present
    review-fast-floor.md                 read only when the PR stamps Mode: FAST
  scripts/pair-log.mjs                   the pair log's only read/write surface
templates/
  settings.baseline.json                 universal deny-rules, copy-in
  TOOLING-DEBT.md                        empty ledger
  brief.md                               the input to /plan
  ADR.md                                 house format — decision, not options paper
  backlog/{EPIC,FAST}-template.md
  routines/{review,gap-scan}-prompt.md   cloud routine prompts — review delegates to /agentic-sdlc:review
scripts/preflight.sh                     CI invariants, locally. Does not tag.
release-please-config.json               how a commit type becomes a version
.release-please-manifest.json  ┐ machine-written bookkeeping —
version.txt                    ┘ never hand-edit, CI checks they agree
```
