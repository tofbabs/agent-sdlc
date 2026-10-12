#!/usr/bin/env bash
#
# plan-artifacts.test.sh — the invariants plan-artifacts.mjs exists to guarantee.
#
# Each case pins a failure measured on a consuming repo running parallel
# sessions in worktrees: two runs picking the same FAST-<n>, a merged plan citing
# an ADR that lived only as an untracked file elsewhere, and stale untracked
# plans in the main checkout drifting from the copy that shipped.
#
# Bash, for the same reason as pair-log.test.sh: no test runner in this repo.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PA="$ROOT/plugins/agentic-sdlc/scripts/plan-artifacts.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
g() { git -c init.defaultBranch=main -c core.hooksPath=/dev/null "$@"; }

# A repo whose main has FAST-1, a side branch that committed FAST-3, and a
# second worktree holding an untracked FAST-5 — the number only a scan of every
# checkout can see.
g init -q "$TMP/main" && cd "$TMP/main"
mkdir backlog && echo "# FAST-1" > backlog/FAST-1.md
g add . && g commit -qm init
g branch side && g worktree add -q ../wt side
echo "# FAST-3" > ../wt/backlog/FAST-3.md && g -C ../wt add . && g -C ../wt commit -qm three
echo "# FAST-5" > ../wt/backlog/FAST-5.md

# 1. The next number is taken over every worktree and branch, not just here.
out=$(node "$PA" claim FAST 2>/dev/null)
[ "$out" = "backlog/FAST-6.md" ] && ok "claim sees other worktrees and branches (FAST-6)" \
  || bad "claim returned '$out', want backlog/FAST-6.md"

# 2. A number already on disk is never reused, even if the scan missed it.
out2=$(node "$PA" claim FAST 2>/dev/null)
[ "$out2" = "backlog/FAST-7.md" ] && ok "second claim does not reuse FAST-6" \
  || bad "second claim returned '$out2', want backlog/FAST-7.md"

# 3. EPIC and FAST count independently.
out3=$(node "$PA" claim EPIC 2>/dev/null)
[ "$out3" = "backlog/EPIC-1.md" ] && ok "EPIC numbering is independent" \
  || bad "EPIC claim returned '$out3'"

# 4. carry: plan + listed artifacts become the build branch's first commit, debt
#    moves into the ledger, and the untracked originals leave the planning checkout.
mkdir -p docs/adr
echo "# ADR 0099" > docs/adr/0099-x.md
cat > backlog/FAST-6.md <<'EOF'
# FAST-6: thing
- Artifacts: docs/adr/0099-x.md
- Status: TODO

## Tasks
### T6-1: do it

## Debt
### Shortcut row
- Raised: plan
EOF
g worktree add -q ../build -b feat/FAST-6 main
( cd ../build && node "$PA" carry FAST-6 --from "$TMP/main" >/dev/null 2>&1 )
subj=$(g -C ../build log -1 --format=%s)
[ "$subj" = "docs: add FAST-6 plan" ] && ok "carry commits the plan" || bad "last commit is '$subj'"
g -C ../build cat-file -e HEAD:docs/adr/0099-x.md 2>/dev/null \
  && ok "listed artifact ships on the branch" || bad "ADR not committed"
g -C ../build show HEAD:docs/TOOLING-DEBT.md 2>/dev/null | grep -q '### Shortcut row' \
  && ok "plan-time debt lands in the ledger" || bad "debt row not ledgered"
[ ! -e backlog/FAST-6.md ] && [ ! -e docs/adr/0099-x.md ] \
  && ok "untracked originals removed from the planning checkout" \
  || bad "stale copies left in the planning checkout"
[ -e backlog/FAST-1.md ] && ok "tracked files in the planning checkout untouched" \
  || bad "carry removed a tracked file"

# 5. A differing file already on the branch is never overwritten.
echo "# FAST-7 plan" > backlog/FAST-7.md
g worktree add -q ../build7 -b feat/FAST-7 main
mkdir -p ../build7/backlog && echo "# someone else's FAST-7" > ../build7/backlog/FAST-7.md
( cd ../build7 && node "$PA" carry FAST-7 --from "$TMP/main" >/dev/null 2>&1 )
[ $? -eq 2 ] && ok "carry refuses to overwrite a differing file" || bad "carry overwrote or wrong exit"
grep -q "someone else" ../build7/backlog/FAST-7.md \
  && ok "branch copy left intact" || bad "branch copy clobbered"
[ -e backlog/FAST-7.md ] && ok "planning copy kept when carry refuses" || bad "planning copy lost"

# 5b. A committed STUB of the same ID is the one differing copy carry may replace:
#     the filled-in plan supersedes it, and the result must be committed.
printf '# EPIC-41: later part\n- Status: STUB\n' > "$TMP/stubcopy"
printf '# EPIC-41: later part\n- Status: TODO\n\n## Stories\n\n### STORY-41-1: filled\n- estimate: S\n' > backlog/EPIC-41.md
g worktree add -q ../build41 -b feat/EPIC-41 main
mkdir -p ../build41/backlog && cp "$TMP/stubcopy" ../build41/backlog/EPIC-41.md
g -C ../build41 add backlog/EPIC-41.md && g -C ../build41 commit -qm "docs: stub EPIC-41"
( cd ../build41 && node "$PA" carry EPIC-41 --from "$TMP/main" >/dev/null 2>&1 )
rc=$?
[ $rc -eq 0 ] && ok "carry replaces a STUB copy of the same ID" || bad "stub replace: rc=$rc"
g -C ../build41 show HEAD:backlog/EPIC-41.md 2>/dev/null | grep -q 'STORY-41-1: filled' \
  && ok "filled-in plan is what the branch commits" || bad "stub still committed"
