#!/usr/bin/env bash
#
# config.test.sh — config.mjs is the only reader of .claude/agentic-sdlc.json:
# defaults when absent, loud failure on bad input, warning on unknown keys, and
# coexistence with the telemetry key consent.mjs writes into the same file.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S="$ROOT/plugins/agentic-sdlc/scripts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  \xe2\x9c\x93 %s\n' "$*"; }
bad() { printf '  \xe2\x9c\x97 %s\n' "$*" >&2; fail=1; }
check() { [ "$2" = "$3" ] && ok "$1" || bad "$1 — got: $2, want: $3"; }

# proj <name> [json]: a project dir, with the config file only if json is given.
proj() {
  mkdir -p "$TMP/$1/.claude"
  [ $# -ge 2 ] && printf '%s' "$2" > "$TMP/$1/.claude/agentic-sdlc.json"
  echo "$TMP/$1"
}
get() { node "$S/config.mjs" get "$2" --cwd "$1" 2>"$TMP/err"; }

P=$(proj missing)
check "missing file: default cap is 3" "$(get "$P" review.round_cap)" "3"

P=$(proj valid '{"schema":1,"review":{"round_cap":2}}')
check "valid file: configured cap wins" "$(get "$P" review.round_cap)" "2"

P=$(proj empty '{"schema":1}')
check "key absent: default applies" "$(get "$P" review.round_cap)" "3"

P=$(proj badjson '{not json')
out=$(get "$P" review.round_cap); rc=$?
[ "$rc" -ne 0 ] && [ -z "$out" ] && ok "bad JSON exits non-zero with no value" || bad "bad JSON: rc=$rc out=$out"

for v in '"3"' '0' '-1' '2.5' 'null'; do
  P=$(proj "type$RANDOM" "{\"schema\":1,\"review\":{\"round_cap\":$v}}")
  out=$(get "$P" review.round_cap); rc=$?
  [ "$rc" -ne 0 ] && [ -z "$out" ] && grep -q 'review.round_cap' "$TMP/err" \
    && ok "round_cap=$v rejected, names the key" || bad "round_cap=$v: rc=$rc out=$out"
done

P=$(proj unknown '{"schema":1,"review":{"round_cap":2,"mystery":1},"extra":true}')
out=$(get "$P" review.round_cap); rc=$?
check "unknown keys: value still served" "$out" "2"
[ "$rc" -eq 0 ] && grep -q 'review.mystery' "$TMP/err" && grep -q 'extra' "$TMP/err" \
  && ok "unknown keys warn on stderr and exit 0" || bad "unknown keys: rc=$rc err=$(cat "$TMP/err")"

P=$(proj schema2 '{"schema":2,"review":{"round_cap":2}}')
out=$(get "$P" review.round_cap); rc=$?
[ "$rc" -ne 0 ] && [ -z "$out" ] && grep -q schema "$TMP/err" && ok "schema other than 1 fails" || bad "schema 2: rc=$rc out=$out"

P=$(proj unkkey)
get "$P" review.nope >/dev/null; rc=$?
[ "$rc" -ne 0 ] && ok "asking for an unknown key fails" || bad "unknown get key exited 0"

echo "coexistence with consent.mjs"
P=$(proj consent)
node "$S/consent.mjs" set true --cwd "$P"
out=$(get "$P" review.round_cap); rc=$?
[ "$rc" -eq 0 ] && [ "$out" = "3" ] && [ ! -s "$TMP/err" ] && ok "consent-written file: defaults, no warning" || bad "consent file: rc=$rc out=$out err=$(cat "$TMP/err")"
P=$(proj both '{"schema":1,"review":{"round_cap":4},"telemetry":{"share":false}}')
check "telemetry key beside config: cap read" "$(get "$P" review.round_cap)" "4"
[ ! -s "$TMP/err" ] && ok "telemetry key does not warn" || bad "telemetry warned: $(cat "$TMP/err")"
node "$S/consent.mjs" set true --cwd "$P"
check "consent set keeps the cap" "$(get "$P" review.round_cap)" "4"
check "config does not disturb consent get" "$(node "$S/consent.mjs" get --cwd "$P")" "share=true"

[ "$fail" -eq 0 ] && echo "config: all checks passed" || { echo "config: FAILED" >&2; exit 1; }
