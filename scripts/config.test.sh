#!/usr/bin/env bash
#
# config.test.sh — the one reader of .claude/agentic-sdlc.json: defaults when the
# file says nothing, the file's values when it does, and a bare `get` for agents.
# Fixture-based: each case gets its own project dir.

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
cfg() { echo "$1/.claude/agentic-sdlc.json"; }
get() { ( cd "$1" && node "$S/config.mjs" get "$2" 2>"$TMP/err" ); }

echo "defaults (AC1, AC5)"
P=$(proj none)
check "no file: cap defaults to 15" "$(get "$P" plan.epic.cap)" "15"
check "no file: max_lines defaults to 150" "$(get "$P" plan.epic.max_lines)" "150"
check "no file: stories_by_line defaults to 40" "$(get "$P" plan.epic.stories_by_line)" "40"
check "no file: points.M defaults to 5" "$(get "$P" plan.epic.points.M)" "5"
check "no file: plan.epic prints one line of compact JSON" "$(get "$P" plan.epic)" \
  '{"points":{"S":3,"M":5,"L":15},"cap":15,"max_lines":150,"stories_by_line":40,"anchors":{"S":{"lines":150,"files":4},"M":{"lines":400,"files":8},"L":{"lines":800,"files":12}}}'
check "no file: stderr is empty" "$(cat "$TMP/err")" ""

P=$(proj teleonly); echo '{"telemetry":{"share":true,"terms":1}}' > "$(cfg "$P")"
out=$(get "$P" plan.epic.cap); rc=$?
check "telemetry-only file without schema reads as defaults" "$out" "15"
check "telemetry-only file exits 0" "$rc" "0"
check "telemetry-only file warns about nothing" "$(cat "$TMP/err")" ""

echo "overrides (AC2, AC3)"
P=$(proj over); echo '{"schema":1,"plan":{"epic":{"cap":8,"points":{"S":2,"M":4,"L":8}}}}' > "$(cfg "$P")"
check "file value replaces the default" "$(get "$P" plan.epic.cap)" "8"
check "a partial points override keeps the file's leaves" "$(get "$P" plan.epic.points.M)" "4"
check "an unset leaf keeps its default beside an override" "$(get "$P" plan.epic.max_lines)" "150"

P=$(proj lines); echo '{"plan":{"epic":{"max_lines":200,"stories_by_line":60}}}' > "$(cfg "$P")"
check "max_lines override" "$(get "$P" plan.epic.max_lines)" "200"
check "stories_by_line override" "$(get "$P" plan.epic.stories_by_line)" "60"

P=$(proj anch); echo '{"plan":{"epic":{"anchors":{"M":{"lines":300}}}}}' > "$(cfg "$P")"
check "a partial anchors override merges per leaf into the effective plan.epic" "$(get "$P" plan.epic)" \
  '{"points":{"S":3,"M":5,"L":15},"cap":15,"max_lines":150,"stories_by_line":40,"anchors":{"S":{"lines":150,"files":4},"M":{"lines":300,"files":8},"L":{"lines":800,"files":12}}}'
check "an anchors leaf is reachable by dotted key" "$(get "$P" plan.epic.anchors.M.lines)" "300"
check "anchors override: stderr is empty" "$(cat "$TMP/err")" ""

