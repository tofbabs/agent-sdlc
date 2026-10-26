# Feature: a backlog store interface, with the repo as its only adapter

## Problem

Commands, agents and scripts read and write planning state by path:
`backlog/<ID>.md`, `docs/briefs/<slug>.md`, story sections inside the epic
file, status lines written in place. That path knowledge is spread across
`plan.md`, `build.md`, `review.md`, the planner, coder and reviewer prompts,
`plan-artifacts.mjs` and `mode-select.mjs`. Storing the plan anywhere else, such
as GitHub Issues (see `02-github-adapter.md`), means touching all of them at
once. That is the big bang this brief exists to avoid.

## Users

- **Maintainers.** They want one place that knows where the plan lives.
- **Consuming projects.** They want nothing to change.

## Outcome

All plan reads and writes go through one store interface. `repo` is the only
adapter, and it does exactly what happens today. A store setting exists and is
read in one place. Its only valid value is `repo`, and anything else fails with
a clear message. Adding a store becomes a new adapter plus one line in the
selector.

## Success metric

Places in `commands/`, `agents/` and `scripts/*.mjs` that name a `backlog/<ID>.md`
path for plan content, outside the store and `reference/`: **today's count → 0**.
The planner counts the baseline. This is a refactor, so every existing script
test passes unchanged and the boot-path size budget does not grow.

## Scope — in

- **The interface:** write brief, read brief, claim ID, write plan, read plan,
  read story, set story or plan status, record ARCH resolution, link a PR to
  the stories it implements, and record a story's landing commit. The ops are
  drawn from what the commands do today, not from what GitHub could do. The
  interface knows the brief → epic → story hierarchy, so a PR link that spans
  epics can be refused in every store. The repo adapter writes the PR and
  commit into the story's section of `backlog/<ID>.md`.
- **Write brief** is the one op no command calls yet. 02's `/write-brief` is its
  first caller. It takes a slug and the brief markdown and returns the brief's
  reference, which is what `read brief` and `/plan` take. The repo adapter
  creates `docs/briefs/<slug>.md` with an exclusive open and refuses if the file
  exists, so a re-run never overwrites a hand-edited brief. It lives here
  rather than in 02 so the architect checks the full op list against both
  stores at once.
- **A shipped script** (`scripts/backlog-store.mjs` or similar) that exposes
  those ops as subcommands, with a `.test.sh`. Plain Node, no dependencies.
  `claim` moves behind it. `carry` keeps handling ADRs and other repo files.
- **The selector.** `backlog.store` in `.claude/agentic-sdlc.json`, read only
  through `config.mjs` (ADR-0006), plus a per-command `--store` flag that
  overrides it. It is read once and resolved by the script as flag > project
  config > `repo`.
- **Commands and agents** switch to the script for plan reads and writes. The
  protocol goes in `reference/`. Boot-path files shrink or hold steady.
- **Headless:** every new script invocation needs a scoped allow rule that
  holds under `claude -p` (EPIC-3, ARCH-1).

## Scope — out

- Any GitHub code. That is brief 02.
- Any change to plan content, story shape, lanes or modes.
- Moving ADRs, `TOOLING-DEBT.md` or the pair log behind the interface. They stay
  repo files in every mode.

## Value dependency

It stands alone. It gives a proven, tested seam and removes scattered path
knowledge, even if 02 never ships.

## Technical context

- Touches `commands/plan.md`, `build.md`, `review.md`, `agents/planner.md`,
  `coder.md`, `code-reviewer.md`, `scripts/plan-artifacts.mjs`,
  `scripts/mode-select.mjs` (`--file backlog/EPIC-<n>.md --id`),
  `reference/plan-artifacts.md`, `reference/fast-mode.md`.
- Where the setting lives is settled: `backlog.store` in
  `.claude/agentic-sdlc.json` (ADR-0006, amended by ADR-0007). Don't reopen it.
- Precedent for a setting plus a flag override: `**Agent models:**` in
  `CLAUDE.md` with `--model`, documented in `reference/models.md`.
- Plain Node 22, Bash tests run by `scripts/preflight.sh` and CI.
- Ships in the plugin: `feat:`. It changes no behaviour, but `fix:` would
  misdescribe a new setting.

## Constraints

- The interface must fit a remote store (02): ops are coarse, IDs are opaque
  strings, and the store assigns IDs. In 02 the ID is the brief Issue's
  number, so `claim` must accept an ID the brief already fixes (it does today,
  with `--id`). The architect checks the op list against 02's needs before
  accepting it.
- Deadline: none.

## Open questions

- Does `mode-select.mjs` take a story ID and ask the store, or keep taking a
  file that the store materialises?
