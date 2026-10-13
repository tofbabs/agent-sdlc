#!/usr/bin/env bash
#
# wave-select-report.test.sh — an empty selection must say whether the backlog
# is done or stuck, and name what blocks each brief when stuck.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WS="$ROOT/plugins/agentic-sdlc/scripts/wave-select.mjs"

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

message() { printf '%s' "$1" | node "$WS" 2>&1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).message??"")}catch{console.log(s)}})'; }

has() { # name, payload, needle
  local got; got=$(message "$2")
  case "$got" in *"$3"*) ok "$1" ;; *) bad "$1: '$3' not in '$got'" ;; esac
}
lacks() {
  local got; got=$(message "$2")
  case "$got" in *"$3"*) bad "$1: '$3' unexpectedly in '$got'" ;; *) ok "$1" ;; esac
}

body() { printf 'Brief: docs/briefs/x.md\\nLane: standard\\nDepends on: %s\\nConflicts with: —' "$1"; }

EMPTY='{"issues":[{"number":20,"state":"closed","state_reason":"completed","labels":[],"body":""}]}'
has "no open brief issues -> backlog exhausted" "$EMPTY" "backlog exhausted"

STUCK='{"issues":[
{"number":2,"state":"open","labels":["brief"],"body":"'"$(body '#20')"'"},
{"number":3,"state":"open","labels":["brief"],"body":"'"$(body '#99')"'"},
{"number":4,"state":"open","labels":["brief"],"body":"garbage"}]}'
has "blocked pool -> cannot continue" "$STUCK" "cannot continue"
has "names the unmet dependency of #2" "$STUCK" "#2: unmet dependency #20"
has "names a dependency missing from the payload" "$STUCK" "#3: unmet dependency #99"
has "names an unparseable body" "$STUCK" "#4: invalid brief body"
lacks "a stuck pool is not exhausted" "$STUCK" "backlog exhausted"

OK='{"issues":[{"number":1,"state":"open","labels":["brief"],"body":"'"$(body '—')"'"}]}'
lacks "a selection carries no report" "$OK" "cannot continue"
lacks "a selection is not exhausted" "$OK" "backlog exhausted"

exit $fail
