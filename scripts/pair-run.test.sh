#!/usr/bin/env bash
#
# pair-run.test.sh — the headless pair loop, against a stub `claude`.
#
# The loop replaces ~2 orchestrator turns per alternation, so what must hold is
# that it stops at exactly the points the orchestrator has to decide something
# (complete, blocked, cap, a failed turn), resumes after a failure without
# repeating a role, and never re-spawns a role that made no progress.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PL="$ROOT/plugins/agentic-sdlc/scripts/pair-log.mjs"
PR="$ROOT/plugins/agentic-sdlc/scripts/pair-run.mjs"
FAKE="$ROOT/scripts/fixtures/pair-run/fake-claude.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

fresh() {
  rm -rf "$TMP/wt" && mkdir -p "$TMP/wt" && cd "$TMP/wt"
  git init -q . && git config user.email t@t && git config user.name t
  printf 'brief\n' > "$TMP/brief.md"
  node "$PL" init STORY-R --brief "$TMP/brief.md" >/dev/null
  mkdir -p sub
}
run() { node "$PR" STORY-R --worktree "$TMP/wt" --base feat/EPIC-1 --claude "$FAKE" "$@"; }

# 1. Runs to completion, alternating, and the close happens in the review turn.
fresh
out=$(run 2>/dev/null); code=$?
[ $code -eq 0 ] && ok "complete exits 0" || bad "complete exited $code"
roles=$(grep -o '^## [0-9]*\. [a-z]*' backlog/pair/STORY-R/turns.md | awk '{print $3}' | tr '\n' ' ')
[ "$roles" = "navigator driver navigator driver navigator " ] \
  && ok "roles alternate, navigator first" || bad "role order: $roles"
grep -q '"agent_turns": 5' <<<"$out" && grep -q '"cost_usd": 1.5' <<<"$out" \
  && ok "reports turns and summed cost" || bad "summary wrong: $out"
grep -q 'scopes: web' <<<"$out" && ok "navigator's closing report is relayed" || bad "closing report lost"
[ "$(wc -l < .agentic-sdlc/meter/pair-run-STORY-R.jsonl)" -eq 5 ] \
  && ok "one meter line per turn" || bad "meter lines wrong"
grep -c '"denied_count":0,"denied_tools":\[\]' .agentic-sdlc/meter/pair-run-STORY-R.jsonl | grep -q '^5$' \
  && ok "a clean turn's meter line has an explicit zero count and empty tool list" \
  || bad "clean-turn denial shape wrong: $(cat .agentic-sdlc/meter/pair-run-STORY-R.jsonl)"

# 1b. A turn with a permission denial records the count and tool name, never the
#     denied command text.
fresh
FAKE_DENIAL=1 run >/dev/null 2>&1
line=$(grep '"role":"driver"' .agentic-sdlc/meter/pair-run-STORY-R.jsonl | head -1)
grep -q '"denied_count":1,"denied_tools":\["Bash"\]' <<<"$line" \
  && ok "a denied turn's meter line carries the count and tool name" || bad "denial shape wrong: $line"
grep -q 'rm -rf' .agentic-sdlc/meter/pair-run-STORY-R.jsonl \
  && bad "meter file leaked denied command text" || ok "no denied command text reaches the meter file"

# 2. Blocked stops for the architect.
fresh
FAKE_BLOCK=1 run >/dev/null 2>&1; code=$?
[ $code -eq 10 ] && ok "blocked exits 10" || bad "blocked exited $code"

# 3. A failed turn (usage limit) stops, and a re-run resumes with the driver.
fresh
FAKE_FAIL_DRIVER_ONCE="$TMP/failed" run >/dev/null 2>&1; code=$?
[ $code -eq 5 ] && ok "failed turn exits 5" || bad "failed turn exited $code"
node "$PL" status STORY-R | grep -q 'next=driver' && ok "status says the driver is owed" || bad "next not driver"
FAKE_FAIL_DRIVER_ONCE="$TMP/failed" run >/dev/null 2>&1; code=$?
roles=$(grep -o '^## [0-9]*\. [a-z]*' backlog/pair/STORY-R/turns.md | awk '{print $3}' | tr '\n' ' ')
[ $code -eq 0 ] && [ "$roles" = "navigator driver navigator driver navigator " ] \
  && ok "re-run resumes without repeating the navigator" || bad "resume: code $code roles $roles"

# 4. A turn that logs nothing is not re-spawned forever.
fresh
FAKE_DRIVER_SILENT=1 run >/dev/null 2>&1; code=$?
[ $code -eq 5 ] && ok "a no-progress turn stops the loop" || bad "no-progress exited $code"

# 5. The cap stops the loop before a 21st navigator turn.
fresh
FAKE_REJECT=1 FAKE_COMPLETE_AT=99 run >/dev/null 2>&1; code=$?
node "$PL" status STORY-R | grep -q 'alternation=20/20' && [ $code -eq 4 ] \
  && ok "cap exits 4 at 20 alternations" || bad "cap: code $code $(node "$PL" status STORY-R)"

# 5b. Five alternations with no recorded rejection stop the loop for a SOLO handoff.
fresh
out=$(FAKE_COMPLETE_AT=99 run 2>/dev/null); code=$?
[ $code -eq 6 ] && grep -q '"deescalate": true' <<<"$out" \
  && node "$PL" status STORY-R | grep -q 'alternation=5/20.*rejections=0 deescalate=yes' \
  && ok "zero rejections over N alternations exits 6" || bad "deescalate: code $code $(node "$PL" status STORY-R)"

