#!/usr/bin/env bash
#
# consent.test.sh — the checked-in telemetry consent answer: read it, write it,
# never fail a session over it. Fixture-based: each case gets its own project dir.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S="$ROOT/plugins/agentic-sdlc/scripts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  \xe2\x9c\x93 %s\n' "$*"; }
bad() { printf '  \xe2\x9c\x97 %s\n' "$*" >&2; fail=1; }
check() { [ "$2" = "$3" ] && ok "$1" || bad "$1 — got: $2, want: $3"; }

proj() { mkdir -p "$TMP/$1"; echo "$TMP/$1"; }
get() { node "$S/consent.mjs" get --cwd "$1"; }
cfg() { echo "$1/.claude/agentic-sdlc.json"; }

echo "consent get (AC1, AC2)"
P=$(proj fresh)
check "no config file reads unanswered" "$(get "$P")" "share=unanswered"

P=$(proj nokey); mkdir -p "$P/.claude"; echo '{"other":1}' > "$(cfg "$P")"
check "config without a telemetry key reads unanswered" "$(get "$P")" "share=unanswered"

P=$(proj malformed); mkdir -p "$P/.claude"; echo '{not json' > "$(cfg "$P")"
out=$(get "$P"); rc=$?
check "malformed config reads unanswered" "$out" "share=unanswered"
check "malformed config still exits 0" "$rc" "0"

P=$(proj nonbool); mkdir -p "$P/.claude"; echo '{"telemetry":{"share":"yes"}}' > "$(cfg "$P")"
check "a non-boolean share value reads unanswered" "$(get "$P")" "share=unanswered"

P=$(proj stored); mkdir -p "$P/.claude"; echo '{"telemetry":{"share":false}}' > "$(cfg "$P")"
check "a stored false is read as-is" "$(get "$P")" "share=false"

echo "consent set (AC1)"
P=$(proj settrue)
node "$S/consent.mjs" set true --cwd "$P"; rc=$?
check "set true exits 0" "$rc" "0"
check "set true is read back" "$(get "$P")" "share=true"
check "the answer lands in the checked-in config" \
  "$(node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync('$(cfg "$P")','utf8')).telemetry))")" '{"share":true,"terms":1}'
[ ! -e "$P/.claude/settings.local.json" ] && ok "settings.local.json is never created" || bad "settings.local.json was written"

P=$(proj preserve); mkdir -p "$P/.claude"
echo '{"keep":{"a":1},"telemetry":{"terms":2,"share":true}}' > "$(cfg "$P")"
node "$S/consent.mjs" set false --cwd "$P"
check "set false flips the answer" "$(get "$P")" "share=false"
check "set preserves other top-level keys" \
  "$(node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync('$(cfg "$P")','utf8')).keep))")" '{"a":1}'
check "set preserves sibling telemetry keys" \
  "$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$(cfg "$P")','utf8')).telemetry.terms))")" '2'

P=$(proj badarg)
node "$S/consent.mjs" set maybe --cwd "$P" 2>/dev/null; rc=$?
[ "$rc" != 0 ] && ok "set rejects a value that is not true or false" || bad "set accepted 'maybe'"
check "a rejected set writes nothing" "$([ -e "$(cfg "$P")" ] && echo wrote || echo none)" none

echo "command wiring (AC1, AC2)"
PLUGIN="$ROOT/plugins/agentic-sdlc"
REF="$PLUGIN/reference/consent.md"
[ -f "$REF" ] && ok "the consent protocol lives in reference/consent.md" || bad "reference/consent.md is missing"
for c in plan build; do
  f="$PLUGIN/commands/$c.md"
  n=$(grep -c 'reference/consent.md' "$f")
  check "$c.md points at the consent protocol exactly once" "$n" "1"
done
if [ -f "$REF" ]; then
  grep -q 'consent.mjs get' "$REF" && ok "protocol reads the stored answer first" || bad "protocol never calls consent.mjs get"
  grep -q 'consent.mjs set' "$REF" && ok "protocol records the answer via consent.mjs set" || bad "protocol never calls consent.mjs set"
  grep -q 'AskUserQuestion' "$REF" && ok "protocol asks via AskUserQuestion" || bad "protocol does not name AskUserQuestion"
  grep -qi 'unanswered' "$REF" && ok "protocol only asks when unanswered" || bad "protocol does not gate the prompt on unanswered"
  grep -qiE 'headless|non-interactive' "$REF" && ok "protocol never prompts headless" || bad "protocol is silent on headless runs"
  grep -q 'settings.local.json' "$REF" && ok "protocol forbids settings.local.json" || bad "protocol does not forbid settings.local.json"
