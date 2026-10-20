#!/usr/bin/env bash
#
# wave-classify.test.sh — a brief's phase must come out the same for the same
# GitHub evidence, so each rule is pinned against a JSON payload; the script
# itself never calls gh.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WC="$ROOT/plugins/agentic-sdlc/scripts/wave-classify.mjs"

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

# run <payload-json> prints the classifier's one JSON line (stdout and stderr)
run() { printf '%s' "$1" | node "$WC" 2>&1; }

# pick <name> <payload> <key> <expected-json> pins one key of the first brief,
# so a rule's test does not break when another rule adds a sibling key.
pick() {
  local got
  got=$(run "$2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(s).briefs[0][process.argv[1]]??null))}catch{console.log(s)}})' "$3")
  [ "$got" = "$4" ] && ok "$1" || bad "$1: got '$got', want '$4'"
}

# brief <extra-json-members> builds a one-brief payload; evidence members are
# passed per test so each fixture shows only the facts its rule reads.
brief() { printf '{"round_cap":3,"briefs":[{"number":7,%s}]}' "$1"; }

RED='"check_runs":{"check_runs":[{"name":"lint","status":"completed","conclusion":"failure"}]}'

# A merged PR is delivered work; nothing after it can reopen the question.
pick "a merged PR is done" \
"$(brief '"issue_state":"open","pr":{"state":"closed","merged":true,"head_sha":"abc"}')" \
phase '"done"'

pick "a closed Issue is done, whatever the reason" \
"$(brief '"issue_state":"closed","plan":true')" \
phase '"done"'

# Red CI on a merged PR is history, so it must not ask for a CI-failure comment.
pick "done wins over red CI" \
"$(brief '"issue_state":"closed","pr":{"state":"closed","merged":true,"head_sha":"abc",'"$RED"'}')" \
phase '"done"'

pick "a done brief carries no ci_failure flag" \
"$(brief '"issue_state":"closed","pr":{"state":"closed","merged":true,"head_sha":"abc",'"$RED"'}')" \
ci_failure 'null'

# The command posts the one CI-failure comment, so the script only reports the
# names it needs; posting from here would break the pure-over-payload contract.
OPEN_RED='"issue_state":"open","plan":true,"pr":{"state":"open","merged":false,"head_sha":"abc",'"$RED"'}'

pick "red CI on an open PR is revise" "$(brief "$OPEN_RED")" phase '"revise"'
pick "red CI sets ci_failure" "$(brief "$OPEN_RED")" ci_failure 'true'
pick "red CI names the failing checks" "$(brief "$OPEN_RED")" failing_checks '["lint"]'

# The cap stops an endless review loop; a round at the cap still gets its revise.
OVER_CAP='"issue_state":"open","plan":true,"pr":{"state":"open","merged":false,"head_sha":"abc"},"round":{"round":4,"verdict":"REQUEST_CHANGES","sha":"abc","response":true}'
AT_CAP='"issue_state":"open","plan":true,"pr":{"state":"open","merged":false,"head_sha":"abc"},"round":{"round":3,"verdict":"REQUEST_CHANGES","sha":"abc","response":true}'

pick "an unapproved round past round_cap is blocked" "$(brief "$OVER_CAP")" phase '"blocked"'
pick "a round at round_cap is not blocked" "$(brief "$AT_CAP")" phase '"ci"'

# Findings nobody answered yet are the revise trigger; an answered round waits for re-review.
UNANSWERED='"issue_state":"open","plan":true,"pr":{"state":"open","merged":false,"head_sha":"abc"},"round":{"round":1,"verdict":"REQUEST_CHANGES","sha":"abc","response":false}'
ANSWERED='"issue_state":"open","plan":true,"pr":{"state":"open","merged":false,"head_sha":"abc"},"round":{"round":1,"verdict":"REQUEST_CHANGES","sha":"abc","response":true}'

pick "REQUEST_CHANGES with no Response is revise" "$(brief "$UNANSWERED")" phase '"revise"'
pick "REQUEST_CHANGES with a Response is not revise" "$(brief "$ANSWERED")" phase '"ci"'
pick "revise from findings is not a CI failure" "$(brief "$UNANSWERED")" ci_failure 'null'

# Approval only counts for the commit it reviewed, and only with green CI behind it.
GREEN='"check_runs":{"check_runs":[{"name":"lint","status":"completed","conclusion":"success"}]}'
APPROVED='"issue_state":"open","plan":true,"pr":{"state":"open","merged":false,"head_sha":"abc",'"$GREEN"'},"round":{"round":1,"verdict":"APPROVE","sha":"abc","response":false}'

pick "approved on the head sha with green CI is awaiting-merge" "$(brief "$APPROVED")" phase '"awaiting-merge"'

# An approval for an older commit says nothing about the code now on the branch.
STALE='"issue_state":"open","plan":true,"pr":{"state":"open","merged":false,"head_sha":"def",'"$GREEN"'},"round":{"round":1,"verdict":"APPROVE","sha":"abc","response":false}'
pick "approval on a stale sha falls through to ci" "$(brief "$STALE")" phase '"ci"'

# Approval without green CI is not mergeable yet.
PENDING='"check_runs":{"check_runs":[{"name":"lint","status":"in_progress","conclusion":null}]}'
pick "approved with pending CI is ci" \
"$(brief '"issue_state":"open","pr":{"state":"open","merged":false,"head_sha":"abc",'"$PENDING"'},"round":{"round":1,"verdict":"APPROVE","sha":"abc","response":false}')" \
phase '"ci"'

pick "an open PR with no review yet is ci" \
"$(brief '"issue_state":"open","plan":true,"pr":{"state":"open","merged":false,"head_sha":"abc",'"$GREEN"'}')" \
phase '"ci"'

pick "a plan with no PR is build" "$(brief '"issue_state":"open","plan":true')" phase '"build"'
pick "no plan and no PR is plan" "$(brief '"issue_state":"open","plan":false')" phase '"plan"'

# Two rules match in each fixture; the earlier one must win.
pick "red CI beats a past-cap round" \
"$(brief '"issue_state":"open","plan":true,"pr":{"state":"open","merged":false,"head_sha":"abc",'"$RED"'},"round":{"round":4,"verdict":"REQUEST_CHANGES","sha":"abc","response":false}')" \
phase '"revise"'
pick "blocked beats unanswered REQUEST_CHANGES" \
"$(brief '"issue_state":"open","plan":true,"pr":{"state":"open","merged":false,"head_sha":"abc"},"round":{"round":4,"verdict":"REQUEST_CHANGES","sha":"abc","response":false}')" \
phase '"blocked"'
pick "unanswered REQUEST_CHANGES beats ci" "$(brief "$UNANSWERED")" phase '"revise"'
pick "awaiting-merge beats ci" "$(brief "$APPROVED")" phase '"awaiting-merge"'
pick "ci beats build" "$(brief '"issue_state":"open","plan":true,"pr":{"state":"open","merged":false,"head_sha":"abc"}')" phase '"ci"'

[ "$fail" = 0 ] && echo "wave-classify: all checks passed"
exit "$fail"