echo "invalid config is an error, never a default (AC4)"
bogus() { # name, file body, key to get, expected stderr
  local P; P=$(proj "$1"); printf '%s' "$2" > "$(cfg "$P")"
  local out rc; out=$(get "$P" "$3"); rc=$?
  check "$1: exits 2" "$rc" "2"
  check "$1: message" "$(cat "$TMP/err")" "$4"
  check "$1: nothing on stdout" "$out" ""
}
bogus badjson '{"plan":' plan.epic.cap 'config: file: invalid JSON'
bogus strcap '{"plan":{"epic":{"cap":"8"}}}' plan.epic.cap 'config: plan.epic.cap: must be an integer >= 1'
bogus floatcap '{"plan":{"epic":{"cap":8.5}}}' plan.epic.cap 'config: plan.epic.cap: must be an integer >= 1'
bogus zerolines '{"plan":{"epic":{"max_lines":0}}}' plan.epic.max_lines 'config: plan.epic.max_lines: must be an integer >= 1'
bogus planarray '{"plan":[]}' plan.epic.cap 'config: plan: must be an object'
bogus epicnull '{"plan":{"epic":null}}' plan.epic.cap 'config: plan.epic: must be an object'
bogus badschema '{"schema":2}' plan.epic.cap 'config: schema: must be 1'
bogus lcap '{"plan":{"epic":{"cap":8}}}' plan.epic.cap 'config: plan.epic.points.L: 15, the default, exceeds plan.epic.cap 8'
bogus order '{"plan":{"epic":{"points":{"S":6}}}}' plan.epic.cap 'config: plan.epic.points.S: 6 exceeds plan.epic.points.M 5, the default'
bogus lineorder '{"plan":{"epic":{"stories_by_line":151}}}' plan.epic.cap 'config: plan.epic.stories_by_line: 151 exceeds plan.epic.max_lines 150, the default'
bogus badsize '{"plan":{"epic":{"points":{"m":4}}}}' plan.epic.cap 'config: plan.epic.points.m: unknown size, expected S, M or L'
bogus anchorsize '{"plan":{"epic":{"anchors":{"m":{"lines":400}}}}}' plan.epic.cap 'config: plan.epic.anchors.m: unknown size, expected S, M or L'
bogus anchorint '{"plan":{"epic":{"anchors":{"M":{"files":2.5}}}}}' plan.epic.cap 'config: plan.epic.anchors.M.files: must be an integer >= 1'
bogus anchorobj '{"plan":{"epic":{"anchors":[]}}}' plan.epic.cap 'config: plan.epic.anchors: must be an object'
bogus anchororder '{"plan":{"epic":{"anchors":{"S":{"lines":500}}}}}' plan.epic.cap 'config: plan.epic.anchors.S.lines: 500 exceeds plan.epic.anchors.M.lines 400, the default'
bogus anchorfiles '{"plan":{"epic":{"anchors":{"M":{"files":13}}}}}' plan.epic.cap 'config: plan.epic.anchors.M.files: 13 exceeds plan.epic.anchors.L.files 12, the default'

echo "unknown keys warn once and are ignored (AC4)"
P=$(proj unk); echo '{"schema":1,"foo":1,"plan":{"bar":2,"epic":{"cap":20,"baz":3}}}' > "$(cfg "$P")"
out=$(get "$P" plan.epic.cap); rc=$?
check "unknown keys: value still read" "$out" "20"
check "unknown keys: exits 0" "$rc" "0"
check "unknown keys: one warning per key, in file order" "$(cat "$TMP/err")" \
  "config: foo: unknown key, ignored
config: plan.bar: unknown key, ignored
config: plan.epic.baz: unknown key, ignored"
P=$(proj unkget); echo '{"foo":1}' > "$(cfg "$P")"
check "unknown key under get: effective plan.epic unpolluted" "$(get "$P" plan.epic.cap)" "15"

echo "review.round_cap (ADR-0006)"
P=$(proj nofile)
check "no file: round_cap defaults to 3" "$(get "$P" review.round_cap)" "3"
P=$(proj schemaonly); printf '%s' '{"schema":1}' > "$(cfg "$P")"
check "schema-only file: round_cap defaults to 3" "$(get "$P" review.round_cap)" "3"
P=$(proj cap2); printf '%s' '{"schema":1,"review":{"round_cap":2}}' > "$(cfg "$P")"
check "configured round_cap wins" "$(get "$P" review.round_cap)" "2"
check "--cwd reads the named project" "$(node "$S/config.mjs" get review.round_cap --cwd "$P" 2>"$TMP/err")" "2"
for v in '"3"' 0 -1 2.5 null; do
  bogus "cap$v" "{\"schema\":1,\"review\":{\"round_cap\":$v}}" review.round_cap 'config: review.round_cap: must be an integer >= 1'