subj=$(g -C ../build41 log -1 --format=%s)
[ "$subj" = "docs: add EPIC-41 plan" ] && ok "stub replacement is committed" || bad "last commit is '$subj'"

# 5c. Only a STUB of that ID is replaceable: a STUB heading another ID, or a non-STUB
#     body that merely mentions STUB, is somebody else's work.
printf '# EPIC-42: fill\n- Status: TODO\n' > backlog/EPIC-42.md
g worktree add -q ../build42 -b feat/EPIC-42 main
mkdir -p ../build42/backlog && printf '# EPIC-43: other\n- Status: STUB\n' > ../build42/backlog/EPIC-42.md
( cd ../build42 && node "$PA" carry EPIC-42 --from "$TMP/main" >/dev/null 2>&1 )
[ $? -eq 2 ] && grep -q 'EPIC-43' ../build42/backlog/EPIC-42.md \
  && ok "carry refuses a STUB that belongs to another ID" || bad "foreign stub overwritten"
printf '# EPIC-44: fill\n- Status: TODO\n' > backlog/EPIC-44.md
g worktree add -q ../build44 -b feat/EPIC-44 main
mkdir -p ../build44/backlog && printf '# EPIC-44: built\n- Status: DONE\n\nNotes: was Status: STUB once\n' > ../build44/backlog/EPIC-44.md
( cd ../build44 && node "$PA" carry EPIC-44 --from "$TMP/main" >/dev/null 2>&1 )
[ $? -eq 2 ] && grep -q 'DONE' ../build44/backlog/EPIC-44.md \
  && ok "carry refuses a non-STUB copy that mentions STUB" || bad "non-stub overwritten"
# 5d. STUB counts only in the header, and only under this exact ID: a finished epic quoting
#     "- Status: STUB" in its body, or a heading like EPIC-45-old, is not replaceable.
printf '# EPIC-45: fill\n- Status: TODO\n' > backlog/EPIC-45.md
g worktree add -q ../build45 -b feat/EPIC-45 main
mkdir -p ../build45/backlog && printf '# EPIC-45: built\n- Status: DONE\n\n## Notes\n\n- Status: STUB\n' > ../build45/backlog/EPIC-45.md
( cd ../build45 && node "$PA" carry EPIC-45 --from "$TMP/main" >/dev/null 2>&1 )
[ $? -eq 2 ] && grep -q 'DONE' ../build45/backlog/EPIC-45.md \
  && ok "carry refuses a body-only STUB line" || bad "body STUB overwritten"
printf '# EPIC-46: fill\n- Status: TODO\n' > backlog/EPIC-46.md
g worktree add -q ../build46 -b feat/EPIC-46 main
mkdir -p ../build46/backlog && printf '# EPIC-46-old: other\n- Status: STUB\n' > ../build46/backlog/EPIC-46.md
( cd ../build46 && node "$PA" carry EPIC-46 --from "$TMP/main" >/dev/null 2>&1 )
[ $? -eq 2 ] && grep -q 'EPIC-46-old' ../build46/backlog/EPIC-46.md \
  && ok "carry refuses a STUB under a prefixed ID" || bad "prefixed-ID stub overwritten"

# 6. The shared ledger is never an Artifact — whole-file copy would clobber it.
printf '# FAST-8\n- Artifacts: docs/TOOLING-DEBT.md\n' > backlog/FAST-8.md
( node "$PA" carry FAST-8 --from "$TMP/main" >/dev/null 2>&1 )
[ $? -eq 2 ] && ok "ledger listed as an Artifact is refused" || bad "ledger Artifact accepted"

# 7. check: an epic's stories are scored S=3 M=5 L=15 against a cap of 15.
epic() { # epic <ID> <estimate>... — writes backlog/<ID>.md in $TMP/chk
  local id=$1; shift; local i=0
  { printf '# %s: t\n\n## Stories\n\n' "$id"
    for e in "$@"; do
      i=$((i+1)); printf '### STORY-9-%d: s\n' "$i"
      [ "$e" = none ] || printf -- '- estimate: %s\n' "$e"   # "none" omits the line
      printf -- '- depends_on: []\n\n'
    done
    printf '## Debt\n'; } > "$TMP/chk/backlog/$id.md"
}
mkdir -p "$TMP/chk/backlog"
chk() { ( cd "$TMP/chk" && node "$PA" check "$1" 2>&1 ); }

epic EPIC-1 M M S;     chk EPIC-1 >/dev/null; [ $? -eq 0 ] && ok "check passes under cap (13)" || bad "13 points rejected"
epic EPIC-2 L;         chk EPIC-2 >/dev/null; [ $? -eq 0 ] && ok "check passes at cap with one L" || bad "1 L rejected"
epic EPIC-3 S S S S S; chk EPIC-3 >/dev/null; [ $? -eq 0 ] && ok "check passes at cap with five S" || bad "5 S rejected"
epic EPIC-4 M M S S;   out=$(chk EPIC-4); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q '16' && echo "$out" | grep -q '15' \
  && ok "check rejects 16 naming total and cap" || bad "16 points: rc=$rc out=$out"
