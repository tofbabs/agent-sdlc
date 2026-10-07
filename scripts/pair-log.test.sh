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

# 9. The last commit rides along with `read`, so neither fresh agent spends round
#    trips on `git log` / `git show` at turn start — and a huge diff is capped,
#    not carried whole by every turn.
git init -q repo && cd repo
git config user.email t@t && git config user.name t
node "$PL" init STORY-G --brief ../brief-src.md >/dev/null 2>&1
printf 'it("pins GIT_SENTINEL")\n' > a.test.js
git add -A && git commit -qm "test(x): pins the thing [STORY-G]"
node "$PL" read STORY-G --role driver > drv.txt 2>/dev/null
grep -q 'GIT_SENTINEL' drv.txt && grep -q '## Recent commits' drv.txt \
  && ok "read includes the last commit" || bad "read is missing the last commit"
node "$PL" read STORY-G --role driver --no-git 2>/dev/null | grep -q 'GIT_SENTINEL' \
  && bad "--no-git still printed the commit" || ok "--no-git omits it"
seq 1 500 > big.txt && git add -A && git commit -qm "feat(x): big"
node "$PL" read STORY-G --role navigator > nav.txt 2>/dev/null
grep -q 'more lines' nav.txt && ! grep -q '^+500$' nav.txt \
  && ok "a large last commit is capped" || bad "large last commit was not capped"

# 10. The in-tree log is gitignored and dies with the worktree, so every session
#     write is mirrored into the git common dir, which all worktrees share.
M=.git/agentic-sdlc/pair/STORY-G/session.json
[ -f "$M" ] && cmp -s "$M" backlog/pair/STORY-G/session.json \
  && ok "init mirrors session.json into the git common dir" || bad "no mirror after init"
node "$PL" session STORY-G --set blocked --arch ARCH-9 >/dev/null 2>&1
grep -q '"blocked"' "$M" && cmp -s "$M" backlog/pair/STORY-G/session.json \
  && ok "session --set keeps the mirror in sync" || bad "mirror drifted after session --set"
echo "- steer: y" | node "$PL" append STORY-G --role navigator 2>/dev/null
cmp -s "$M" backlog/pair/STORY-G/session.json \
  && ok "navigator append keeps the mirror in sync" || bad "mirror drifted after append"
git worktree add -q ../wt-g -b feat/g 2>/dev/null
( cd ../wt-g && node "$PL" init STORY-W --brief ../brief-src.md >/dev/null 2>&1 )
[ -f .git/agentic-sdlc/pair/STORY-W/session.json ] \
  && ok "a worktree's session lands in the shared common-dir store" || bad "worktree session not mirrored to the common dir"
cd ..

# 11. Rejections are a structural counter and drive de-escalation at N=5; only
#     navigator appends may carry the flag.
mkdir -p dz && cd dz && git init -q . && git config user.email t@t && git config user.name t
git commit -q --allow-empty -m base && git branch -q base
node "$PL" init STORY-D --brief ../brief-src.md >/dev/null 2>&1
for i in 1 2 3 4; do echo "- n$i" | node "$PL" append STORY-D --role navigator 2>/dev/null; done
node "$PL" status STORY-D | grep -q 'rejections=0 deescalate=no' \
  && ok "four clean alternations do not de-escalate" || bad "early deescalate: $(node "$PL" status STORY-D)"
echo "- n5" | node "$PL" append STORY-D --role navigator 2>/dev/null
node "$PL" status STORY-D | grep -q 'alternation=5/20.*rejections=0 deescalate=yes' \
  && ok "five alternations with zero rejections de-escalate" || bad "no deescalate: $(node "$PL" status STORY-D)"
node "$PL" init STORY-E --brief ../brief-src.md >/dev/null 2>&1
echo "- REDO: x" | node "$PL" append STORY-E --role navigator --rejected 2>/dev/null
for i in 2 3 4 5 6; do echo "- n$i" | node "$PL" append STORY-E --role navigator 2>/dev/null; done
node "$PL" status STORY-E | grep -q 'rejections=1 deescalate=no' \
  && ok "one recorded rejection keeps the pair" || bad "rejection ignored: $(node "$PL" status STORY-E)"
before=$(cat backlog/pair/STORY-E/turns.md)
echo "- x" | node "$PL" append STORY-E --role driver --rejected >/dev/null 2>&1
[ $? -eq 2 ] && ok "driver cannot record a rejection" || bad "driver --rejected accepted"
[ "$(cat backlog/pair/STORY-E/turns.md)" = "$before" ] \
  && ok "a refused append leaves the turn log unchanged" || bad "refused driver --rejected still wrote a turn"
grep -q '"rejections": 1' .git/agentic-sdlc/pair/STORY-E/session.json \
  && ok "rejections are mirrored to the common-dir session" || bad "rejections not mirrored"

# 12. Handoff freezes the navigator's tests by content; changing one is caught.
git checkout -q -b feat/h
mkdir -p tests && echo a > tests/a.test.js && echo b > src.js && git add -A && git commit -q -m t
node "$PL" handoff STORY-D --base base | grep -q '1 test file' \
  && ok "handoff freezes test files only" || bad "handoff froze the wrong set"
node "$PL" frozen-tests STORY-D >/dev/null && ok "untouched frozen tests pass" || bad "false frozen-tests failure"
node "$PL" status STORY-D | grep -q 'deescalate=no' && ok "handed-off story no longer de-escalates" || bad "deescalate after handoff"
echo c >> src.js
node "$PL" frozen-tests STORY-D >/dev/null && ok "editing non-test code is allowed" || bad "src edit flagged"
echo c >> tests/a.test.js
out=$(node "$PL" frozen-tests STORY-D); code=$?
[ $code -eq 1 ] && grep -q 'tests/a.test.js' <<<"$out" \
  && ok "an edited frozen test is refused" || bad "frozen edit not caught ($code)"
