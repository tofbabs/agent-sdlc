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

# 10. ready: stub refusal and merged-dependency anchoring against origin/<base>.
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

[ "$fail" -eq 0 ] || { printf '\nplan-artifacts tests failed\n' >&2; exit 1; }
printf '\nplan-artifacts tests passed\n'