epic EPIC-5 M none
out=$(chk EPIC-5); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q 'STORY-9-2' && ok "check names a story with no estimate" || bad "missing estimate: rc=$rc out=$out"
epic EPIC-6 M XL;      out=$(chk EPIC-6); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q 'STORY-9-2' && ok "check names a story with estimate XL" || bad "XL estimate: rc=$rc out=$out"
echo "# FAST-9" > "$TMP/chk/backlog/FAST-9.md"
chk FAST-9 >/dev/null; [ $? -eq 0 ] && ok "check ignores FAST-<n>" || bad "FAST rejected"
cat > "$TMP/chk/backlog/EPIC-7.md" <<'EOF'
# EPIC-7: stub
- Status: STUB

## Stories

### STORY-7-1: a
- estimate: L
- depends_on: []

### STORY-7-2: b
- estimate: S
- depends_on: [STORY-7-1]
EOF
out=$(chk EPIC-7); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q '18' && ok "STUB-shaped epic is scored like any other" || bad "stub: rc=$rc out=$out"

# 8. check: 150 lines and "## Stories" by line 40 pass; one more of either fails.
pad() { local n=$1; local i; for ((i=0;i<n;i++)); do echo "filler"; done; }
{ echo "# EPIC-10: t"; pad 38; echo "## Stories"; echo; echo "### STORY-10-1: s"; echo "- estimate: S"; pad 150; } | head -n 150 > "$TMP/chk/backlog/EPIC-10.md"
chk EPIC-10 >/dev/null; [ $? -eq 0 ] && ok "check passes at 150 lines, Stories at line 40" || bad "150 lines / line 40 rejected"
{ cat "$TMP/chk/backlog/EPIC-10.md"; echo x; } > "$TMP/chk/backlog/EPIC-11.md"
out=$(chk EPIC-11); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q '151 lines' && ok "check rejects 151 lines naming the limit" || bad "151 lines: rc=$rc out=$out"
{ echo "# EPIC-12: t"; pad 39; echo "## Stories"; echo; echo "### STORY-12-1: s"; echo "- estimate: S"; } > "$TMP/chk/backlog/EPIC-12.md"
out=$(chk EPIC-12); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q 'line 41' && ok "check rejects Stories at line 41 naming the limit" || bad "Stories at 41: rc=$rc out=$out"
{ echo "# EPIC-13: t"; pad 50; echo "## Stories"; pad 110; echo "### STORY-13-1: s"; echo "- estimate: S"; } > "$TMP/chk/backlog/EPIC-13.md"
out=$(chk EPIC-13); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q 'lines exceeds' && echo "$out" | grep -q 'starts at line' \
  && ok "check reports both line failures in one run" || bad "both limits: rc=$rc out=$out"

# 9. check: Depends-on targets must exist in backlog/; none or no header is fine.
dep() { printf '# %s: t\n- Depends on: %s\n\n## Stories\n\n### STORY-1-1: s\n- estimate: S\n' "$1" "$2" > "$TMP/chk/backlog/$1.md"; }
dep EPIC-20 "EPIC-98 (merged)"
out=$(chk EPIC-20); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q 'EPIC-98' && ok "check names a missing Depends-on target" || bad "missing target: rc=$rc out=$out"
dep EPIC-21 "EPIC-1 (released), EPIC-99 (merged)"
out=$(chk EPIC-21); rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q 'EPIC-99' && ! echo "$out" | grep -q 'EPIC-1 ' && ok "check flags only the absent target in a list" || bad "list: rc=$rc out=$out"
dep EPIC-22 "EPIC-1 (merged)"
chk EPIC-22 >/dev/null; [ $? -eq 0 ] && ok "check passes when the Depends-on target exists" || bad "present target rejected"
dep EPIC-23 "none"
chk EPIC-23 >/dev/null; [ $? -eq 0 ] && ok "check passes Depends on: none" || bad "none rejected"
chk EPIC-1 >/dev/null; [ $? -eq 0 ] && ok "check passes an epic with no Depends-on header" || bad "no header rejected"

# 10. The budget reference must state the constants plan-artifacts.mjs enforces.
REF="$ROOT/plugins/agentic-sdlc/reference/epic-budget.md"
const() { sed -n "s/^const $1 = \\(.*\\)$/\\1/p" "$PA"; }
pts=$(const POINTS | tr -d '{}:,' | tr -s ' ' | sed 's/^ *//;s/ *$//')
cap=$(const EPIC_CAP); ml=$(const MAX_LINES); sl=$(const STORIES_BY_LINE)
want_rows=$(for k in S M L; do echo "| $k | $(echo "$pts" | sed -n "s/.*$k \\([0-9]*\\).*/\\1/p") |"; done)
drift=""
while IFS= read -r row; do grep -qF -- "$row" "$REF" || drift="$drift [$row]"; done <<< "$want_rows"
grep -qF -- "**Cap: $cap points" "$REF" || drift="$drift [cap $cap]"
grep -qF -- "**$ml lines**" "$REF" || drift="$drift [max_lines $ml]"
grep -qF -- "starts by line $sl" "$REF" || drift="$drift [stories_by_line $sl]"
[ -z "$cap" ] || [ -z "$ml" ] || [ -z "$sl" ] && drift="$drift [constants not parsed]"
[ -z "$drift" ] && ok "epic-budget.md matches the weights, cap and limits in plan-artifacts.mjs" || bad "epic-budget.md drifted:$drift"
# 10b. The template is what the planner copies; without these header lines a split
#      epic has nowhere to record its parent brief, position and predecessor.
TPL="$ROOT/templates/backlog/EPIC-template.md"
hdr=$(sed '/^## /,$d' "$TPL")
miss=""
for h in 'Brief:' 'Part: ' 'Depends on:'; do
  printf '%s\n' "$hdr" | grep -qE "^- $h" || miss="$miss [$h]"
