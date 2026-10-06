#!/usr/bin/env bash
#
# meter.sh — a Stop / SubagentStop hook that records what a run cost.
#
# Claude Code hands a hook its `transcript_path` and `session_id` on stdin (a
# documented door into the otherwise-internal transcript). On Stop / SubagentStop
# this hook feeds that path to meter.mjs, which appends a cost record to
# <project>/.agentic-sdlc/meter/ (gitignored). Over time those records are the
# per-lane, per-agent numbers the roadmap's "measure the savings" item asks for.
#
# It is ADVISORY AND BEST-EFFORT: it never fails the session (always exits 0), and
# it degrades quietly if node is missing or the transcript format has drifted —
# meter.mjs itself degrades to layer A and records `degraded` rather than crashing
# or reporting zeros. The VERIFIED cost path is the bench runner, which wraps
# `claude -p --output-format stream-json` (documented) and reads the stream
# directly; this hook meters real production runs on a best-effort basis.
#
# Copy it into <project>/.claude/hooks/ and register it (see
# templates/hooks/settings.hooks.json). ${CLAUDE_PLUGIN_ROOT} does NOT expand in
# project settings, so meter.mjs is resolved in this order:
#   1. $METER_MJS, if set — an explicit override always wins;
#   2. the install cache, highest version first:
#        ~/.claude/plugins/cache/<marketplace>/agentic-sdlc/<version>/scripts/meter.mjs
#      (where `claude plugin install agentic-sdlc@<marketplace>` puts it);
#   3. the marketplace clone:
#        ~/.claude/plugins/marketplaces/<marketplace>/plugins/agentic-sdlc/scripts/meter.mjs
# ~/.claude is $CLAUDE_CONFIG_DIR when that is set. If none resolves, the hook
# notes it on stderr (visible under `claude --debug`) and records nothing.

set -uo pipefail

command -v node >/dev/null 2>&1 || exit 0

input="$(cat)"

read_field() {
  MSG="$input" FIELD="$1" python3 -c 'import json,os,sys
try:
    d=json.loads(os.environ["MSG"])
    v=d.get(os.environ["FIELD"],"")
    sys.stdout.write(str(v) if v is not None else "")
except Exception:
    pass' 2>/dev/null
}

transcript="$(read_field transcript_path)"
session="$(read_field session_id)"
cwd="$(read_field cwd)"
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0
[ -n "$cwd" ] || cwd="$PWD"

# Subagent transcripts, when present, live beside the main one under <session>/subagents/.
subdir="${transcript%.jsonl}/subagents"
sub_arg=()
[ -d "$subdir" ] && sub_arg=(--subagents "$subdir")

# Resolve meter.mjs (order and paths: see the header).
resolve_meter() {
  if [ -n "${METER_MJS:-}" ]; then printf '%s' "$METER_MJS"; return; fi
  local plugins="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins" c d v key=1,1
  # Rank by the version directory alone (not the marketplace name), and by
  # version, not lexically: 0.1.10 beats 0.1.9. `sort -V` is in GNU and recent
  # BSD/macOS sort; plain sort is the last resort.
  printf '' | sort -V >/dev/null 2>&1 && key=1,1V
  c="$(for d in "$plugins"/cache/*/agentic-sdlc/*/; do
         v="${d%/}"; v="${v##*/}"
         [ -f "${d}scripts/meter.mjs" ] && printf '%s\t%s\n' "$v" "${d}scripts/meter.mjs"
       done | sort -t "$(printf '\t')" -k "$key" | tail -n 1 | cut -f 2)"
  if [ -n "$c" ]; then printf '%s' "$c"; return; fi
  for c in "$plugins"/marketplaces/*/plugins/agentic-sdlc/scripts/meter.mjs; do
    [ -f "$c" ] && { printf '%s' "$c"; return; }
  done
}
meter="$(resolve_meter)"
if [ -z "$meter" ] || [ ! -f "$meter" ]; then
  echo "meter.sh: meter.mjs not found (set METER_MJS or install agentic-sdlc) — no cost record written" >&2
  exit 0
fi

node "$meter" record \
  --stream "$transcript" \
  --transcript "$transcript" \
  "${sub_arg[@]}" \
  --label "${session:-run}" \
  --store "$cwd/.agentic-sdlc/meter" >/dev/null 2>&1 || true

exit 0
