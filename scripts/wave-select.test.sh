#!/usr/bin/env bash
#
# wave-select.test.sh — selection must come out the same every time, so each
# rule is pinned against a JSON payload; the script itself never calls gh.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WS="$ROOT/plugins/agentic-sdlc/scripts/wave-select.mjs"

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

# run <payload-json> prints the selector's one JSON line (stdout and stderr)
run() { printf '%s' "$1" | node "$WS" 2>&1; }

check() { # name, payload, expected json line
  local got; got=$(run "$2")
  [ "$got" = "$3" ] && ok "$1" || bad "$1: got '$got', want '$3'"
}

# field <name> <payload> <key> <expected-json> pins one key, so a rule's test
# does not break when another rule adds a sibling key to the output line.
field() {
  local got
  got=$(run "$2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(s)[process.argv[1]]))}catch{console.log(s)}})' "$3")
  [ "$got" = "$4" ] && ok "$1" || bad "$1: got '$got', want '$4'"
}

# A running wave owns the board; selecting on top of it would double-book briefs.
check "an Issue labelled wave:active refuses and names it" \
'{"issues":[{"number":4,"state":"open","labels":["brief"],"body":""},{"number":9,"state":"open","labels":["brief","wave:active"],"body":""}]}' \
'{"ok":false,"error":"wave-active","issues":[9]}'

check "every active Issue is named, in number order" \
'{"issues":[{"number":12,"state":"open","labels":["wave:active"],"body":""},{"number":3,"state":"open","labels":["wave:active"],"body":""}]}' \
'{"ok":false,"error":"wave-active","issues":[3,12]}'

# bodies are JSON strings, so the four lines carry literal \n escapes
brief_body() { printf 'Brief: docs/briefs/x.md\\nLane: standard\\nDepends on: %s\\nConflicts with: —' "$1"; }

# Closing is not finishing: only a completed dependency has delivered its work,
# and a dependency missing from the payload is unknown, so it blocks.
field "a brief is eligible only when every dependency closed as completed" \
'{"issues":[
{"number":1,"state":"open","labels":["brief"],"body":"'"$(brief_body '—')"'"},
{"number":2,"state":"open","labels":["brief"],"body":"'"$(brief_body '#20')"'"},
{"number":3,"state":"open","labels":["brief"],"body":"'"$(brief_body '#21')"'"},
{"number":4,"state":"open","labels":["brief"],"body":"'"$(brief_body '#22')"'"},
{"number":5,"state":"open","labels":["brief"],"body":"'"$(brief_body '#99')"'"},
{"number":6,"state":"open","labels":["brief"],"body":"'"$(brief_body '#20, #21')"'"},
{"number":20,"state":"closed","state_reason":"completed","labels":[],"body":""},
{"number":21,"state":"closed","state_reason":"not_planned","labels":[],"body":""},
{"number":22,"state":"open","labels":[],"body":"","open_pr":true}]}' \
eligible '[1,2]'

# Same payload, same wave: priority label order (from config, unlabelled last),
# then the brief most others wait on, then the older Issue.
cbody() { printf 'Brief: docs/briefs/x.md\\nLane: standard\\nDepends on: %s\\nConflicts with: %s' "$1" "$2"; }
PL='"priority_labels":["priority:P0","priority:P1","priority:P2","priority:P3"]'
sel_issues() { # $1 = conflicts-with for #10, $2 = conflicts-with for #12
  printf '{%s,"issues":[
{"number":10,"state":"open","labels":["brief","priority:P1"],"body":"%s"},
{"number":11,"state":"open","labels":["brief","priority:P1"],"body":"%s"},
{"number":12,"state":"open","labels":["brief","priority:P0"],"body":"%s"},
{"number":13,"state":"open","labels":["brief"],"body":"%s"},
{"number":14,"state":"open","labels":["brief","priority:P1"],"body":"%s"},
{"number":30,"state":"open","labels":["brief","priority:P0"],"body":"%s"},
{"number":31,"state":"open","labels":["brief","priority:P0"],"body":"%s"}]}' \
    "$PL" "$(cbody '—' "$1")" "$(cbody '—' '—')" "$(cbody '—' "$2")" "$(cbody '—' '—')" "$(cbody '—' '—')" \
    "$(cbody '#11' '—')" "$(cbody '#11' '—')"
}
field "selection sorts by priority, then dependents count, then number" \
"$(sel_issues '—' '—')" selected '[12,11,10,14,13]'

# A declaration on either side means the pair must not share a wave.
field "a conflict declared in either direction skips the later brief" \
"$(sel_issues '#11' '#13')" selected '[12,11,14]'

# A plan means planning is done; an open PR means build is too, so the PR's
# CI evidence says where the brief really stands and wins over the plan.
pbody() { cbody '—' '—'; }
field "start phase: plan file -> build, open PR -> its evidence phase, else plan" \
'{"issues":[
{"number":1,"state":"open","labels":["brief"],"body":"'"$(pbody)"'"},
{"number":2,"state":"open","labels":["brief"],"plan":true,"body":"'"$(pbody)"'"},
{"number":3,"state":"open","labels":["brief"],"plan":true,"open_pr":{"check_runs":[{"name":"t","status":"in_progress"}]},"body":"'"$(pbody)"'"},
{"number":4,"state":"open","labels":["brief"],"open_pr":{"check_runs":[{"name":"t","status":"completed","conclusion":"failure"}]},"body":"'"$(pbody)"'"},
{"number":5,"state":"open","labels":["brief"],"open_pr":{"check_runs":[{"name":"t","status":"completed","conclusion":"success"}]},"body":"'"$(pbody)"'"}]}' \
phases '{"1":"plan","2":"build","3":"ci","4":"revise","5":"ci"}'

# Raw REST shape: label objects, PRs mixed in. A PR must never be selected.
field "raw REST label objects count, and PR entries are dropped" \
'{"issues":[
{"number":1,"state":"open","labels":[{"name":"brief"}],"body":"'"$(pbody)"'"},
{"number":2,"state":"open","labels":[{"name":"brief"}],"pull_request":{},"body":"'"$(pbody)"'"}]}' \
selected '[1]'

check "a raw-shaped active label refuses" \
'{"issues":[{"number":9,"state":"open","labels":[{"name":"wave:active"}],"body":""}]}' \
'{"ok":false,"error":"wave-active","issues":[9]}'

exit $fail
