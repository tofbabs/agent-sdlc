#!/usr/bin/env bash
#
# run-report.sh — UserPromptSubmit and SessionEnd hook feeding run-report.mjs.
#
# ONE script, dispatching on the payload's `hook_event_name`, because both
# events share the same marker (<project>/.agentic-sdlc/run-state.json) and the
# same resolution of run-report.mjs:
#
#   UserPromptSubmit — a pipeline slash command (/agentic-sdlc:plan, :build or
#   :review) writes or continues the marker (`run-report.mjs mark`). Anything
#   else exits 0 immediately on a cheap prefix check, before any JSON parsing
#   of the rest of the payload. UserPromptSubmit's stdout is injected straight
#   into the model's context (documented), so this path writes ABSOLUTELY
#   NOTHING to stdout on any branch — node's own stdout/stderr are redirected
#   away, never let through.
#
#   SessionEnd — finalizes whatever run is open. Its 1.5-second budget is
#   SHARED by every SessionEnd hook in the project, so this spawns
#   `run-report.mjs report` DETACHED (the pipeline's own completion artifacts —
#   the backlog file's statuses, the PR comments — are usually not even
#   written yet the instant the session ends) and returns at once. No marker
#   file at all → nothing to finalize, exit 0 without spawning.
#
# Like meter.sh, this is ADVISORY AND BEST-EFFORT: it never fails the session
# (always exits 0) and degrades quietly if node is missing or the payload
# doesn't carry what it needs.
#
# Copy it into <project>/.claude/hooks/ and register it for BOTH events (see
# templates/hooks/settings.hooks.json). ${CLAUDE_PLUGIN_ROOT} does NOT expand
# in project settings, so run-report.mjs is resolved in this order:
#   1. $RUN_REPORT_MJS, if set — an explicit override always wins;
#   2. the install cache, highest version first:
#        ~/.claude/plugins/cache/<marketplace>/agentic-sdlc/<version>/scripts/run-report.mjs
#   3. the marketplace clone:
#        ~/.claude/plugins/marketplaces/<marketplace>/plugins/agentic-sdlc/scripts/run-report.mjs
# ~/.claude is $CLAUDE_CONFIG_DIR when that is set. If none resolves: silent
# exit 0 on UserPromptSubmit (stdout must stay empty on every path, so no
# stderr note either, just in case something downstream is watching it too);
# a stderr note is fine on SessionEnd (visible under `claude --debug`), since
# nothing there reads this hook's stderr as model input.
#
# macOS ships /bin/bash 3.2: with `set -u`, "${arr[@]}" on an empty array
# aborts ("unbound variable") — meter.sh has exactly this bug. This script
# uses no arrays at all, so the trap does not apply here.

set -uo pipefail

command -v node >/dev/null 2>&1 || exit 0

input="$(cat)"

# read_field <name> — one field out of the JSON payload on stdin. Node, not
# python3 (meter.sh's choice): node is already required for everything else
# this hook does, so it is the one JSON parser this script depends on.
read_field() {
  MSG="$input" FIELD="$1" node -e '
    try {
      const d = JSON.parse(process.env.MSG)
      const v = d[process.env.FIELD]
      process.stdout.write(v === undefined || v === null ? "" : String(v))
    } catch {}
  ' 2>/dev/null
}

# Resolve run-report.mjs (order and paths: see the header).
resolve_run_report() {
  if [ -n "${RUN_REPORT_MJS:-}" ]; then printf '%s' "$RUN_REPORT_MJS"; return; fi
  local plugins="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins" c d v key=1,1
  # Rank by the version directory alone (not the marketplace name), and by
  # version, not lexically: 0.1.10 beats 0.1.9. `sort -V` is in GNU and recent
  # BSD/macOS sort; plain sort is the last resort.
  printf '' | sort -V >/dev/null 2>&1 && key=1,1V
  c="$(for d in "$plugins"/cache/*/agentic-sdlc/*/; do
         v="${d%/}"; v="${v##*/}"
         [ -f "${d}scripts/run-report.mjs" ] && printf '%s\t%s\n' "$v" "${d}scripts/run-report.mjs"
       done | sort -t "$(printf '\t')" -k "$key" | tail -n 1 | cut -f 2)"
  if [ -n "$c" ]; then printf '%s' "$c"; return; fi
  for c in "$plugins"/marketplaces/*/plugins/agentic-sdlc/scripts/run-report.mjs; do
    [ -f "$c" ] && { printf '%s' "$c"; return; }
  done
}

event="$(read_field hook_event_name)"

case "$event" in
  UserPromptSubmit)
    prompt="$(read_field prompt)"
    # Cheap prefix check FIRST, before resolving run-report.mjs or writing
    # anything to disk: almost every prompt is not a pipeline command.
    case "$prompt" in
      /agentic-sdlc:plan*|/agentic-sdlc:build*|/agentic-sdlc:review*) ;;
      *) exit 0 ;;
    esac

    session="$(read_field session_id)"
    cwd="$(read_field cwd)"
    [ -n "$session" ] || exit 0
    [ -n "$cwd" ] || cwd="${CLAUDE_PROJECT_DIR:-$PWD}"

    run_report="$(resolve_run_report)"
    [ -n "$run_report" ] && [ -f "$run_report" ] || exit 0

    # Never pass the prompt in argv — it can carry anything a user typed.
    promptfile="$(mktemp 2>/dev/null)" || exit 0
    printf '%s' "$prompt" > "$promptfile"
    node "$run_report" mark --project "$cwd" --prompt-file "$promptfile" --session "$session" >/dev/null 2>&1
    rm -f "$promptfile"
    ;;

  SessionEnd)
    cwd="$(read_field cwd)"
    [ -n "$cwd" ] || cwd="${CLAUDE_PROJECT_DIR:-$PWD}"
    [ -f "$cwd/.agentic-sdlc/run-state.json" ] || exit 0

    run_report="$(resolve_run_report)"
    if [ -z "$run_report" ] || [ ! -f "$run_report" ]; then
      echo "run-report.sh: run-report.mjs not found (set RUN_REPORT_MJS or install agentic-sdlc) — no report written" >&2
      exit 0
    fi

    # Detached: the 1.5s SessionEnd budget is shared by every hook in the
    # project, and this report reads completion artifacts the pipeline may
    # not have finished writing yet.
    if command -v setsid >/dev/null 2>&1; then
      setsid nohup node "$run_report" report --project "$cwd" </dev/null >/dev/null 2>&1 &
    else
      nohup node "$run_report" report --project "$cwd" </dev/null >/dev/null 2>&1 &
    fi
    disown 2>/dev/null || true
    ;;

  *) exit 0 ;;
esac

exit 0
