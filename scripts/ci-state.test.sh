#!/usr/bin/env bash
#
# ci-state.test.sh — the gate that stops /review spending a round on a head
# whose CI is unfinished or red. Fixtures are trimmed REST check-runs payloads.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CS="$ROOT/plugins/agentic-sdlc/scripts/ci-state.mjs"
FX="$ROOT/scripts/fixtures/ci-state"

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

check() { # fixture, expected json line
  local got; got=$(node "$CS" "$FX/$1.json" 2>&1)
  [ "$got" = "$2" ] && ok "$1" || bad "$1: got '$got', want '$2'"
}

check green   '{"state":"green","failing":[],"pending":[]}'
check pending '{"state":"pending","failing":[],"pending":["test","q"]}'
check red     '{"state":"red","failing":["test"],"pending":[]}'
check red-and-pending '{"state":"red","failing":["test"],"pending":["slow"]}'
check none    '{"state":"none","failing":[],"pending":[]}'
for c in failure timed_out cancelled action_required startup_failure; do
  check "fail-$c" "{\"state\":\"red\",\"failing\":[\"job-$c\"],\"pending\":[]}"
done

got=$(node "$CS" < "$FX/red.json")
[ "$got" = '{"state":"red","failing":["test"],"pending":[]}' ] && ok "reads stdin" || bad "stdin: '$got'"

echo 'not json' | node "$CS" >/dev/null 2>&1; [ $? -eq 2 ] && ok "bad input exits 2" || bad "bad input should exit 2"

exit $fail