fi

echo "no export without consent (AC3)"
REC="$ROOT/scripts/connection-recorder.mjs"
HOOK="$ROOT/templates/hooks/run-report.sh"
RR="$S/run-report.mjs"
REC_PID=""
trap 'rm -rf "$TMP"; [ -n "$REC_PID" ] && kill "$REC_PID" 2>/dev/null' EXIT

node "$REC" "$TMP/port" "$TMP/conns" & REC_PID=$!
for _ in $(seq 1 50); do [ -s "$TMP/port" ] && break; sleep 0.1; done
PORT=$(cat "$TMP/port" 2>/dev/null)
conns() { wc -l < "$TMP/conns" | tr -d ' '; }

# Without this, a silent recorder would pass every case below.
node -e "require('net').connect($PORT,'127.0.0.1').on('error',()=>{}).on('close',()=>process.exit(0))"
sleep 0.3
check "the recorder counts a connection made to it" "$(conns)" "1"
: > "$TMP/conns"

# finish_run <name> <config-json|-> — a completed run in a project whose consent
# answer is the given config; returns once the detached report has landed, so a
# later export attempt would already have fired.
finish_run() {
  local p; p=$(proj "$1")
  if [ "$2" != "-" ]; then mkdir -p "$p/.claude"; echo "$2" > "$(cfg "$p")"; fi
  local pl
  pl=$(node -e 'process.stdout.write(JSON.stringify({hook_event_name:process.argv[1],cwd:process.argv[2],session_id:"s1",prompt:"/agentic-sdlc:build EPIC-7"}))' UserPromptSubmit "$p")
  printf '%s' "$pl" | env RUN_REPORT_MJS="$RR" AGENTIC_SDLC_EXPORT_URL="http://127.0.0.1:$PORT" /bin/bash "$HOOK" >/dev/null
  pl=$(node -e 'process.stdout.write(JSON.stringify({hook_event_name:process.argv[1],cwd:process.argv[2],session_id:"s1"}))' SessionEnd "$p")
  printf '%s' "$pl" | env RUN_REPORT_MJS="$RR" AGENTIC_SDLC_EXPORT_URL="http://127.0.0.1:$PORT" /bin/bash "$HOOK" >/dev/null
  for _ in $(seq 1 50); do ls "$p"/.agentic-sdlc/runs/*.json >/dev/null 2>&1 && break; sleep 0.1; done
  sleep 1
  ls "$p"/.agentic-sdlc/runs/*.json >/dev/null 2>&1 && echo kept || echo missing
}

check "declined: the local report is still kept" "$(finish_run declined '{"telemetry":{"share":false}}')" kept
check "declined: zero connections to the export endpoint" "$(conns)" "0"
check "unanswered: the local report is still kept" "$(finish_run unanswered -)" kept
check "unanswered: zero connections to the export endpoint" "$(conns)" "0"

echo "docs (AC4)"
SETUP="$ROOT/docs/setup.md"
SEC=$(awk '/^##+ .*[Cc]onsent/{f=1;next} f&&/^## /{exit} f' "$SETUP")
[ -n "$SEC" ] && ok "docs/setup.md has a consent section" || bad "docs/setup.md has no consent section"
has() { printf '%s' "$SEC" | grep -qiE "$1" && ok "$2" || bad "$2"; }
has 'schema-1|schema 1' "section names the schema-1 report"
has 'run_id' "section lists the run_id field"
has 'plugin_version' "section lists the plugin_version field"
has 'wall_clock_s' "section lists the wall_clock_s field"
has 'code-free' "section says the report is code-free"
has 'local report.*(always|regardless)|(always|regardless).*local report' "section says the local report is always kept regardless of the answer"
has '\.claude/agentic-sdlc\.json' "section names the checked-in config file"
has '"share": *(true|false)' "section shows the one-line edit to change your mind"

[ "$fail" = 0 ] && echo "consent: all passed" || { echo "consent: FAILED" >&2; exit 1; }
