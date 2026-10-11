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

- **The interface:** read brief, claim ID, write plan, read plan, read story,
  set story or plan status, record ARCH resolution, link a PR to the stories it
  implements, and record a story's landing commit. The ops are drawn from what
  the commands do today, not from what GitHub could do. The interface knows
  the brief → epic → story hierarchy, so a PR link that spans epics can be
  refused in every store. The repo adapter writes the PR and commit into the
  story's section of `backlog/<ID>.md`.
- **A shipped script** (`scripts/backlog-store.mjs` or similar) that exposes
  those ops as subcommands, with a `.test.sh`. Plain Node, no dependencies.
  `claim` moves behind it. `carry` keeps handling ADRs and other repo files.
- **The selector.** A persistent project setting plus a per-command `--store`
  flag that overrides it, read once and resolved by the script. Default:
  `repo`.
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
- Precedent for a setting plus a flag override: `**Agent models:**` in
  `CLAUDE.md` with `--model`, documented in `reference/models.md`.
- Plain Node 22, Bash tests run by `scripts/preflight.sh` and CI.
- Ships in the plugin: `feat:`. It changes no behaviour, but `fix:` would
  misdescribe a new setting.

## Constraints

- The interface must fit a remote store (02): ops are coarse, IDs are opaque
  strings, and the store assigns IDs. The architect checks the op list against
  02's needs before accepting it.
- Deadline: none.

## Open questions

- Where the setting lives: a `CLAUDE.md` line, `.claude/settings.json`, or a
  plugin config file. Scripts have to read it as well as agents. This is a
  one-way door once projects set it, so it needs an ADR.
- Does `mode-select.mjs` take a story ID and ask the store, or keep taking a
  file that the store materialises?