done
bogus reviewarr '{"review":[]}' review.round_cap 'config: review: must be an object'
bogus reviewfirst '{"review":{"round_cap":0},"plan":{"epic":null}}' review.round_cap 'config: review.round_cap: must be an integer >= 1'
P=$(proj revunk); printf '%s' '{"schema":1,"review":{"round_cap":2,"mystery":1}}' > "$(cfg "$P")"
out=$(get "$P" review.round_cap); rc=$?
check "unknown review key: cap still served" "$out" "2"
check "unknown review key: exits 0" "$rc" "0"
check "unknown review key: warns" "$(cat "$TMP/err")" "config: review.mystery: unknown key, ignored"
P=$(proj nope)
out=$(get "$P" review.nope); rc=$?
check "get of an unknown key exits 2" "$rc" "2"
check "get of an unknown key: message" "$(cat "$TMP/err")" "config: review.nope: unknown key"
P=$(proj tele); printf '%s' '{"schema":1,"telemetry":{"share":true,"terms":1}}' > "$(cfg "$P")"
for k in telemetry telemetry.share schema; do
  out=$(get "$P" "$k"); rc=$?
  check "get $k exits 2" "$rc" "2"
  check "get $k prints nothing" "$out" ""
  check "get $k message" "$(cat "$TMP/err")" "config: $k: unknown key"
done

echo "coexistence with consent.mjs"
P=$(proj consent)
node "$S/consent.mjs" set true --cwd "$P" >/dev/null
check "consent-written file reads cap 3" "$(get "$P" review.round_cap)" "3"
check "consent-written file: stderr empty" "$(cat "$TMP/err")" ""
P=$(proj both); printf '%s' '{"schema":1,"review":{"round_cap":4},"telemetry":{"share":false}}' > "$(cfg "$P")"
check "telemetry beside review: cap read" "$(get "$P" review.round_cap)" "4"
check "telemetry beside review: silent" "$(cat "$TMP/err")" ""
node "$S/consent.mjs" set true --cwd "$P" >/dev/null
check "consent set keeps the cap" "$(get "$P" review.round_cap)" "4"
check "consent get still prints share=true" "$(node "$S/consent.mjs" get --cwd "$P")" "share=true"

echo "readRaw and updateConfig (AC5, ADR-0007)"
raw() { node --input-type=module -e "import { readRaw } from '$S/config.mjs'; try { process.stdout.write(JSON.stringify(readRaw(process.argv[1]))) } catch (e) { process.stdout.write('threw') }" "$1"; }
upd() { node --input-type=module -e "import { updateConfig } from '$S/config.mjs'; try { updateConfig(process.argv[1], (c) => { c.telemetry = { share: true }; return c }); process.stdout.write('ok') } catch (e) { process.stdout.write('threw:' + e.message) }" "$1" 2>/dev/null; }

P=$(proj rawnone)
check "readRaw: missing file is null" "$(raw "$P")" "null"
P=$(proj rawok); echo '{"foo":1,"telemetry":{"share":true}}' > "$(cfg "$P")"
check "readRaw: returns the file as written, no defaults, no pruning" "$(raw "$P")" '{"foo":1,"telemetry":{"share":true}}'
P=$(proj rawbad); echo '{ nope' > "$(cfg "$P")"
check "readRaw: invalid JSON throws" "$(raw "$P")" "threw"
P=$(proj rawarr); echo '[]' > "$(cfg "$P")"
check "readRaw: non-object root throws" "$(raw "$P")" "threw"

P=$(proj updnew)
check "updateConfig: creates a missing file" "$(upd "$P")" "ok"
check "updateConfig: a created file starts with schema 1, 2-space JSON, trailing newline" "$(cat "$(cfg "$P")")" '{
  "schema": 1,
  "telemetry": {
    "share": true
  }
}'
check "updateConfig: file ends with a newline" "$(tail -c1 "$(cfg "$P")" | od -An -c | tr -d ' ')" '\n'
P=$(proj updkeep); printf '{"plan":{"epic":{"cap":9}}}' > "$(cfg "$P")"
upd "$P" >/dev/null
check "updateConfig: no schema is added to a file without one, nothing else changes, no defaults written" \
  "$(node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))))' "$(cfg "$P")")" \
  '{"plan":{"epic":{"cap":9}},"telemetry":{"share":true}}'