done
[ -z "$miss" ] && ok "EPIC template header carries Brief, Part and Depends on" || bad "EPIC template header missing:$miss"
# 10c. The split rules and stub shape live in the reference so plan.md and the planner
#      stay pointer-only; a missing rule leaves the planner to cut mid-story.
miss=""
for s in 'release-signal' 'contract seam' 'never mid-story' 'Status: STUB' 'Part: k of N' 'Depends on:' 'estimate' 'depends_on' 'RESOLVED' 'OPEN ARCH' 'Artifacts'; do
  grep -qF -- "$s" "$REF" || miss="$miss [$s]"
done
grep -qE '^## SPLIT' "$REF" || miss="$miss [## SPLIT heading]"
grep -qE '^## STUB' "$REF" || miss="$miss [## STUB heading]"
[ -z "$miss" ] && ok "epic-budget.md states the split rules and stub shape" || bad "epic-budget.md missing:$miss"
# 10d. A stub is checked like any epic; a stub-only rule in check would force the
#      fill-in step to delete content just to pass.
printf '# EPIC-40: stub part\n\n- Brief: docs/briefs/x.md\n- Part: 2 of 2\n- Depends on: EPIC-1\n- Outcome: later half\n- Status: STUB\n\n## Stories\n\n### STORY-40-1: a\n- estimate: M\n- depends_on: []\n\n### STORY-40-2: b\n- estimate: M\n- depends_on: [STORY-40-1]\n' > "$TMP/chk/backlog/EPIC-40.md"
out=$(chk EPIC-40); rc=$?
[ $rc -eq 0 ] && ok "check passes a stub in the template shape" || bad "stub rejected: rc=$rc out=$out"
# 10e. /plan must run check on what it wrote, allow one re-split, and stop on a
#      second failure; the protocol stays in the reference to fit plan.md's byte cap.
PLANMD="$ROOT/plugins/agentic-sdlc/commands/plan.md"
miss=""
for s in 'plan-artifacts.mjs check' 're-split' 'still over' 'SPLIT'; do
  grep -qF -- "$s" "$PLANMD" || miss="$miss [$s]"
done
[ -z "$miss" ] && ok "plan.md runs check, re-splits once, and stops on still over" || bad "plan.md missing:$miss"
s3=$(sed -n '/^## STEP 3/,/^## /p' "$PLANMD")
ln() { printf '%s\n' "$s3" | grep -nF -- "$1" | head -1 | cut -d: -f1; }
[ "$(ln 'plan-artifacts.mjs check')" -gt "$(ln 'mode-select.mjs record')" ] && [ "$(ln 'plan-artifacts.mjs check')" -gt "$(ln 'Artifacts:')" ] \
  && ok "plan.md checks the epic after its last write" || bad "check runs before Artifacts/record writes"
[ "$(wc -c < "$PLANMD")" -le 2493 ] && ok "plan.md within its byte cap" || bad "plan.md over 2493 bytes"
# 10f. The REPORT must show build order with points and dependencies, so a split
#      brief reads as a sequence of reviewable PRs.
rpt=$(sed -n '/^## REPORT/,$p' "$PLANMD")
miss=""
for s in 'Points' 'Depends on' 'build order'; do
  printf '%s' "$rpt" | grep -qiF -- "$s" || miss="$miss [$s]"
done
[ -z "$miss" ] && ok "plan.md REPORT lists epics in build order with points and Depends on" || bad "REPORT missing:$miss"
# 10g. A brief within the cap must stay one epic; without a stated default the planner
#      may split needlessly or leave the new header lines blank.
sec=$(sed -n '/^## SPLIT/,/^## STUB/p' "$REF")
miss=""
for s in 'within the cap' 'Part: 1 of 1' 'Depends on: none'; do
  printf '%s' "$sec" | grep -qF -- "$s" || miss="$miss [$s]"
done
[ -z "$miss" ] && ok "epic-budget.md keeps a within-cap brief as one epic, Part 1 of 1" || bad "SPLIT missing:$miss"
# 11. ready: stub refusal and merged-dependency anchoring against origin/<base>.
rdy() { (cd "$TMP/rw" && node "$PA" ready "$@" 2>&1); }
g init -q --bare "$TMP/rorigin.git"
g init -q "$TMP/rw" && cd "$TMP/rw"
mkdir backlog
printf '# EPIC-1\n\n## Stories\n\n### STORY-1-1: a\n- estimate: S\n\n### STORY-1-2: b\n- estimate: S\n' > backlog/EPIC-1.md
g add . && g commit -qm "feat: one [STORY-1-1]"
g remote add origin "$TMP/rorigin.git" && g push -q origin main && g fetch -q origin main
rdep() { printf '# %s\n- Depends on: %s\n\n## Stories\n\n### STORY-9-1: s\n- estimate: S\n' "$1" "$2" > "$TMP/rw/backlog/$1.md"; }
printf '# EPIC-30\n- Status: STUB\n\n## Stories\n\n### STORY-30-1: s\n- estimate: S\n' > backlog/EPIC-30.md
out=$(rdy EPIC-30 --base main); rc=$?
[ $rc -ne 0 ] && [ "$out" = "EPIC-30 is a stub: run /plan EPIC-30 first" ] && ok "ready refuses a stub epic" || bad "stub: rc=$rc out=$out"
out=$(rdy EPIC-30 --base main --deps-only); rc=$?
[ $rc -eq 0 ] && ok "ready --deps-only skips the stub rule" || bad "deps-only stub: rc=$rc out=$out"
rdep EPIC-31 "EPIC-77 (merged)"
out=$(rdy EPIC-31 --base main); rc=$?
[ $rc -eq 3 ] && [ "$(echo "$out" | wc -l)" -eq 1 ] && echo "$out" | grep -q 'EPIC-77' && ok "ready exits 3 naming a dependency absent from origin/main" || bad "absent dep: rc=$rc out=$out"
rdep EPIC-32 "EPIC-1 (merged)"
out=$(rdy EPIC-32 --base main); rc=$?
[ $rc -eq 3 ] && echo "$out" | grep -q 'EPIC-1 ' && echo "$out" | grep -q 'STORY-1-2' && ! echo "$out" | grep -q 'STORY-1-1' \
  && ok "ready names the first story with no [STORY-id] commit" || bad "missing story: rc=$rc out=$out"
