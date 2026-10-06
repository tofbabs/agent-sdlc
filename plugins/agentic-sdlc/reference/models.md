# MODELS — per-agent overrides

Read by `/plan`, `/build` and `/review` **only when the human overrides a model**.
Without an override every agent runs on its frontmatter model, and nothing here
applies.

## Where an override comes from

Highest first; the first one that names an agent wins for that agent:

1. `--model <agent>=<m>` in the command's arguments, after the target (the run
   report reads the target from the first word). Repeatable, one per agent:
   `/agentic-sdlc:build EPIC-3 --model navigator=opus --model architect=fable`.
   `/review --fable` is shorthand for `--model code-reviewer=fable`.
2. A line in the project's `CLAUDE.md`, for every run in that project:
   ```
   **Agent models:** architect=fable navigator=opus
   ```

`<agent>` is one of `planner`, `architect`, `coder`, `driver`, `navigator`,
`code-reviewer`. `<m>` is `sonnet`, `opus`, `haiku` or `fable` — the aliases both
`Agent()` and `claude --model` accept. Anything else → stop and say which value
is wrong; never guess the nearest.

## Applying one

Resolve the overrides **once**, at the start of the run, and use the same map on
every spawn:

- `Agent()` → add `model: "<m>"` to every call for that agent, fresh spawns and
  manual-fallback pair turns alike.
- `pair-run.mjs` → `--navigator-model <m>` / `--driver-model <m>`.

An override beats your own escalations: `coder=sonnet` means a data-risk SOLO
story stays on Sonnet. It is the human's cost and quality call, so you never set a
model the human did not name, except the coder escalations `/build` already
allows when no override names the coder.

Say the resolved map in your report's first line (`models: navigator=opus`), so a
run's cost can be read against the models that produced it.