# 6. pair-log finds the log from a subfolder — the wrong-folder retry is gone.
cd sub && node "$PL" status STORY-R >/dev/null 2>&1 \
  && ok "pair-log resolves the worktree root from a subfolder" || bad "pair-log failed from a subfolder"

# 7. Each role runs on its agent default unless the human overrode it; an
#    override for one role never leaks into the other.
fresh
FAKE_MODEL_LOG="$TMP/m0" run >/dev/null 2>&1; code=$?
[ $code -eq 0 ] && [ ! -s "$TMP/m0" ] && ok "no --model passed by default" || bad "default (exit $code) passed a model: $(cat "$TMP/m0" 2>/dev/null)"
fresh
FAKE_MODEL_LOG="$TMP/m1" run --navigator-model opus >/dev/null 2>&1; code=$?
[ $code -eq 0 ] && [ "$(sort -u "$TMP/m1")" = "navigator opus" ] && ok "a navigator override reaches only the navigator" || bad "override (exit $code): $(cat "$TMP/m1" 2>/dev/null)"

# 8. ARCH-1: every turn carries the scoped pair-log grant, not a broader one, and
#    the prompts tell the agent the literal commands that grant covers.
fresh
export FAKE_ARGV_LOG="$TMP/argv.log"
export PAIR_RUN_CLAUDE_ARGS="--extra-flag"
run >/dev/null 2>&1
unset FAKE_ARGV_LOG PAIR_RUN_CLAUDE_ARGS
drafts="$(git -C "$TMP/wt" rev-parse --show-toplevel)/backlog/pair/STORY-R/drafts"
for role in navigator driver; do
  block=$(awk -v r="=== $role" 'BEGIN{p=0} /^=== /{p=($0==r)} p' "$TMP/argv.log")
  for rule in \
    "Bash(node $PL read *)" \
    "Bash(node $PL state *)" \
    "Bash(node $PL append *)" \
    "Bash(node $PL session *)" \
    "Edit(/$drafts/**)"
  do
    grep -qxF "$rule" <<<"$block" && ok "$role: grant carries $rule" || bad "$role: missing grant $rule"
  done
  grep -qxF 'Bash(node *)' <<<"$block" && bad "$role: grant too broad (Bash(node *))" || ok "$role: no Bash(node *)"
  grep -qxF 'init' <<<"$block" && bad "$role: grant includes init" || ok "$role: no bare init grant"
  grep -q 'dangerously-skip-permissions\|bypassPermissions' <<<"$block" \
    && bad "$role: bypass present" || ok "$role: no bypass flag"
  # --allowedTools must precede the PAIR_RUN_CLAUDE_ARGS extra, never the reverse.
  allowed_line=$(grep -nxF -- '--allowedTools' <<<"$block" | head -1 | cut -d: -f1)
  extra_line=$(grep -nxF -- '--extra-flag' <<<"$block" | head -1 | cut -d: -f1)
  [ -n "$allowed_line" ] && [ -n "$extra_line" ] && [ "$allowed_line" -lt "$extra_line" ] \
    && ok "$role: --allowedTools precedes PAIR_RUN_CLAUDE_ARGS" \
    || bad "$role: ordering wrong (allowed=$allowed_line extra=$extra_line)"
  prompt=$(grep -A1 -xF -- '-p' <<<"$block" | tail -1)
  grep -qF "$drafts" <<<"$prompt" && ok "$role: prompt carries the absolute drafts dir" \
    || bad "$role: prompt missing drafts dir"
  grep -qF -- '--from' <<<"$prompt" && ok "$role: prompt carries a --from command" \
    || bad "$role: prompt missing --from command"
done
grep -qF "node $PL state STORY-R --from $drafts/state.md && node $PL append STORY-R --role navigator --from $drafts/entry.md" \
  "$TMP/argv.log" && ok "navigator prompt carries the exact combined command" \
  || bad "navigator prompt missing the exact combined command"
grep -qF "node $PL append STORY-R --role driver --from $drafts/entry.md" "$TMP/argv.log" \
  && ok "driver prompt carries the exact append command" || bad "driver prompt missing append command"

# F2: the CLOSE/BLOCK steps in navigator.md and driver.md tell the agent to run
# `pair-log.mjs session`, which matches no grant — the prompt itself must carry
# the literal absolute `session` command so a headless close or block can't fail.
grep -qF "node $PL session STORY-R --set complete" "$TMP/argv.log" \
  && ok "navigator prompt carries the literal session --set complete command" \
  || bad "navigator prompt missing session --set complete"
for role in navigator driver; do
  block=$(awk -v r="=== $role" 'BEGIN{p=0} /^=== /{p=($0==r)} p' "$TMP/argv.log")
  grep -qF "node $PL session STORY-R --set blocked --arch ARCH-<n>" <<<"$block" \
    && ok "$role prompt carries the literal session --set blocked command" \
    || bad "$role prompt missing session --set blocked"
done

[ "$fail" -eq 0 ] || { printf '\npair-run tests failed\n' >&2; exit 1; }
printf '\npair-run tests passed\n'
