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
# project settings, so the meter.mjs path is resolved from the installed plugin at
# a fixed location or passed via METER_MJS.

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

# Resolve meter.mjs: explicit override, else the conventional installed location.
meter="${METER_MJS:-$HOME/.claude/plugins/agentic-sdlc/scripts/meter.mjs}"
[ -f "$meter" ] || exit 0

node "$meter" record \
  --stream "$transcript" \
  --transcript "$transcript" \
  "${sub_arg[@]}" \
  --label "${session:-run}" \
  --store "$cwd/.agentic-sdlc/meter" >/dev/null 2>&1 || true

exit 0