g commit -q --allow-empty -m "feat: two [STORY-1-2]" && g push -q origin main && g fetch -q origin main
out=$(rdy EPIC-32 --base main); rc=$?
[ $rc -eq 0 ] && ok "ready passes once every story is on origin/main" || bad "merged dep: rc=$rc out=$out"
rdep EPIC-33 "EPIC-5 (released), EPIC-6 (released)"
out=$(rdy EPIC-33 --base main); [ $? -eq 0 ] && ok "ready passes released dependencies" || bad "released: $out"
rdep EPIC-34 "none"
out=$(rdy EPIC-34 --base main); [ $? -eq 0 ] && ok "ready passes Depends on: none" || bad "none: $out"
printf '# EPIC-35\n\n## Stories\n\n### STORY-35-1: s\n- estimate: S\n' > backlog/EPIC-35.md
out=$(rdy EPIC-35 --base main); [ $? -eq 0 ] && ok "ready passes an epic with no Depends-on header" || bad "no header: $out"
out=$(rdy EPIC-99 --base main); [ $? -ne 0 ] && ok "ready fails when the epic file is missing" || bad "missing epic passed"
printf '# EPIC-36\n\n## Stories\n' > backlog/EPIC-36.md
out=$(rdy EPIC-36 --base main); [ $? -ne 0 ] && ok "ready fails an epic with no STORY blocks" || bad "no stories passed"
# Shallow clone: a story outside the fetched history must fail closed with the unshallow hint.
g commit -q --allow-empty -m "chore: pad" && g push -q origin main
g clone -q --depth 1 "file://$TMP/rorigin.git" "$TMP/rshallow" && mkdir -p "$TMP/rshallow/backlog"
cp "$TMP/rw/backlog/EPIC-32.md" "$TMP/rshallow/backlog/"
out=$(cd "$TMP/rshallow" && node "$PA" ready EPIC-32 --base main 2>&1); rc=$?
[ $rc -eq 3 ] && echo "$out" | grep -q 'git fetch --unshallow origin main' && ok "ready fails closed in a shallow checkout" || bad "shallow: rc=$rc out=$out"
# A stale origin/<base>: the dependency merged after the last fetch. ready fetches first.
g clone -q "file://$TMP/rorigin.git" "$TMP/rstale" && mkdir -p "$TMP/rstale/backlog"
printf '# EPIC-38\n- Depends on: EPIC-2 (merged)\n\n## Stories\n\n### STORY-38-1: s\n- estimate: S\n' > "$TMP/rstale/backlog/EPIC-38.md"
printf '# EPIC-2\n\n## Stories\n\n### STORY-2-1: a\n- estimate: S\n' > backlog/EPIC-2.md
g add backlog/EPIC-2.md && g commit -qm "feat: two [STORY-2-1]" && g push -q origin main
out=$(cd "$TMP/rstale" && node "$PA" ready EPIC-38 --base main 2>&1); rc=$?
[ $rc -eq 0 ] && ok "ready fetches origin/<base> before judging a dependency" || bad "stale: rc=$rc out=$out"

# 12. Fill-in: a stub whose merged dependency is unmerged must stop before the planner
#     touches it, and /plan must route EPIC-<n> there without growing past its cap.
printf '# EPIC-37\n- Depends on: EPIC-77 (merged)\n- Status: STUB\n\n## Stories\n\n### STORY-37-1: s\n- estimate: S\n' > backlog/EPIC-37.md
before=$(cksum < backlog/EPIC-37.md)
out=$(rdy EPIC-37 --base main --deps-only); rc=$?
[ $rc -eq 3 ] && [ "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" = 1 ] && [ "$before" = "$(cksum < backlog/EPIC-37.md)" ] \
  && ok "deps-only stops an unmerged stub with one line and leaves it unchanged" || bad "stub deps: rc=$rc out=$out"
fill=$(sed -n '/^## FILL-IN/,/^## /p' "$PLANMD")
miss=""
for s in 'EPIC-<n>' '--deps-only' 'STUB' 'epic-budget.md'; do
  printf '%s' "$fill" | grep -qF -- "$s" || miss="$miss [$s]"
