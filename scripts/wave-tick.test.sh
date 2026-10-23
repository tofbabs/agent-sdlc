#!/usr/bin/env bash
#
# wave-tick.test.sh — a tick must decide the same label, board and notice
# changes for the same evidence, so each rule is pinned against a JSON payload;
# the script itself never calls gh.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="$ROOT/plugins/agentic-sdlc/scripts/wave-tick.mjs"

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

run() { printf '%s' "$1" | node "$WT" 2>&1; }

# pick <name> <payload> <key> <expected-json> pins one top-level key, so a
# rule's test does not break when another rule adds a sibling key.
pick() {
  local got
  got=$(run "$2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(s)[process.argv[1]]??null))}catch{console.log(s)}})' "$3")
  [ "$got" = "$4" ] && ok "$1" || bad "$1: got '$got', want '$4'"
}

NOW='2026-01-02T12:00:00Z'
# wave <briefs-json> wraps briefs with the wave identity every payload needs.
wave() { printf '{"wave":3,"epic":100,"now":"%s","briefs":[%s]}' "$NOW" "$1"; }

# Each label call costs API quota and an event on the Issue, so an unchanged
# wave must make none.
pick "an unchanged phase makes no label call" \
"$(wave '{"number":7,"phase":"ci","labels":["brief","wave:3","phase:ci"],"since":"2026-01-02T10:00:00Z"}')" \
label_changes '[]'

pick "a changed phase swaps only the phase label" \
"$(wave '{"number":7,"phase":"awaiting-merge","labels":["brief","wave:3","phase:ci"],"since":"2026-01-02T10:00:00Z"}')" \
label_changes '[{"issue":7,"add":["phase:awaiting-merge"],"remove":["phase:ci"]}]'

pick "a brief with no phase label only gains one" \
"$(wave '{"number":7,"phase":"plan","labels":["brief","wave:3"],"since":"2026-01-02T10:00:00Z"}')" \
label_changes '[{"issue":7,"add":["phase:plan"],"remove":[]}]'

# A reset clock on an unchanged phase would hide a stall from the board, and a
# kept clock on a changed phase would overstate how long it has sat there.
pick "the board resets since only for briefs whose phase changed" \
"$(wave '{"number":8,"phase":"awaiting-merge","labels":["brief","wave:3","phase:ci"],"since":"2026-01-02T08:00:00Z"},{"number":7,"phase":"ci","pr":21,"labels":["brief","wave:3","phase:ci"],"since":"2026-01-02T10:00:00Z"}')" \
board '"<!-- wave-board:3 -->\n## Wave 3 (epic #100)\n\n| Brief | Phase | PR | In phase |\n| --- | --- | --- | --- |\n| #7 | ci | #21 | 2h 0m |\n| #8 | awaiting-merge | — | 0m |\n"'

# An epic comment is the record of a stall, so the marker carries the issue,
# phase and entry time that make one stall distinct from the next.
pick "a brief past its stall threshold yields one epic notice" \
"$(wave '{"number":7,"phase":"awaiting-merge","pr":21,"labels":["brief","wave:3","phase:awaiting-merge"],"since":"2026-01-01T11:00:00Z"}')" \
notices '[{"issue":7,"body":"<!-- wave-stall:7 phase=awaiting-merge since=2026-01-01T11:00:00Z -->\nBrief #7 has been in awaiting-merge for 25h 0m."}]'

pick "a brief inside its stall threshold yields no notice" \
"$(wave '{"number":7,"phase":"awaiting-merge","pr":21,"labels":["brief","wave:3","phase:awaiting-merge"],"since":"2026-01-02T11:00:00Z"}')" \
notices '[]'

pick "a stalled revise uses its own shorter threshold" \
"$(wave '{"number":7,"phase":"revise","pr":21,"labels":["brief","wave:3","phase:revise"],"since":"2026-01-02T08:30:00Z"}')" \
notices '[{"issue":7,"body":"<!-- wave-stall:7 phase=revise since=2026-01-02T08:30:00Z -->\nBrief #7 has been in revise for 3h 30m."}]'

# The marker is the only record of a stall, so a second tick must read it back
# instead of commenting again every cycle.
stalled='{"number":7,"phase":"awaiting-merge","pr":21,"labels":["brief","wave:3","phase:awaiting-merge"],"since":"2026-01-01T11:00:00Z"}'
pick "a stall whose marker is already on the epic yields no notice" \
"$(printf '{"wave":3,"epic":100,"now":"%s","epic_comments":["<!-- wave-stall:7 phase=awaiting-merge since=2026-01-01T11:00:00Z -->"],"briefs":[%s]}' "$NOW" "$stalled")" \
notices '[]'

# A brief that left the phase and came back is a new stall and deserves a new comment.
pick "a marker for an earlier since does not suppress a later stall" \
"$(printf '{"wave":3,"epic":100,"now":"%s","epic_comments":["<!-- wave-stall:7 phase=awaiting-merge since=2025-12-30T00:00:00Z -->"],"briefs":[%s]}' "$NOW" "$stalled")" \
notices '[{"issue":7,"body":"<!-- wave-stall:7 phase=awaiting-merge since=2026-01-01T11:00:00Z -->\nBrief #7 has been in awaiting-merge for 25h 0m."}]'

# An unreviewed head waits on the reviewer, not a human, so it stalls sooner than a merge.
pick "an open PR stuck in ci uses the 2h unreviewed threshold" \
"$(wave '{"number":7,"phase":"ci","pr":21,"labels":["brief","wave:3","phase:ci"],"since":"2026-01-02T09:30:00Z"}')" \
notices '[{"issue":7,"body":"<!-- wave-stall:7 phase=ci since=2026-01-02T09:30:00Z -->\nBrief #7 has been in ci for 2h 30m."}]'

# Config owns the thresholds; a project that waits longer must not get noise.
pick "stall_thresholds from the payload override the defaults" \
"$(printf '{"wave":3,"epic":100,"now":"%s","stall_thresholds":{"awaiting-merge":48},"briefs":[%s]}' "$NOW" "$stalled")" \
notices '[]'

pick "a phase missing from stall_thresholds keeps its default" \
"$(printf '{"wave":3,"epic":100,"now":"%s","stall_thresholds":{"revise":10},"briefs":[%s]}' "$NOW" "$stalled")" \
notices '[{"issue":7,"body":"<!-- wave-stall:7 phase=awaiting-merge since=2026-01-01T11:00:00Z -->\nBrief #7 has been in awaiting-merge for 25h 0m."}]'

# A pending head is CI still running, not a brief waiting on a reviewer.
pick "a pending ci head is not a stall" \
"$(wave '{"number":7,"phase":"ci","pr":21,"ci_state":"pending","labels":["brief","wave:3","phase:ci"],"since":"2026-01-02T09:30:00Z"}')" \
notices '[]'

# Only an exhausted lock moves a phase; a held or cleared one leaves it alone.
pick "a blocked lock result moves the brief to blocked" \
"$(wave '{"number":7,"phase":"build","lock":{"outcome":"blocked"},"labels":["brief","wave:3","phase:build"],"since":"2026-01-02T10:00:00Z"}')" \
label_changes '[{"issue":7,"add":["phase:blocked"],"remove":["phase:build"]}]'

pick "a held lock result leaves the phase alone" \
"$(wave '{"number":7,"phase":"build","lock":{"outcome":"held"},"labels":["brief","wave:3","phase:build"],"since":"2026-01-02T10:00:00Z"}')" \
label_changes '[]'

# The Issue stays open so the brief returns to the pool; only the wave's labels go.
aband='{"number":7,"phase":"plan","issue_state":"open","pr_state":"closed","labels":["brief","wave:3","phase:plan"],"since":"2026-01-02T10:00:00Z"},{"number":8,"phase":"ci","pr":22,"issue_state":"open","pr_state":"open","labels":["brief","wave:3","phase:ci"],"since":"2026-01-02T10:00:00Z"}'
pick "a brief whose PR closed unmerged loses its wave and phase labels" "$(wave "$aband")" \
label_changes '[{"issue":7,"add":[],"remove":["wave:3","phase:plan"]}]'

pick "a brief whose PR closed unmerged drops off the board" "$(wave "$aband")" \
board '"<!-- wave-board:3 -->\n## Wave 3 (epic #100)\n\n| Brief | Phase | PR | In phase |\n| --- | --- | --- | --- |\n| #8 | ci | #22 | 2h 0m |\n"'

pick "a brief with an open PR is not dropped even after an earlier PR closed" \
"$(wave '{"number":7,"phase":"ci","pr":23,"issue_state":"open","pr_state":"open","labels":["brief","wave:3","phase:ci"],"since":"2026-01-02T10:00:00Z"}')" \
dropped '[]'

# Merged or closed-for-any-reason is delivered or deliberately abandoned.
pick "a wave whose briefs are all merged or closed closes" \
"$(wave '{"number":7,"phase":"done","issue_state":"closed","pr_state":"merged","labels":["brief","wave:3","phase:done"],"since":"2026-01-02T10:00:00Z"},{"number":8,"phase":"done","issue_state":"closed","labels":["brief","wave:3","phase:done"],"since":"2026-01-02T10:00:00Z"}')" \
close '{"epic":100,"remove":["wave:active"],"start":true}'

# ARCH-3: an open Issue with no merged PR is unfinished, however stuck.
pick "a blocked brief with an open Issue keeps the wave open" \
"$(wave '{"number":7,"phase":"done","issue_state":"closed","pr_state":"merged","labels":["brief","wave:3","phase:done"],"since":"2026-01-02T10:00:00Z"},{"number":8,"phase":"blocked","issue_state":"open","labels":["brief","wave:3","phase:blocked"],"since":"2026-01-02T10:00:00Z"}')" \
close 'null'

pick "an empty payload never closes the wave" "$(wave '')" close 'null'

exit $fail