cd ..

# 13. ARCH-1's `--from <path>` is the write shape that survives `-p` permission
#     matching (one literal command, no pipe, no expansion). It must go through
#     the same clamp() stdin always did, and only ever delete a file it was
#     handed inside that story's own drafts/.
mkdir -p from && cd from && git init -q . && git config user.email t@t && git config user.name t
node "$PL" init STORY-F --brief ../brief-src.md >/dev/null 2>&1
DRAFTS=backlog/pair/STORY-F/drafts
[ -d "$DRAFTS" ] && ok "init creates drafts/" || bad "init did not create drafts/"

echo "- from state" > "$DRAFTS/state.md"
node "$PL" state STORY-F --from "$DRAFTS/state.md" 2>/dev/null
grep -q 'from state' backlog/pair/STORY-F/state.md \
  && ok "state --from writes the body" || bad "state --from did not write"
[ -f "$DRAFTS/state.md" ] && bad "consumed state draft was not deleted" || ok "state --from deletes the consumed draft"

echo "- from entry" > "$DRAFTS/entry.md"
node "$PL" append STORY-F --role navigator --from "$DRAFTS/entry.md" 2>/dev/null
grep -q 'from entry' backlog/pair/STORY-F/turns.md \
  && ok "append --from writes the body" || bad "append --from did not write"
[ -f "$DRAFTS/entry.md" ] && bad "consumed entry draft was not deleted" || ok "append --from deletes the consumed draft"

before=$(cat backlog/pair/STORY-F/turns.md)
echo "- outside" > outside.md
node "$PL" append STORY-F --role driver --from outside.md >/dev/null 2>err.txt
code=$?
[ $code -eq 2 ] && grep -q 'drafts/' err.txt \
  && [ "$(cat backlog/pair/STORY-F/turns.md)" = "$before" ] && [ -f outside.md ] \
  && ok "a --from path outside drafts/ is rejected, exit 2, nothing written, file intact" \
  || bad "a path outside drafts/ was not rejected cleanly (exit $code)"

before=$(cat backlog/pair/STORY-F/turns.md)
echo "- sibling" > "backlog/pair/STORY-F/outside2.md"
node "$PL" append STORY-F --role driver --from "$DRAFTS/../outside2.md" >/dev/null 2>err.txt
code=$?
[ $code -eq 2 ] && grep -q 'drafts/' err.txt && [ "$(cat backlog/pair/STORY-F/turns.md)" = "$before" ] \
  && ok "a .. traversal out of drafts/ is rejected" \
  || bad "a .. traversal was not rejected cleanly (exit $code)"

node "$PL" append STORY-F --role navigator --from "$DRAFTS/missing.md" >/dev/null 2>err.txt
[ $? -eq 2 ] && grep -q 'not found' err.txt && ok "missing --from file exits 2" || bad "missing --from file mishandled"

: > "$DRAFTS/empty.md"
node "$PL" append STORY-F --role driver --from "$DRAFTS/empty.md" >/dev/null 2>&1
[ $? -eq 2 ] && [ -f "$DRAFTS/empty.md" ] \
  && ok "an empty --from file is rejected like empty stdin, and left in place" \
  || bad "empty --from file was accepted or consumed"

{ echo "- made green: t"; for i in $(seq 1 20); do echo "- line $i"; done; } > "$DRAFTS/entry.md"
node "$PL" append STORY-F --role driver --from "$DRAFTS/entry.md" 2>err.txt
grep -q 'truncated 21→10' err.txt && ok "--from entry truncates same as stdin" || bad "--from truncation missing"

{ echo "- fenced: t"; echo '```js'; echo "const leaked = 1"; echo '```'; } > "$DRAFTS/entry.md"
node "$PL" append STORY-F --role driver --from "$DRAFTS/entry.md" >/dev/null 2>&1
grep -q 'const leaked' backlog/pair/STORY-F/turns.md \
  && bad "--from fenced block survived" || ok "--from strips fenced code blocks same as stdin"

before=$(cat backlog/pair/STORY-F/turns.md)
echo "top secret" > ../secret.md
ln -s ../../../secret.md "$DRAFTS/evil.md"
node "$PL" append STORY-F --role driver --from "$DRAFTS/evil.md" >/dev/null 2>err.txt
code=$?
[ $code -eq 2 ] && grep -q 'drafts/' err.txt && [ -f ../secret.md ] \
  && [ "$(cat backlog/pair/STORY-F/turns.md)" = "$before" ] \
  && ok "a symlink in drafts/ escaping outside is rejected, exit 2, never read or deleted" \
  || bad "a symlinked draft escaping drafts/ was read, deleted, or not rejected (exit $code)"

echo "- stdin still works" | node "$PL" append STORY-F --role navigator 2>/dev/null
grep -q 'stdin still works' backlog/pair/STORY-F/turns.md \
  && ok "the old stdin-body shape still works unchanged" || bad "stdin-body append regressed"

node "$PL" session STORY-F --set complete >/dev/null 2>&1
node "$PL" status STORY-F 2>/dev/null | grep -q 'session=complete' \
  && ok "session still works with flags only (gains nothing from --from)" || bad "session flags-only regressed"
cd ..

[ "$fail" -eq 0 ] || { printf '\npair-log tests failed\n' >&2; exit 1; }
printf '\npair-log tests passed\n'
