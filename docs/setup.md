# Setup — install and the project contract

Back to the [README](../README.md).

Everything a consuming project does to adopt the pipeline: install and pin it, the
paths the agents assume exist, what deliberately stays in the project, and the
cloud routines.

---

## Install

Add the marketplace and enable the plugin, pinned to a tag:

```bash
claude plugin marketplace add tofbabs/agent-sdlc@v0.1.1
claude plugin install agentic-sdlc@sanimara
```

Better, do it declaratively so the pin is checked in and reviewable. In the
consuming project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "sanimara": {
      "source": {
        "source": "github",
        "repo": "tofbabs/agent-sdlc",
        "ref": "v0.1.1"
      }
    }
  },
  "enabledPlugins": { "agentic-sdlc@sanimara": true }
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
> `claude plugin install agentic-sdlc@sanimara --scope local`, then restart.

The plugin is listed by relative path inside this repo, so the marketplace `ref`
pins the plugin transitively. One knob, not two.

> A marketplace source accepts `ref` (branch or tag) but **not** `sha`. Only
> plugin entries inside `marketplace.json` accept both. Tags are the currency here.

> **Everything is namespaced by the plugin name.** `plugin.json`'s `name` is what
> namespaces components, so the commands are `/agentic-sdlc:plan`,
> `/agentic-sdlc:build` and `/agentic-sdlc:review`, and the agents register as
> `agentic-sdlc:planner`, `agentic-sdlc:architect`, `agentic-sdlc:coder`,
> `agentic-sdlc:navigator`, `agentic-sdlc:code-reviewer` —
> there are no bare `/plan`, `/build`, `/review` or `planner` variants. A project
> moving off local `.claude/agents` loses the unprefixed names it was used to; the
> docs it wrote against them need updating with the pin.

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
| `CLAUDE.md` line `**Integration branch:** <name>` | Names the branch `/build` branches from and opens its PR against. Absent → `main` | only if the project does not integrate on `main` |

`templates/` has a starting point for each. Copy them in on first setup:

```bash
cp templates/TOOLING-DEBT.md          <project>/docs/
cp templates/backlog/EPIC-template.md <project>/backlog/
cp templates/backlog/FAST-template.md <project>/backlog/   # only if you use --fast
cp templates/brief.md                 <project>/docs/templates/
cp templates/ADR.md                   <project>/docs/templates/
cp templates/hooks/lsp-preflight.sh   <project>/.claude/hooks/   # optional; see "Code navigation is LSP-first"
```

### The brief is part of the protocol

`/plan` takes a brief and generates everything downstream from it, so its shape
decides what the backlog looks like. `templates/brief.md` is that shape.

Two sections carry most of the weight and the template says so in place:
`Scope — out`, which is what stops the planner inventing epics, and `Technical
context`, which on a greenfield repo is the only evidence the architect has for
choosing a stack. A brief thin on either produces a plausible, sprawling, wrong
backlog — cheaply, and in parallel.

### ADRs use a house format, deliberately

`templates/ADR.md` has no "Options Considered" section. MADR and its relatives do,
and that contradicts `architect.md`, which is told to decide rather than produce
an options paper. Rejected alternatives appear under **Decision**, as things
already ruled out and why.

An ADR is for a **one-way door** only. Everything cheaper is resolved in place in
the epic file as `ARCH-<n>` with `reversibility: TWO-WAY`.

### CLAUDE.md names the integration branch, if it isn't `main`

`/build` branches the epic from `origin/<base>`, merges `origin/<base>` in
between waves, and opens the epic PR against `<base>`. It resolves `<base>` from
a literal line in the project's `CLAUDE.md`:

> **Integration branch:** `staging`

No such line and `<base>` is `main`, which is why most projects need nothing
here. A project that integrates on `staging`, `develop` or a release train needs
the line — otherwise every epic PR is opened against the wrong branch, and the
agents never guess.

### CLAUDE.md must state the check command

`coder.md` tells the coder to run "whatever checks exist (`CLAUDE.md` lists them)".
If `CLAUDE.md` doesn't name them, the coder either invents a toolchain or skips
verification. Both are bad. Put a literal line in the project's `CLAUDE.md`:

> **Always run before opening a PR:** `<the actual command>`

That and the integration-branch line are the two literal lines `/build` reads out
of `CLAUDE.md`; everything else in the file is conventions for the agents.

### Code navigation is LSP-first

Every agent carries the `LSP` tool and is told to use it — not `Grep` — for
anything semantic. (Why this matters for token cost and output quality is in
[concepts.md](concepts.md#lsp-first-navigation--fewer-tokens-better-answers).)

The `LSP` tool needs a **code-intelligence plugin installed for the project's
language** (TypeScript, Python, Rust, …), and it is not available in cloud
sessions. Install that plugin once per machine and the agents navigate by the
language's own resolution; without it they fall back to grep, correctly but more
noisily.

Nothing *enforces* the install — but `templates/hooks/lsp-preflight.sh` makes the
gap visible instead of silent. It is a `SessionStart` hook that detects the
project's language from its manifest files, checks whether a matching language
server is on `PATH`, and — if one is missing — feeds a note into the session so
you and the agents both know the `LSP` tool won't resolve and navigation will
fall back to grep. It is advisory only: detection, no installs, no network, and
it never fails the session. In a cloud session, where LSP is unavailable
regardless, it just says so once. Copy it in and register it:

```bash
cp templates/hooks/lsp-preflight.sh    <project>/.claude/hooks/
# then merge templates/hooks/settings.hooks.json into <project>/.claude/settings.json
```

---

## What stays in the project, deliberately

This plugin carries the **protocol**. It does not carry anything a project learned
the hard way about itself. Those belong in the project's own `CLAUDE.md` and
`.claude/settings.json`, and they should never be upstreamed here:

- Domain non-negotiables ("this service is not internet-facing", "idempotency keys
  are load-bearing")
- Infrastructure deny-rules specific to that project's blast radius
- Stack, commands, module layout, wire format

**Permissions are not contributed by plugins.** Each project owns its own
`permissions.deny`. `templates/settings.baseline.json` holds only the three
categories that are wrong everywhere — force-push, self-merge, secret reads — as a
copy-in starting point, not a live dependency.

---

## Routines

`templates/routines/` holds the two prompts that run **outside** the pipeline as
Claude Code cloud routines — hourly PR review, weekly gap scan. They are not plugin
components; they are pasted into the routine configuration. They live here so the
review bar and the maturity ladder are diffable and versioned alongside the agents
that they judge.

The review routine is now a thin caller of `/agentic-sdlc:review`, so the bar
itself lives in the agent, not the routine — the routine needs only the plugin
enabled in the project's settings. A cloud routine starts from a checkout of the
project's integration branch (`<base>` — `main` unless `CLAUDE.md` says
otherwise); `/agentic-sdlc:review` builds its own worktree of the PR head from
there.
