#!/usr/bin/env bash
#
# pair-log.test.sh — the invariants pair-log.mjs exists to guarantee.
#
# These are not unit tests for their own sake. Each one pins a limit that used to
# be prose in build.md and drifted anyway: on EPIC-15 every turn-log entry in both
# measured stories blew the 10-line cap (mean 43 lines), and both agents were told
# to read the identical block including the ~5KB static brief. Case 4 is the one
# that matters most — it is the whole reason the log is a directory.
#
# Bash, because the plugin repo has no test runner and adding one to ship a
# 300-line script would cost more than it pays for.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PL="$ROOT/plugins/agentic-sdlc/scripts/pair-log.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

cd "$TMP"
printf 'BRIEF_SENTINEL\n- binding: AST not regex\n' > brief-src.md

# 1. init lays down all four files.
node "$PL" init STORY-T --brief brief-src.md >/dev/null 2>&1
missing=""
for f in brief.md state.md turns.md session.json; do
  [ -f "backlog/pair/STORY-T/$f" ] || missing="$missing $f"
done
[ -z "$missing" ] && ok "init creates all four files" || bad "init missing:$missing"

# 2. A 43-line entry is capped at 10, and the agent is told.
{ echo "- review: OK"; for i in $(seq 1 42); do echo "- line $i"; done; } \
  | node "$PL" append STORY-T --role navigator 2>stderr.txt
body=$(sed -n '/^## 1\./,$p' backlog/pair/STORY-T/turns.md | tail -n +2 | grep -c .)
[ "$body" -eq 10 ] && ok "43-line entry truncated to 10" || bad "entry kept $body lines, want 10"
grep -q 'truncated 43→10' stderr.txt \
  && ok "truncation warns on stderr" || bad "no truncation warning"

# 3. Code fences are stripped outright — the diff is on the branch.
{ echo "- made green: t"; echo '```js'; echo "const leaked = 1"; echo '```'; } \
  | node "$PL" append STORY-T --role driver 2>/dev/null
if grep -q '```' backlog/pair/STORY-T/turns.md || grep -q 'const leaked' backlog/pair/STORY-T/turns.md; then
  bad "code fence survived into turns.md"
else
  ok "code fences stripped"
fi

# 4. THE ASYMMETRY. The driver runs ~42 round trips per turn to the navigator's
#    ~18, so the static brief is the most expensive thing it could carry. There
#    must be no way for it to arrive.
node "$PL" read STORY-T --role driver    > drv.txt 2>/dev/null
node "$PL" read STORY-T --role navigator > nav.txt 2>/dev/null
grep -q BRIEF_SENTINEL drv.txt \
  && bad "driver read leaked the brief" || ok "driver read never contains the brief"
grep -q BRIEF_SENTINEL nav.txt \
  && ok "navigator read does contain the brief" || bad "navigator read lost the brief"
[ "$(wc -c < drv.txt)" -lt "$(wc -c < nav.txt)" ] \
  && ok "driver read is smaller than navigator read" || bad "driver read is not smaller"

# 5. STATE is capped too — it is fixed-size because it is rewritten, not because
#    anyone remembers to keep it short.
for i in $(seq 1 30); do echo "- state line $i"; done | node "$PL" state STORY-T 2>/dev/null
sl=$(grep -c . backlog/pair/STORY-T/state.md)
[ "$sl" -eq 15 ] && ok "30-line STATE truncated to 15" || bad "STATE kept $sl lines, want 15"

# 6. THE COLLISION. A `SESSION: COMPLETE` written as prose on line 11 is
#    truncated away — which is exactly how the old grep-based check would have
#    missed it, and why the session is a machine field now.
{ echo "- steer: last"; for i in $(seq 1 9); do echo "- filler $i"; done; echo "SESSION: COMPLETE"; } \
  | node "$PL" append STORY-T --role navigator 2>/dev/null
grep -q 'SESSION: COMPLETE' backlog/pair/STORY-T/turns.md \
  && bad "marker survived truncation — collision case not reproduced" \
  || ok "prose marker on line 11 is truncated away (the old grep would miss it)"
node "$PL" session STORY-T --set complete >/dev/null 2>&1
node "$PL" status STORY-T 2>/dev/null | grep -q 'session=complete' \
  && ok "status reports complete despite truncation" || bad "status lost the session"

# 7. Alternations are counted by the script, so STATE need not carry the number
#    and cannot disagree with it. Two navigator appends above, one driver.
node "$PL" status STORY-T 2>/dev/null | grep -q 'alternation=2/20' \
  && ok "alternation counts navigator turns only" \
  || bad "alternation wrong: $(node "$PL" status STORY-T 2>/dev/null)"

# 8. Misuse is refused rather than half-done.
node "$PL" session STORY-T --set blocked >/dev/null 2>&1
[ $? -eq 2 ] && ok "blocked without --arch is refused" || bad "blocked without --arch was accepted"
echo "" | node "$PL" append STORY-T --role driver >/dev/null 2>&1
[ $? -eq 2 ] && ok "empty entry is refused" || bad "empty entry was accepted"

[ "$fail" -eq 0 ] || { printf '\npair-log tests failed\n' >&2; exit 1; }
printf '\npair-log tests passed\n'
