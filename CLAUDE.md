# agent-sdlc — builds itself

This repository is the `agentic-sdlc` plugin, and it is planned and built with
that same plugin. `.claude/settings.json` enables `agentic-sdlc@sanimara` from
this repo, pinned to the **latest released tag**. release-please moves the pin
in every release PR. So the pipeline running here is always the last release,
never the branch you are editing.

**Always run before opening a PR:** `./scripts/preflight.sh`

**Integration branch:** `main`

## The loop

1. Write a brief from `templates/brief.md` into `docs/briefs/<slug>.md`. It is
   the only document written by hand.
2. `/agentic-sdlc:plan docs/briefs/<slug>.md` (add `--fast` for the lean lane).
   This writes `backlog/EPIC-<n>.md` or `backlog/FAST-<n>.md`.
3. `/agentic-sdlc:build EPIC-<n>` (or `FAST-<n> --fast`). This opens one PR.
4. `/agentic-sdlc:review <PR-n>`. Then a human merges.

To dogfood an **unreleased** change to the plugin itself, start a session with
`claude --plugin-dir ./plugins/agentic-sdlc`. Never point the checked-in pin at
a branch or at the working tree.

## Conventions

- **The PR title is the release.** PRs squash-merge, and release-please reads
  the subject. Use Conventional Commits. A PR that touches `plugins/**` must be
  `feat:` or `fix:` (`feat!:` when a consuming project has to act). Otherwise
  the change ships to nobody, and CI fails it.
- **Never hand-edit version files:** `plugin.json`, `version.txt`,
  `.release-please-manifest.json`, and the `ref` in `.claude/settings.json`.
  release-please writes all four, and preflight checks that they agree.
- **The agent boot path has a size budget.** It covers `agents/*.md` and
  `commands/*.md`, the budget can only shrink (`scripts/size-budget.json`), and
  protocol that is only sometimes needed belongs in `reference/`, which is
  loaded on demand.
- **Shipped scripts are tested.** `plugins/agentic-sdlc/scripts/*.mjs` each have
  a `scripts/<name>.test.sh` that preflight and CI run. Use plain Node, with no
  dependencies.
- **Keep project-specific knowledge out of `plugins/`.** What one consuming
  project learned about itself stays in that project.
- **Comments say why, never what.**
- The templates in `templates/` are what consuming projects copy. This repo
  uses them in place (the hooks run from `templates/hooks/`) and does not keep
  copies. Copies here would drift exactly the way the plugin exists to prevent.

## Layout

See the "Repository layout" section of `CONTRIBUTING.md`. Backlog files live in
`backlog/`, briefs in `docs/briefs/`, ADRs in `docs/adr/` (created by the
architect on the first one-way door), and the debt ledger in
`docs/TOOLING-DEBT.md`.
