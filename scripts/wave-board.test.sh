#!/usr/bin/env bash
#
# wave-board.test.sh — the board comment is rendered from JSON alone, so the
# same wave state always yields the same text and `start` can edit it in place.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WB="$ROOT/plugins/agentic-sdlc/scripts/wave-board.mjs"

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

render() { printf '%s' "$1" | node "$WB" 2>&1; }

has() { # name, payload, needle (whole line)
  local got; got=$(render "$2")
  if printf '%s\n' "$got" | grep -qxF -- "$3"; then ok "$1"; else bad "$1: line '$3' not in '$got'"; fi
}

STATE='{"wave":3,"epic":40,"now":"2026-01-01T12:05:00Z","briefs":[
{"number":7,"phase":"plan","since":"2026-01-01T11:50:00Z"},
{"number":5,"phase":"build","pr":61,"since":"2026-01-01T10:00:00Z"}]}'

has "heading names the wave and its epic Issue" "$STATE" "## Wave 3 (epic #40)"
has "header row" "$STATE" "| Brief | Phase | PR | In phase |"
has "a brief with a PR shows both numbers and hours+minutes in phase" "$STATE" "| #5 | build | #61 | 2h 5m |"
has "a brief without a PR shows a dash and minutes only" "$STATE" "| #7 | plan | — | 15m |"

first=$(render "$STATE" | grep -n '^| #' | head -1)
case "$first" in *"| #5 |"*) ok "rows are ordered by brief number" ;; *) bad "rows not ordered: $first" ;; esac

# The marker is how `start` and `status` find the one comment to edit in place
# among an Issue's comments, so it must be the first line and name the wave.
head=$(render "$STATE" | head -1)
[ "$head" = "<!-- wave-board:3 -->" ] && ok "first line is a hidden marker naming the wave" || bad "marker missing: '$head'"

CMD="$ROOT/plugins/agentic-sdlc/commands/wave.md"
REF="$ROOT/plugins/agentic-sdlc/reference/wave.md"

# commands/ is on the agent boot path and the size budget cannot grow, so the
# command only dispatches; the protocol loads on demand from reference/.
if [ -f "$CMD" ]; then
  grep -q 'reference/wave.md' "$CMD" && ok "command points at the reference protocol" || bad "command does not name reference/wave.md"
  size=$(wc -c < "$CMD")
  [ "$size" -le 1500 ] && ok "command stays a thin dispatcher ($size bytes)" || bad "command is $size bytes, over 1500"
else
  bad "commands/wave.md missing"
fi

if [ -f "$REF" ]; then
  for needle in 'start' 'status' 'wave-select.mjs' 'wave-board.mjs' 'brief-issue.mjs' 'wave:active' 'gh api'; do
    grep -qF -- "$needle" "$REF" && ok "reference covers $needle" || bad "reference lacks $needle"
  done
  grep -qi 'tick.*not available in this release' "$REF" && ok "tick answers not available in this release" || bad "tick not answered as unavailable"
  grep -qiE 'refus' "$REF" && ok "start refuses on an active wave" || bad "reference lacks the active-wave refusal"
  grep -qiE 'phase.*not available in this release' "$REF" && ok "phase answers not available in this release" || bad "phase not answered as unavailable"
else
  bad "reference/wave.md missing"
fi

# AC1 names the labels and the epic Issue; a reference that omits them leaves
# the agent to invent label names, which later `status` runs cannot find.
if [ -f "$REF" ]; then
  for needle in 'wave:<N>' 'phase:' 'epic Issue' 'if missing'; do
    grep -qF -- "$needle" "$REF" && ok "reference names $needle" || bad "reference lacks $needle"
  done
  # wave:active marks the epic only: on a selected brief it would make the
  # next select() refuse against the briefs themselves.
  grep -qiE 'label the selected Issues .wave:active' "$REF" && bad "reference puts wave:active on the selected briefs" || ok "wave:active is not put on selected briefs"
fi

# An unwired test script never runs in CI, so a board regression would ship.
grep -qF 'wave-board.test.sh' "$ROOT/scripts/preflight.sh" && ok "preflight runs the wave-board tests" || bad "preflight does not run wave-board.test.sh"

exit $fail
