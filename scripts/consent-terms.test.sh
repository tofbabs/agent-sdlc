#!/usr/bin/env bash
#
# consent-terms.test.sh — a stored yes is tied to the TERMS it was given under;
# a report-schema bump alone never re-asks.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S="$ROOT/plugins/agentic-sdlc/scripts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  \xe2\x9c\x93 %s\n' "$*"; }
bad() { printf '  \xe2\x9c\x97 %s\n' "$*" >&2; fail=1; }
check() { [ "$2" = "$3" ] && ok "$1" || bad "$1 — got: $2, want: $3"; }

proj() { mkdir -p "$TMP/$1/.claude"; echo "$TMP/$1"; }
get() { node "$S/consent.mjs" get --cwd "$1"; }
cfg() { echo "$1/.claude/agentic-sdlc.json"; }

echo "terms gate the stored yes"
P=$(proj stale); echo '{"telemetry":{"share":true,"terms":0}}' > "$(cfg "$P")"
check "terms below current reads unanswered" "$(get "$P")" "share=unanswered"
check "a stale yes is not deleted" "$(cat "$(cfg "$P")")" '{"telemetry":{"share":true,"terms":0}}'

P=$(proj missing); echo '{"telemetry":{"share":true}}' > "$(cfg "$P")"
check "true with no terms reads unanswered" "$(get "$P")" "share=unanswered"

P=$(proj current); echo '{"telemetry":{"share":true,"terms":1}}' > "$(cfg "$P")"
check "current terms reads true" "$(get "$P")" "share=true"

P=$(proj sticky); echo '{"telemetry":{"share":false}}' > "$(cfg "$P")"
check "a decline is never re-asked" "$(get "$P")" "share=false"

echo "set records the terms"
P=$(proj set)
node "$S/consent.mjs" set true --cwd "$P"
want=$(node --input-type=module -e "import {TERMS} from '$S/run-report-categories.mjs'; process.stdout.write(String(TERMS))")
check "set true writes the current TERMS" \
  "$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$(cfg "$P")','utf8')).telemetry.terms))")" "$want"
P=$(proj setfalse)
node "$S/consent.mjs" set false --cwd "$P"
check "set false writes no terms" \
  "$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$(cfg "$P")','utf8')).telemetry.terms))")" "undefined"

echo "a schema bump leaves consent unchanged"
P=$(proj schema); echo '{"schema":1,"telemetry":{"share":true,"terms":1}}' > "$(cfg "$P")"
before=$(get "$P")
sed 's/"schema":1/"schema":2/' "$(cfg "$P")" > "$(cfg "$P").n" && mv "$(cfg "$P").n" "$(cfg "$P")"
check "schema 1 to 2 does not change the answer" "$(get "$P")" "$before"
check "and it is still true" "$(get "$P")" "share=true"

echo "PATTERNS and TERMS move together"
out=$(node --input-type=module -e "
import {PATTERNS, TERMS, TERMS_PATTERNS} from '$S/run-report-categories.mjs';
const same = JSON.stringify(Object.keys(PATTERNS)) === JSON.stringify(TERMS_PATTERNS);
const pinned = TERMS === 1 && JSON.stringify(TERMS_PATTERNS) === JSON.stringify(['uuid_v4','semver','iso_utc_seconds','decision_id']);
process.stdout.write(same + ' ' + pinned);
")
check "PATTERNS keys equal the terms list" "${out% *}" "true"
check "pinned {TERMS, list}: change both with a bump" "${out#* }" "true"

exit $fail
