# agentic-sdlc

A versioned, reusable **planner → architect → coder** pipeline for Claude Code,
distributed as a plugin so multiple projects can pull the same protocol in at a
pinned version and move forward deliberately instead of drifting.

Extracted from `reward-fulfillment-app` (MyJara), which in turn descended from
`sdlc-lite`. That descent is the reason this repo exists: the copy drifted, and
nobody could tell what had changed or why.

```
/agentic-sdlc:plan <brief>     planner → epics, stories, ARCH handoffs
                               architect → resolves the handoffs, decides
                               you skim (non-blocking)

/agentic-sdlc:build EPIC-<n>   coder → cascades every story onto one feat/EPIC-<n> branch
                               architect → unblocks the coder mid-build
                               ends at "one PR is open"
```

> **Everything is namespaced by the plugin name.** `plugin.json`'s `name` is what
> namespaces components, so the commands are `/agentic-sdlc:plan` and
> `/agentic-sdlc:build`, and the agents register as `agentic-sdlc:planner`,
> `agentic-sdlc:architect`, `agentic-sdlc:coder` — there are no bare `/plan`,
> `/build` or `planner` variants. A project moving off local `.claude/agents`
> loses the unprefixed names it was used to; the docs it wrote against them need
> updating with the pin.

**The one blocking gate is the human.** Nothing here merges its own PR.

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

---

## The contract a consuming project must satisfy

The agents assume these exist. Nothing enforces it — a missing one shows up as an
agent reading a path that isn't there.

| Path | Purpose | Required |
|---|---|---|
| `CLAUDE.md` | Conventions, and **the check command** the coder runs before opening a PR | yes |
| `backlog/` | Where `/plan` writes `EPIC-<n>.md`, and where `/build` reads stories | yes |
| `docs/TOOLING-DEBT.md` | The ledger. Appended to by architect and coder; triaged by the gap-scan routine | yes |
| `docs/adr/` | ACCEPTED ADRs are binding on every agent | created on first one-way door |

`templates/` has a starting point for each. Copy them in on first setup:

```bash
cp templates/TOOLING-DEBT.md          <project>/docs/
cp templates/backlog/EPIC-template.md <project>/backlog/
```

### CLAUDE.md must state the check command

`coder.md` tells the coder to run "whatever checks exist (`CLAUDE.md` lists
them)". If `CLAUDE.md` doesn't name them, the coder either invents a toolchain or
skips verification. Both are bad. Put a literal line in the project's `CLAUDE.md`:

> **Always run before opening a PR:** `<the actual command>`

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

Cloud routines see `main` on GitHub, not a working tree.

---

## Relationship to superpowers

Superpowers sits **underneath this pipeline, not in front of it.** `/plan` and
`/build` are the entry points for product work — running the brainstorm →
write-plan → execute-plan loop as well produces a backlog *and* a plan file that
disagree about which is real.

Each agent has the `Skill` tool and a short section naming the superpowers skills
that fit its role. **When to reach for one is the agent's judgment**, not a gate.
Skipping one is a shortcut like any other, and the ledger rule applies.

---

## Releasing

Version lives in **`plugins/agentic-sdlc/.claude-plugin/plugin.json` only.** Never
also in `marketplace.json` — Claude Code takes the manifest value silently, so a
stale manifest masks whatever the marketplace entry says.

```bash
./scripts/release.sh 0.2.0
```

The script refuses to tag unless the manifest version matches, `CHANGELOG.md` has
a matching section, and `claude plugin validate .` passes.

> **Bump on every release.** If the version string doesn't change, existing
> installs keep the cached copy and receive nothing, however many commits landed.

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
4. **CHANGELOG entry per release**, saying what a consuming project must do —
   usually nothing.
5. **Automate the nudge.** A routine that compares each project's pinned `ref`
   against the latest tag and opens a bump PR turns "keep current" from a
   discipline into a notification.

---

## Repository layout

```
.claude-plugin/marketplace.json          catalog — the thing projects add
plugins/agentic-sdlc/
  .claude-plugin/plugin.json             manifest — the version authority
  agents/{planner,architect,coder}.md
  commands/{plan,build}.md
templates/
  settings.baseline.json                 universal deny-rules, copy-in
  TOOLING-DEBT.md                        empty ledger
  backlog/EPIC-template.md
  routines/{review,gap-scan}-prompt.md   cloud routine prompts
scripts/release.sh
```