done
printf '%s' "$fill" | grep -qiE 'refus|not a stub' || miss="$miss [refusal of a non-STUB]"
printf '%s' "$fill" | grep -qF -- 'ready EPIC-<n> --base <base> --deps-only' || miss="$miss [ready needs --base]"
[ -z "$miss" ] && ok "plan.md has a FILL-IN section: deps-only gate, STUB only, protocol in the reference" || bad "FILL-IN missing:$miss"

# 13. The fill-in protocol lives in the reference; without each rule the planner may claim a
#     new number, re-split an over-cap result, or leave the stub's Status unchanged.
fi=$(sed -n '/^## FILL-IN/,$p' "$REF")
miss=""
for s in 'Brief:' 'no new claim' 'merged code' 'architect' 'check' 'Status: TODO' 're-split'; do
  printf '%s' "$fi" | grep -qF -- "$s" || miss="$miss [$s]"
done
printf '%s' "$fi" | grep -qiE 'only (that part|the part)|that part.s stories' || miss="$miss [limited to the part's stories]"
printf '%s' "$fi" | grep -qiE 'over the cap.*(report|stop)|(report|stop).*over the cap' || miss="$miss [over cap reports and stops]"
[ -z "$miss" ] && ok "epic-budget.md has a FILL-IN protocol" || bad "FILL-IN protocol missing:$miss"

# 14. claim --id takes the named id, not the next free number: parallel planners
#     name their own id so they never race for the same one.
cd "$TMP/main"
before=$(ls backlog | wc -l)
out=$(node "$PA" claim EPIC --id EPIC-9 2>/dev/null); rc=$?
[ $rc -eq 0 ] && [ "$out" = "backlog/EPIC-9.md" ] \
  && ok "claim --id prints the named path" || bad "claim --id: rc=$rc out='$out'"
[ "$(head -1 backlog/EPIC-9.md 2>/dev/null)" = "# EPIC-9: (claimed — planner writes this file)" ] \
  && ok "claim --id writes the same stub line as auto-numbering" || bad "stub line wrong or file missing"
[ "$(ls backlog | wc -l)" -eq $((before + 1)) ] \
  && ok "claim --id creates exactly one file" || bad "claim --id created extra files"

# 15. A named id that already exists anywhere is an error naming where, never a bump to
#     the next number and never a write: the caller reserved it, so a silent change
#     would hand two planners different ids for one plan.
blob=$(echo "# EPIC-20" | g hash-object -w --stdin)
tree=$(printf '100644 blob %s\tEPIC-20.md\n' "$blob" | g mktree)
subtree=$(printf '040000 tree %s\tbacklog\n' "$tree" | g mktree)
commit=$(echo ref-only | g commit-tree "$subtree")
g update-ref refs/heads/ghost "$commit"
g update-ref refs/remotes/origin/far "$commit"
g branch -q -D ghost
g update-ref refs/heads/ghost-local "$commit"
before=$(ls backlog | wc -l)

err=$(node "$PA" claim FAST --id FAST-5 2>&1 >/dev/null); rc=$?
[ $rc -ne 0 ] && printf '%s' "$err" | grep -qF "wt" \
  && ok "claim --id refuses an id held by another worktree and names it" || bad "other worktree: rc=$rc err='$err'"

err=$(node "$PA" claim EPIC --id EPIC-9 2>&1 >/dev/null); rc=$?
[ $rc -ne 0 ] && ok "claim --id refuses an id already in this worktree" || bad "own worktree: rc=$rc"

err=$(node "$PA" claim EPIC --id EPIC-20 2>&1 >/dev/null); rc=$?
[ $rc -ne 0 ] && printf '%s' "$err" | grep -qE "ghost-local|origin/far" \
  && ok "claim --id refuses an id on a ref and names the ref" || bad "ref: rc=$rc err='$err'"

g update-ref -d refs/heads/ghost-local
err=$(node "$PA" claim EPIC --id EPIC-20 2>&1 >/dev/null); rc=$?
[ $rc -ne 0 ] && printf '%s' "$err" | grep -qF "origin/far" \
  && ok "claim --id refuses an id on a remote ref and names it" || bad "remote ref: rc=$rc err='$err'"

[ "$(ls backlog | wc -l)" -eq "$before" ] && [ ! -e backlog/EPIC-21.md ] \
  && ok "a refused claim --id writes nothing" || bad "refused claim wrote a file"

# 16. A malformed id or one whose prefix is another kind is rejected up front: it would
#     otherwise become a path outside the numbered scheme or a plan of the wrong kind.
before=$(ls backlog | wc -l)
for bad_id in "FAST-77" "EPIC-x" "EPIC-" "epic-77" "EPIC-77.md" "EPIC-7/../x" "77"; do
  node "$PA" claim EPIC --id "$bad_id" >/dev/null 2>&1; rc=$?
  [ $rc -ne 0 ] && ok "claim EPIC --id '$bad_id' is rejected" || bad "claim EPIC --id '$bad_id' accepted"
done
[ "$(ls backlog | wc -l)" -eq "$before" ] && [ ! -e backlog/EPIC-77.md ] && [ ! -e backlog/FAST-77.md ] \
  && ok "a rejected id writes nothing" || bad "rejected id wrote a file"

tmp_race=$(mktemp -u)
# 17. Two planners racing on the same named id: the loser must fail, naming the id as
#     taken, not report an exhausted numbering search that never happened.
rm -f backlog/EPIC-31.md
for i in 1 2 3 4 5 6; do
  rm -f backlog/EPIC-31.md
  node "$PA" claim EPIC --id EPIC-31 >/dev/null 2>"$tmp_race.a" & pa=$!
  node "$PA" claim EPIC --id EPIC-31 >/dev/null 2>"$tmp_race.b" & pb=$!
  wait $pa; ra=$?; wait $pb; rb=$?
  wins=0; [ $ra -eq 0 ] && wins=$((wins+1)); [ $rb -eq 0 ] && wins=$((wins+1))
  [ $wins -eq 1 ] || break
