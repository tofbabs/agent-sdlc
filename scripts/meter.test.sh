#!/usr/bin/env bash
#
# meter.test.sh — the invariants meter.mjs exists to guarantee.
#
# Everything the cost programme claims rests on this meter being right, so these
# pin the things that would make every downstream number a lie:
#   * layer-A totals reproduce byte-exactly from a captured stream (case 1),
#   * layer-B enrichment reproduces per-agent attribution (case 2),
#   * USD is computed, not guessed — a price-table typo fails here (case 3),
#   * diff yields the exact signed deltas the benchmark reads (case 4),
#   * and — the one that matters most, the analogue of pair-log's cap test — a
#     transcript with a required field missing DEGRADES cleanly and never reports
#     zeros (case 5). Silent zeros would make every cost claim false.
#
# Bash, because the plugin repo has no test runner (see pair-log.test.sh).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/plugins/agentic-sdlc/scripts/meter.mjs"
F="$ROOT/scripts/fixtures/meter"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

# Extract a value from a JSON file: field <file> <js-expression-on-r>
field() { node -e 'const r=require(process.argv[1]);process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }

node "$M" report --stream "$F/stream-v1.jsonl" --transcript "$F/transcript.jsonl" \
  --subagents "$F/subagents" --lane deliberate --label fixture > "$TMP/report.json" 2>/dev/null

# 1. Layer A totals reproduce byte-exactly against the pinned expected record.
got=$(field "$TMP/report.json" 'JSON.stringify(r.totals)')
want=$(field "$F/expected.json" 'JSON.stringify(r.totals)')
[ "$got" = "$want" ] && ok "layer-A totals reproduce byte-exactly" || bad "totals drift: $got"

# 2. Layer A+B reproduces by_agent attribution.
got=$(field "$TMP/report.json" 'JSON.stringify(r.by_agent)')
want=$(field "$F/expected.json" 'JSON.stringify(r.by_agent)')
[ "$got" = "$want" ] && ok "layer-B by_agent reproduces" || bad "by_agent drift: $got"

# 3. USD is COMPUTED from the price table — a hand-computed figure, so a price or
#    multiplier typo fails here rather than silently mispricing every run. The
#    number is derived in the fixture header of docs/…-meter-and-benchmark-design.md.
usd=$(field "$TMP/report.json" 'r.totals.usd')
[ "$usd" = "0.83835" ] && ok "totals.usd == hand-computed 0.83835" || bad "usd=$usd, want 0.83835"
billed=$(field "$TMP/report.json" 'r.totals.billed_input_equivalent')
[ "$billed" = "74650" ] && ok "billed_input_equivalent == 74650" || bad "billed=$billed, want 74650"
over=$(field "$TMP/report.json" 'r.derived.overstatement_factor')
[ "$over" = "1.2579" ] && ok "overstatement_factor == 1.2579 (per-lane, not assumed)" || bad "overstatement=$over"

# 3b. The 2.0x 1h-write correction is actually applied (the whole reason this exists).
#     A record with only a 1h write bills at 2.0x that write plus base input.
echo '{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":0,"output_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":1000},"cache_read_input_tokens":0}}}' > "$TMP/onlyt1h.jsonl"
b1h=$(node "$M" report --stream "$TMP/onlyt1h.jsonl" 2>/dev/null | node -e 'const r=JSON.parse(require("fs").readFileSync(0));process.stdout.write(String(r.totals.billed_input_equivalent))')
[ "$b1h" = "2000" ] && ok "1h cache write billed at 2.0x (1000 -> 2000)" || bad "1h write billed=$b1h, want 2000"

# 4. diff yields the exact signed deltas the benchmark's accept rule reads.
node "$M" diff --baseline "$F/baseline.json" --candidate "$F/candidate.json" > "$TMP/diff.txt" 2>/dev/null
grep -q 'billed_input_equivalent: 100000 → 80000  (-20000, -20%)' "$TMP/diff.txt" \
  && ok "diff emits signed billed delta (-20000, -20%)" || bad "diff billed line wrong: $(grep billed "$TMP/diff.txt")"
grep -q 'usd: 1 → 0.8  (-0.2, -20%)' "$TMP/diff.txt" \
  && ok "diff emits signed usd delta" || bad "diff usd line wrong"

# 5. THE DEGRADATION CASE. A transcript missing a required field must degrade to
#    layer A: exit 0, name the field in `degraded`, warn on stderr, and STILL
#    report correct totals — never zeros.
node "$M" report --stream "$F/stream-v1.jsonl" --transcript "$F/transcript-broken.jsonl" \
  --subagents "$F/subagents" > "$TMP/broken.json" 2>"$TMP/broken.err"
rc=$?
[ "$rc" -eq 0 ] && ok "broken transcript exits 0 (degrade, not crash)" || bad "broken exit=$rc, want 0"
field "$TMP/broken.json" 'JSON.stringify(r.degraded)' | grep -q 'attributionAgent' \
  && ok "degraded names the missing field" || bad "degraded did not name attributionAgent"
grep -q 'degrading to layer A only' "$TMP/broken.err" \
  && ok "degradation warns on stderr" || bad "no degradation warning on stderr"
bb=$(field "$TMP/broken.json" 'r.totals.billed_input_equivalent')
[ "$bb" = "74650" ] && ok "degraded record still reports real totals, NOT zeros" || bad "degraded totals wrong: $bb"
ba=$(field "$TMP/broken.json" 'JSON.stringify(r.by_agent)')
[ "$ba" = "{}" ] && ok "degraded record omits by_agent (does not fabricate it)" || bad "by_agent not empty: $ba"

# 6. The A0 answer: a nonzero cache_read on spawn #2+ of the same agent type IS
#    cross-spawn prefix sharing. spawns[2] is the second coder spawn.
cr=$(field "$TMP/report.json" 'r.spawns[2].cache_read_on_first_call')
[ "$cr" = "15000" ] && ok "spawns[].cache_read_on_first_call captured (the A0 probe signal)" || bad "cache_read_on_first_call=$cr"

# 7. Misuse is refused rather than half-done.
node "$M" report --stream "$F/does-not-exist.jsonl" >/dev/null 2>&1
[ $? -eq 2 ] && ok "missing --stream file is refused (exit 2)" || bad "missing stream not refused"
node "$M" diff --baseline "$F/baseline.json" >/dev/null 2>&1
[ $? -eq 2 ] && ok "diff without --candidate is refused" || bad "diff without candidate accepted"

[ "$fail" -eq 0 ] || { printf '\nmeter tests failed\n' >&2; exit 1; }
printf '\nmeter tests passed\n'