for bad_content in '{ nope' '[1]' '{"schema":2}'; do
  P=$(proj "updrefuse$RANDOM"); printf '%s' "$bad_content" > "$(cfg "$P")"; before=$(cat "$(cfg "$P")")
  out=$(upd "$P")
  [ "${out#threw}" != "$out" ] && [ "$(cat "$(cfg "$P")")" = "$before" ] \
    && ok "updateConfig: refuses $bad_content and leaves the file untouched" || bad "updateConfig: $bad_content — out: $out"
done

echo "wave.priority_labels"
P=$(proj wavedef)
check "no file: priority labels default to P0..P3 in order" "$(get "$P" wave.priority_labels)" \
  '["priority:P0","priority:P1","priority:P2","priority:P3"]'
P=$(proj waveover); echo '{"wave":{"priority_labels":["p:high","p:low"]}}' > "$(cfg "$P")"
check "a file's priority labels replace the default list whole" "$(get "$P" wave.priority_labels)" '["p:high","p:low"]'
check "wave override: stderr is empty" "$(cat "$TMP/err")" ""
for case in 'notlist|{"wave":{"priority_labels":"priority:P0"}}' 'empty|{"wave":{"priority_labels":[]}}' 'nonstring|{"wave":{"priority_labels":["a",2]}}'; do
  P=$(proj "wavebad${case%%|*}"); printf '%s' "${case#*|}" > "$(cfg "$P")"
  out=$(get "$P" wave.priority_labels); rc=$?
  check "${case%%|*}: exits 2" "$rc" "2"
  check "${case%%|*}: message" "$(cat "$TMP/err")" "config: wave.priority_labels: must be a non-empty list of strings"
done

echo "wave.lock_timeouts"
P=$(proj lockdef)
check "no file: lock timeouts default to 60 plan, 240 build" "$(get "$P" wave.lock_timeouts)" '{"plan":60,"build":240}'
P=$(proj lockover); echo '{"wave":{"lock_timeouts":{"build":90}}}' > "$(cfg "$P")"
check "a partial override merges over the defaults" "$(get "$P" wave.lock_timeouts)" '{"plan":60,"build":90}'
for case in 'zero|{"plan":0}|plan' 'string|{"build":"4h"}|build'; do
  IFS='|' read -r n body key <<< "$case"
  P=$(proj "lockbad$n"); printf '{"wave":{"lock_timeouts":%s}}' "$body" > "$(cfg "$P")"
  out=$(get "$P" wave.lock_timeouts); rc=$?
  check "$n: exits 2" "$rc" "2"
  check "$n: message" "$(cat "$TMP/err")" "config: wave.lock_timeouts.$key: must be an integer >= 1 (minutes)"
done

echo "wave.stall_thresholds"
P=$(proj stalldef)
check "no file: stall thresholds default to 24h awaiting-merge, 2h ci, 3h revise" "$(get "$P" wave.stall_thresholds)" '{"awaiting-merge":24,"ci":2,"revise":3}'
P=$(proj stallover); echo '{"wave":{"stall_thresholds":{"ci":5}}}' > "$(cfg "$P")"
check "a partial override merges over the defaults" "$(get "$P" wave.stall_thresholds)" '{"awaiting-merge":24,"ci":5,"revise":3}'
P=$(proj stallbad); echo '{"wave":{"stall_thresholds":{"revise":0}}}' > "$(cfg "$P")"
out=$(get "$P" wave.stall_thresholds); rc=$?
check "zero: exits 2" "$rc" "2"
check "zero: message" "$(cat "$TMP/err")" "config: wave.stall_thresholds.revise: must be an integer >= 1 (hours)"

exit $fail