done
[ $wins -eq 1 ] && ok "concurrent claim --id: exactly one wins" || bad "concurrent claim --id: $wins winners"
loser_err=$(cat "$tmp_race.a" "$tmp_race.b")
printf '%s' "$loser_err" | grep -qF "EPIC-31" && ! printf '%s' "$loser_err" | grep -qi "no free" \
  && ok "the losing claim --id says the id is taken" || bad "loser message: '$loser_err'"
[ ! -e backlog/EPIC-32.md ] && ok "the loser does not fall through to another number" || bad "loser took EPIC-32"
rm -f "$tmp_race.a" "$tmp_race.b"

# 18. The flag is only useful if the instructions a planner follows pass it through.
PLUG="$ROOT/plugins/agentic-sdlc"
for doc in commands/plan.md reference/plan-artifacts.md reference/fast-mode.md; do
  grep -qE -- "claim (EPIC|FAST).*--id" "$PLUG/$doc" && ok "$doc documents --id" || bad "$doc does not mention --id"
done
[ "$(wc -c < "$PLUG/commands/plan.md")" -le 2493 ] \
  && ok "commands/plan.md stays within its boot-size cap" || bad "commands/plan.md exceeds its 2493 B cap"
# 19. resume: an earlier session pushed feat/<id>; /build must check that branch out (tracking,
#     no -b) so the committed plan is the plan built, instead of dying on `worktree add -b`.
RS="$TMP/resume"; mkdir -p "$RS"
g init -q --bare "$RS/origin.git"
g clone -q "$RS/origin.git" "$RS/seed" 2>/dev/null
( cd "$RS/seed" && g checkout -qb main && echo base > base.txt && g add . && g commit -qm base && g push -q origin main \
  && g checkout -qb feat/EPIC-5 && mkdir backlog && echo '# EPIC-5: committed plan' > backlog/EPIC-5.md \
  && g add . && g commit -qm 'docs: add EPIC-5 plan' && g push -q origin feat/EPIC-5 )
g clone -q "$RS/origin.git" "$RS/plan" 2>/dev/null
( cd "$RS/plan" && g checkout -q main && node "$PA" resume EPIC-5 --base main >/dev/null 2>&1 ); rc=$?
br=$(g -C "$RS/wt-EPIC-5" rev-parse --abbrev-ref HEAD 2>/dev/null)
up=$(g -C "$RS/wt-EPIC-5" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)
planned=$(cat "$RS/wt-EPIC-5/backlog/EPIC-5.md" 2>/dev/null)
[ $rc -eq 0 ] && [ "$br" = "feat/EPIC-5" ] && [ "$up" = "origin/feat/EPIC-5" ] && [ "$planned" = "# EPIC-5: committed plan" ] \
  && ok "resume checks out the pushed branch tracking origin, with its committed plan" \
  || bad "resume: rc=$rc branch='$br' upstream='$up' plan='$planned'"

# 20. resume: base moved on after the branch was pushed; merging (never rebasing) brings it in
#     while the pushed commits stay ancestors, since rewriting them needs a denied force push.
MG="$TMP/merge"; mkdir -p "$MG"
g init -q --bare "$MG/origin.git"
g clone -q "$MG/origin.git" "$MG/seed" 2>/dev/null
( cd "$MG/seed" && g checkout -qb main && echo base > base.txt && g add . && g commit -qm base && g push -q origin main \
  && g checkout -qb feat/EPIC-6 && mkdir backlog && echo '# EPIC-6: plan' > backlog/EPIC-6.md \
  && g add . && g commit -qm 'docs: add EPIC-6 plan' && g push -q origin feat/EPIC-6 \
  && g checkout -q main && echo later > later.txt && g add . && g commit -qm 'feat: later' && g push -q origin main )
g clone -q "$MG/origin.git" "$MG/plan" 2>/dev/null
pushed=$(g -C "$MG/seed" rev-parse origin/feat/EPIC-6)
( cd "$MG/plan" && g checkout -q main && node "$PA" resume EPIC-6 --base main >/dev/null 2>&1 ); rc=$?
merged=$(cat "$MG/wt-EPIC-6/later.txt" 2>/dev/null)
parents=$(g -C "$MG/wt-EPIC-6" rev-list --parents -n1 HEAD 2>/dev/null | wc -w)
g -C "$MG/wt-EPIC-6" merge-base --is-ancestor "$pushed" HEAD 2>/dev/null; anc=$?
[ $rc -eq 0 ] && [ "$merged" = later ] && [ "$parents" -eq 3 ] && [ $anc -eq 0 ] \
  && ok "resume merges origin/<base> into the branch and keeps pushed history" \
  || bad "resume merge: rc=$rc later='$merged' parents=$parents ancestor=$anc"

# 21. resume: a conflicting base is never resolved for the user; the merge is aborted so the
#     branch stays exactly as pushed, and the report names the paths and both shas.
CF="$TMP/conflict"; mkdir -p "$CF"
g init -q --bare "$CF/origin.git"
g clone -q "$CF/origin.git" "$CF/seed" 2>/dev/null
( cd "$CF/seed" && g checkout -qb main && echo base > shared.txt && g add . && g commit -qm base && g push -q origin main \
  && g checkout -qb feat/EPIC-8 && echo branch-side > shared.txt && g add . && g commit -qm 'docs: branch edit' && g push -q origin feat/EPIC-8 \
  && g checkout -q main && echo main-side > shared.txt && g add . && g commit -qm 'feat: main edit' && g push -q origin main )
