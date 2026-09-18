# Contributing

Thanks for wanting to work on **agentic-sdlc**. This plugin is the shared *how* for
teams shipping product with Claude Code, so the bar is less "is this clever" and
more "will every consuming project understand what changed and what they must do
about it." That bar is mostly mechanical, and this document is how to clear it.

Back to the [README](README.md).

## Ways to help

- **Fix a rough edge in the protocol** — an agent that reads a path badly, a
  reminder stub that has drifted from its `reference/` protocol, a template that
  produces a sprawling backlog.
- **Close a roadmap item** — see [Roadmap](#roadmap) below. The measurement and
  automation items are the highest-leverage and the least glamorous.
- **Improve the docs** — the README and `docs/` are the product as much as the
  agents are. If something confused you, that is a bug.
- **Report a drift or a footgun** — open an issue describing what a consuming
  project hit. Real-world failure modes are what shaped every "> note" callout in
  the docs.

## Before you open a PR

1. **Develop on a branch**, never on `main`.
2. **Run the invariants locally** — this is the same set CI enforces, and it does
   not tag:
   ```bash
   ./scripts/preflight.sh
   ```
3. **Write a Conventional Commit** — the type is not decoration; it decides the
   release. See [Releasing](#releasing).
4. **Do not hand-edit the version files.** `plugin.json`, `version.txt` and
   `.release-please-manifest.json` are machine-written; CI checks they agree.
5. **Keep project-specific knowledge out.** Anything a single project learned about
   itself belongs in that project, never upstream here — see
   [What stays in the project](docs/setup.md#what-stays-in-the-project-deliberately).

Required status checks on every PR: `validate`, `conventional-title` and
`shipped-content-is-releasable`.

---

## Releasing

**release-please owns the version, the tag and `CHANGELOG.md`.** Nobody bumps a
version by hand and nobody remembers to write release notes — which is the whole
point, because "remembering" is what produces a stale `/build` inside forty minutes
of a repo existing.

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
work to do."** That is a more useful signal than semver's default here, where every
consumer is a repo whose settings file names a `ref`.

### Where the narrative goes

release-please drafts from commit subjects and single-line body bullets; it will
not carry a paragraph, and it truncates multi-line bullets. So:

- **Reasoning that a future reader needs** goes in the README, an ADR, or a comment
  beside the thing it explains — not only in the changelog.
- **Release-specific narrative** — "supersedes 0.1.0", "do not pin this" — goes in
  the **release PR**. It is an ordinary PR: push a commit rewriting its
  `CHANGELOG.md` section, then merge. Nothing regenerates it afterwards.

### The three version files

`plugins/agentic-sdlc/.claude-plugin/plugin.json` is the authority Claude Code
reads. `version.txt` and `.release-please-manifest.json` are release-please's
bookkeeping. **All three are machine-written — never hand-edit any of them**; CI
checks they agree, because a release that tags without moving `plugin.json` bumps
nothing that Claude Code can see and reaches no existing install.

Never put a `version` in `marketplace.json`: `plugin.json` beats it silently.

### Two things this repo needs configured once

- **`RELEASE_PLEASE_TOKEN`** — a PAT with `repo` + `workflow` scope. The
  `GITHUB_TOKEN` fallback cannot work if the organisation refuses "Allow GitHub
  Actions to create and approve pull requests" org-wide, so without the PAT
  release-please can never open a release PR and nothing ever ships.
- **Required status checks** — `validate`, `conventional-title` and
  `shipped-content-is-releasable`. The last one fails a PR that edits `plugins/**`
  under a type release-please ignores, which would otherwise merge, cut no version,
  and reach nobody.

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
4. **The changelog is generated, not remembered.** release-please derives it from
   commit types, so "what must a consuming project do" is answered by whether you
   wrote `feat!:` or `feat:` — a decision taken while the change is fresh, rather
   than reconstructed at release time by whoever is cutting it.
5. **Automate the nudge.** A routine that compares each project's pinned `ref`
   against the latest tag and opens a bump PR turns "keep current" from a
   discipline into a notification.

---

## Roadmap

The pipeline is real and in use; these are the honest gaps and the direction,
roughly in priority order. They are candidates, not commitments — written here so
the direction is diffable, same as everything else, and so a contributor can pick
one up.

1. **Measure the fast-lane savings.** *(In progress.)* The `~52 → ~6` spawn figure
   is *projected, not yet measured*. The instrument now exists —
   `plugins/agentic-sdlc/scripts/meter.mjs` reports per-lane, per-agent token/spawn
   numbers with a caching-aware cost model (see
   `docs/superpowers/specs/2026-09-17-meter-and-benchmark-design.md`). Still owed:
   run it on real runs (and the A0 cache probe, `scripts/probe-cache.mjs`) and
   publish the measured figure with its IQR.
2. **Automate the pin bump.** A routine that compares each consuming project's
   pinned `ref` against the latest tag and opens a bump PR — turning "keep current"
   from a discipline into a notification (rule 5 above, not yet built as tooling).
3. **Close the cloud/LSP gap.** LSP navigation is unavailable in cloud sessions
   today; agents fall back to grep silently. Detect the fallback and surface it, and
   explore a server-backed navigation path for cloud routines.
4. **Debt paydown as a first-class flow.** A `Mode: FAST` PR generates ledger rows
   by design; there is no command yet that reads the ledger back and plans the
   promotion of a fast task to the deliberate bar. A `/promote` or debt-triage
   command would close that loop.
5. **Broader language and skill coverage.** The contract assumes a per-language
   code-intelligence plugin and a project-stated check command; smoothing that setup
   (and expanding the superpowers skill hints per agent) lowers the first-run cost.
6. **Metrics surface.** *(In progress.)* Cost, review round counts, and rung
   distribution per feature are latent in the artifacts; a lightweight report would
   make the quality dial tunable from data. `meter.mjs` (`report`/`record`/`diff`)
   and the `templates/hooks/meter.sh` Stop/SubagentStop hook are the cost half —
   records land in `.agentic-sdlc/meter/`. Still owed: the quality half (`bench/`,
   designed in the 2026-09-17 spec) and a report that joins the two.

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
  scripts/meter.mjs                      per-lane/per-agent cost meter (report/record/diff/boot/capture)
templates/
  settings.baseline.json                 universal deny-rules, copy-in
  hooks/lsp-preflight.sh                  SessionStart: warn when a language server is missing
  hooks/meter.sh                         Stop/SubagentStop: append a cost record (best-effort)
  hooks/settings.hooks.json              copy-in registration for the hooks above
  TOOLING-DEBT.md                        empty ledger
  brief.md                               the input to /plan
  ADR.md                                 house format — decision, not options paper
  backlog/{EPIC,FAST}-template.md
  routines/{review,gap-scan}-prompt.md   cloud routine prompts — review delegates to /agentic-sdlc:review
scripts/preflight.sh                     CI invariants, locally. Does not tag.
scripts/meter.test.sh                    meter fixtures + the degradation invariant
scripts/size-budget.{json,mjs}           ratchet-only byte caps on the agent boot path
scripts/probe-cache.mjs                  A0 cache-prefix probe (run manually; spends API budget)
docs/build-rationale.md                  the #77/#73/release-please reasoning, read once
release-please-config.json               how a commit type becomes a version
.release-please-manifest.json  ┐ machine-written bookkeeping —
version.txt                    ┘ never hand-edit, CI checks they agree
```
