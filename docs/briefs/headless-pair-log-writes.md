# Feature: headless pair-log writes that never hit a permission denial

## Problem

About 20% of headless navigator turns spend part of the turn fighting permission
denials when writing STATE. The navigator does what `agents/navigator.md` tells
it to: pipe a body into the script, usually as

```
cat <<EOF | node ${CLAUDE_PLUGIN_ROOT}/scripts/pair-log.mjs state <STORY-ID>
...
EOF
```

Under `claude -p` (how `pair-run.mjs` runs every turn) nothing can be prompted,
so a command the allow-list does not match is denied outright. The heredoc plus
pipe shape is the one that gets denied. The navigator then retries with other
shapes (`echo`, `printf`, a temp file, the Write tool on the log file, which
`navigator.md` forbids). Each retry resends the whole turn context, and the
navigator is ~90% of a pair's cost. When the retries fail, STATE goes stale and
the next turn starts from a wrong picture. When the `append` call is denied too,
`pair-run` exits 5 ("turn made no pair-log entry").

This hits every consuming project that runs PAIR stories headless, on every
story. It is invisible today: `pair-run` gets `permission_denials` back in the
`--output-format json` result and throws it away.

## Users

- The `/build` orchestrator running `pair-run.mjs`. It needs every turn to write
  STATE and its entry on the first try.
- The human paying for the run. They need retries not to show up as cost.
- Maintainers. They need to see denials in the meter, not infer them from
  transcripts.

## Outcome

A headless navigator or driver writes STATE, appends its entry and sets the
session in one tool call each, with no permission denial, in a consuming
project's default setup. When a denial does happen, the meter records it.

## Success metric

Share of headless navigator turns with at least one permission denial on a
pair-log write: **~20% → 0%**, measured from `permission_denials` in the
per-turn meter line over the next PAIR epic built here.

## Scope — in

- One write shape for `state`, `append` and `session` that the headless
  permission check accepts. It is the same for both roles and documented once.
- Whatever `pair-run.mjs` has to pass or set up so that shape is allowed by
  default, without the consuming project editing its own settings.
- `navigator.md` and `driver.md` updated to the new shape. The boot-path size
  budget can only shrink, so the text replaces the old lines and must not add to
  them.
- `pair-run.mjs` records the denial count (and the denied tool names, no
  arguments) in its per-turn meter line.
- Tests in `scripts/pair-log.test.sh` / `scripts/pair-run.test.sh` for the new
  input path and the meter field.

## Scope — out

- Widening permissions in general. No `--dangerously-skip-permissions` and no
  `bypassPermissions` default. Grants cover the pair-log script only.
- Any change to what STATE or entries contain, or to the 15- and 10-line caps.
- The manual (non-headless) fallback loop, which has a human to approve prompts.
- Permission denials outside pair-log (test runners, git). Log them as debt if
  you see them, but don't fix them here.
- Run-report schema changes. If the denial count belongs in the run report,
  raise it against `docs/briefs/self-improvement/01-run-report.md`.

## Value dependency

Each piece has value on its own. Recording denials in the meter is useful even
before the fix, because it gives the baseline the success metric needs. Build
it first.

## Technical context

- Existing systems this must integrate with: `plugins/agentic-sdlc/scripts/pair-log.mjs`
  (body on stdin today), `pair-run.mjs` (spawns `claude -p --agent … --output-format
  json`, plus `PAIR_RUN_CLAUDE_ARGS`), `agents/navigator.md`, `agents/driver.md`,
  `reference/pair-loop.md`.
- House stack: plain Node 22, no dependencies, Bash test scripts run by
  `scripts/preflight.sh` and CI.
- Hard constraints: works in a consuming project with no edits to its
  `.claude/settings.json`. Must not weaken `pair-log.mjs` as the log's only write
  surface (agents still never touch the files directly). The fix must hold on the
  Claude Code version the plugin supports today. Don't build on undocumented
  matcher behaviour.
- Deployment target: ships in the plugin, so `fix:`.
- Genuinely open questions: see below.

## Constraints

- Data / compliance: the meter records denied tool names and counts, never
  command text (a STATE body may quote code).
- Deadline: none.

## Open questions

- Which mechanism? Some candidates: `pair-run` passes a scoped `--allowedTools`
  grant for the pair-log script; `pair-log.mjs` takes the body from a file the
  agent writes with the Write tool (`--from <path>`); or it takes the body as an
  argument. The architect picks one. The choice should rest on which one the
  permission matcher reliably allows under `-p`, not on which reads nicest.
- Is the heredoc really the trigger, or is it the `${CLAUDE_PLUGIN_ROOT}`
  expansion, or the pipe into `node`? Reproduce it before picking a fix.
- Does the driver hit the same denials at a lower rate? The meter field answers
  this. Check it before deciding the fix is navigator-only.
