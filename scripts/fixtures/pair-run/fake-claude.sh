#!/usr/bin/env bash
# Stand-in for `claude -p` in pair-run.test.sh. Plays both roles through the real
# pair-log.mjs, driven by FAKE_* env vars, and prints the CLI's JSON result shape.
set -u
argv=("$@")
role=""; prompt=""
while [ $# -gt 0 ]; do
  case "$1" in
    --agent) role="${2#agentic-sdlc:}"; shift 2 ;;
    -p) prompt="$2"; shift 2 ;;
    --model) [ -n "${FAKE_MODEL_LOG:-}" ] && echo "$role $2" >> "$FAKE_MODEL_LOG"; shift 2 ;;
    *) shift ;;
  esac
done
# Records the exact argv a turn was spawned with, one call per file, so the test
# can assert on grant shape without re-parsing claude's own stdout.
if [ -n "${FAKE_ARGV_LOG:-}" ]; then
  {
    printf '=== %s\n' "$role"
    for a in "${argv[@]}"; do printf '%s\n' "$a"; done
  } >> "$FAKE_ARGV_LOG"
fi
PL="$CLAUDE_PLUGIN_ROOT/scripts/pair-log.mjs"
story=$(printf '%s' "$prompt" | grep -o 'STORY-[A-Z0-9-]*' | head -1)
alt=$(node "$PL" status "$story" | sed -E 's/.*alternation=([0-9]+).*/\1/')

if [ "$role" = driver ] && [ -n "${FAKE_FAIL_DRIVER_ONCE:-}" ] && [ ! -f "$FAKE_FAIL_DRIVER_ONCE" ]; then
  touch "$FAKE_FAIL_DRIVER_ONCE"
  echo '{"is_error":true,"result":"usage limit reached","total_cost_usd":0}'; exit 1
fi
if [ "$role" = driver ] && [ -n "${FAKE_DRIVER_SILENT:-}" ]; then
  echo '{"is_error":false,"result":"did nothing","total_cost_usd":0.1}'; exit 0
fi
if [ "$role" = navigator ] && [ "$alt" -ge "${FAKE_COMPLETE_AT:-2}" ]; then
  echo "- review: OK; closed" | node "$PL" append "$story" --role navigator >/dev/null
  node "$PL" session "$story" --set complete >/dev/null
  echo '{"is_error":false,"result":"title: Ward save\nscopes: web","total_cost_usd":0.5,"num_turns":4}'; exit 0
fi
if [ "$role" = navigator ] && [ -n "${FAKE_BLOCK:-}" ]; then
  node "$PL" session "$story" --set blocked --arch ARCH-9 >/dev/null
  echo "- blocked" | node "$PL" append "$story" --role navigator >/dev/null
  echo '{"is_error":false,"result":"blocked","total_cost_usd":0.5}'; exit 0
fi
rej=""
[ "$role" = navigator ] && [ -n "${FAKE_REJECT:-}" ] && rej="--rejected"
echo "- turn by $role" | node "$PL" append "$story" --role "$role" $rej >/dev/null
if [ "$role" = driver ] && [ -n "${FAKE_DENIAL:-}" ]; then
  echo '{"is_error":false,"result":"ok","total_cost_usd":0.25,"num_turns":3,"permission_denials":[{"tool_name":"Bash","tool_use_id":"tu_1","tool_input":{"command":"rm -rf /secret-payload"}}]}'
  exit 0
fi
echo '{"is_error":false,"result":"ok","total_cost_usd":0.25,"num_turns":3}'