g clone -q "$CF/origin.git" "$CF/plan" 2>/dev/null
cpushed=$(g -C "$CF/seed" rev-parse origin/feat/EPIC-8)
cbase=$(g -C "$CF/seed" rev-parse origin/main)
cerr=$( cd "$CF/plan" && g checkout -q main && node "$PA" resume EPIC-8 --base main 2>&1 >/dev/null ); rc=$?
chead=$(g -C "$CF/wt-EPIC-8" rev-parse HEAD 2>/dev/null)
cstat=$(g -C "$CF/wt-EPIC-8" status --porcelain 2>/dev/null)
cfile=$(cat "$CF/wt-EPIC-8/shared.txt" 2>/dev/null)
[ $rc -ne 0 ] && [ "$chead" = "$cpushed" ] && [ -z "$cstat" ] && [ "$cfile" = branch-side ] \
  && printf '%s' "$cerr" | grep -qF shared.txt && printf '%s' "$cerr" | grep -qF "$cpushed" && printf '%s' "$cerr" | grep -qF "$cbase" \
  && ok "resume aborts a conflicting merge, leaves the branch as pushed, reports paths and shas" \
  || bad "resume conflict: rc=$rc head=$chead status='$cstat' file='$cfile' err='$cerr'"

# 22. resume: with no branch anywhere, behaviour is today's `worktree add -b` off origin/<base>,
#     so /build can call resume unconditionally.
NB="$TMP/nobranch"; mkdir -p "$NB"
g init -q --bare "$NB/origin.git"
g clone -q "$NB/origin.git" "$NB/seed" 2>/dev/null
( cd "$NB/seed" && g checkout -qb main && echo base > base.txt && g add . && g commit -qm base && g push -q origin main )
g clone -q "$NB/origin.git" "$NB/plan" 2>/dev/null
nbase=$(g -C "$NB/seed" rev-parse origin/main)
( cd "$NB/plan" && g checkout -q main && node "$PA" resume EPIC-9 --base main >/dev/null 2>&1 ); rc=$?
nbr=$(g -C "$NB/wt-EPIC-9" rev-parse --abbrev-ref HEAD 2>/dev/null)
nhead=$(g -C "$NB/wt-EPIC-9" rev-parse HEAD 2>/dev/null)
[ $rc -eq 0 ] && [ "$nbr" = "feat/EPIC-9" ] && [ "$nhead" = "$nbase" ] \
  && ok "resume with no existing branch creates feat/<id> off origin/<base>" \
  || bad "resume fresh: rc=$rc branch='$nbr' head='$nhead' base='$nbase'"

# 23. resume: a local-only feat/<id> is the plan an earlier session committed; reuse it rather
#     than failing on `-b` or minting a second branch.
LB="$TMP/localbranch"; mkdir -p "$LB"
g init -q --bare "$LB/origin.git"
g clone -q "$LB/origin.git" "$LB/plan" 2>/dev/null
( cd "$LB/plan" && g checkout -qb main && echo base > base.txt && g add . && g commit -qm base && g push -q origin main \
  && g checkout -qb feat/EPIC-10 && echo plan > plan.txt && g add . && g commit -qm 'docs: plan' && g checkout -q main )
lcommit=$(g -C "$LB/plan" rev-parse feat/EPIC-10)
( cd "$LB/plan" && node "$PA" resume EPIC-10 --base main >/dev/null 2>&1 ); rc=$?
lbr=$(g -C "$LB/wt-EPIC-10" rev-parse --abbrev-ref HEAD 2>/dev/null)
lhead=$(g -C "$LB/wt-EPIC-10" rev-parse HEAD 2>/dev/null)
lcount=$(g -C "$LB/plan" branch --list 'feat/EPIC-10*' | wc -l | tr -d ' ')
[ $rc -eq 0 ] && [ "$lbr" = "feat/EPIC-10" ] && [ "$lhead" = "$lcommit" ] && [ "$lcount" = 1 ] \
  && ok "resume reuses a local feat/<id> that was never pushed" \
  || bad "resume local: rc=$rc branch='$lbr' head='$lhead' want='$lcommit' branches=$lcount"

# 24. carry on a resumed branch: the plan is already tracked there and the planning checkout never
#     had it, so carry must be a no-op rather than die on the missing source.
before=$(g -C "$RS/wt-EPIC-5" rev-parse HEAD)
( cd "$RS/wt-EPIC-5" && node "$PA" carry EPIC-5 --from "$RS/plan" >/dev/null 2>&1 ); rc=$?
after=$(g -C "$RS/wt-EPIC-5" rev-parse HEAD)
dirty=$(g -C "$RS/wt-EPIC-5" status --porcelain)
[ $rc -eq 0 ] && [ "$before" = "$after" ] && [ -z "$dirty" ] \
  && ok "carry skips when the plan is already tracked on a resumed branch" \
  || bad "carry resumed: rc=$rc head $before -> $after dirty='$dirty'"

[ "$fail" -eq 0 ] || { printf '\nplan-artifacts tests failed\n' >&2; exit 1; }
printf '\nplan-artifacts tests passed\n'
