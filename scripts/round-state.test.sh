#!/usr/bin/env bash
#
# round-state.test.sh — the previous review round's number, verdict and
# reviewed sha, read from the comment body and never from GitHub review state
# (a PR author's own review is stored as COMMENTED).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S="$ROOT/plugins/agentic-sdlc/scripts/round-state.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  \xe2\x9c\x93 %s\n' "$*"; }
bad() { printf '  \xe2\x9c\x97 %s\n' "$*" >&2; fail=1; }
check() { [ "$2" = "$3" ] && ok "$1" || bad "$1 — got: $2, want: $3" ; }

SHA1=1111111111111111111111111111111111111111
SHA2=2222222222222222222222222222222222222222

field() { node -e 'const o=JSON.parse(process.argv[1]);console.log(String(o[process.argv[2]]))' "$1" "$2"; }

# body NUM VERDICT SHA -> a round comment body as the reviewer posts it
body() { printf '## Review — round %s\n- verdict: %s\n- reviewed sha: %s\n\n- F1: MINOR [style] NON-BLOCKING — nit\n' "$1" "$2" "$3"; }

write_json() { node -e 'console.log(JSON.stringify(JSON.parse(process.argv[1])))' "$2" > "$1"; }

mk() { # file, then bodies as JSON-quoted args
  node -e 'console.log(JSON.stringify(process.argv.slice(1).map(b=>({body:b,state:"COMMENTED",user:{login:"me"}}))))' "${@:2}" > "$1"
}

echo '[]' > "$TMP/none.json"

# --- round 1 comment, no reviews -------------------------------------------
mk "$TMP/c1.json" "$(body 1 APPROVE $SHA1)"
out=$(node "$S" --reviews "$TMP/none.json" --comments "$TMP/c1.json")
check "round read from issue comment" "$(field "$out" round)" 1
check "verdict read from body" "$(field "$out" verdict)" APPROVE
check "sha read from body" "$(field "$out" sha)" "$SHA1"
check "no response yet" "$(field "$out" response)" false

# --- no rounds at all -------------------------------------------------------
out=$(node "$S" --reviews "$TMP/none.json" --comments "$TMP/none.json")
check "no round reports 0" "$(field "$out" round)" 0

# --- AC4: author's own review is stored COMMENTED; the body still decides ----
mk "$TMP/c1b.json" "$(body 1 REQUEST_CHANGES $SHA1)"
mk "$TMP/r2.json" "$(body 2 APPROVE $SHA2)"
out=$(node "$S" --reviews "$TMP/r2.json" --comments "$TMP/c1b.json")
check "newest round wins across reviews and comments" "$(field "$out" round)" 2
check "COMMENTED review with APPROVE body reads APPROVE" "$(field "$out" verdict)" APPROVE
check "sha of the newest round" "$(field "$out" sha)" "$SHA2"

# --- review state is only a fallback when the body has no verdict line -------
printf '%s' '[{"body":"## Review — round 1\n- reviewed sha: '$SHA1'\n","state":"CHANGES_REQUESTED"}]' > "$TMP/fb.json"
out=$(node "$S" --reviews "$TMP/fb.json" --comments "$TMP/none.json")
check "verdictless body falls back to CHANGES_REQUESTED state" "$(field "$out" verdict)" REQUEST_CHANGES
printf '%s' '[{"body":"## Review — round 1\n- reviewed sha: '$SHA1'\n","state":"COMMENTED"}]' > "$TMP/fb2.json"
out=$(node "$S" --reviews "$TMP/fb2.json" --comments "$TMP/none.json")
check "verdictless COMMENTED body has no verdict to fall back on" "$(field "$out" verdict)" ""

# --- a coder response counts only for the newest round ----------------------
mk "$TMP/resp.json" "$(body 1 REQUEST_CHANGES $SHA1)" "$(printf '## Response — round 1\n- F1: fixed\n')"
out=$(node "$S" --reviews "$TMP/none.json" --comments "$TMP/resp.json")
check "response to the newest round is detected" "$(field "$out" response)" true
mk "$TMP/resp2.json" "$(body 1 REQUEST_CHANGES $SHA1)" "$(printf '## Response — round 1\n- F1: fixed\n')" "$(body 2 REQUEST_CHANGES $SHA2)"
out=$(node "$S" --reviews "$TMP/none.json" --comments "$TMP/resp2.json")
check "response to an older round does not count" "$(field "$out" response)" false

exit $fail
