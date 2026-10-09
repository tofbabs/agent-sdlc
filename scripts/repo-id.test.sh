#!/usr/bin/env bash
#
# repo-id.test.sh — the anonymous repo ID (STORY-4-2): a per-clone random
# salt, stable across worktrees, and nothing identifying anywhere in it.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RID="$ROOT/plugins/agentic-sdlc/scripts/repo-id.mjs"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  \xe2\x9c\x93 %s\n' "$*"; }
bad() { printf '  \xe2\x9c\x97 %s\n' "$*" >&2; fail=1; }

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
mkrepo() {
  git init -q "$1" && git -C "$1" commit -q --allow-empty -m init
}

REPO="$TMP/zebrafish-quux-project"
mkrepo "$REPO"
git -C "$REPO" remote add origin "https://example.invalid/glorbnax-org/zebrafish-quux-project.git"

ID1="$(node "$RID" --cwd "$REPO")"
[[ "$ID1" =~ ^[0-9a-f]{64}$ ]] && ok "fresh derive is 64 lowercase hex" || bad "bad id: $ID1"

ID2="$(node "$RID" --cwd "$REPO")"
[ "$ID1" = "$ID2" ] && ok "re-derive is byte-identical" || bad "re-derive changed: $ID1 vs $ID2"

git -C "$REPO" worktree add -q "$TMP/wt" -b side
ID3="$(node "$RID" --cwd "$TMP/wt")"
[ "$ID1" = "$ID3" ] && ok "a second worktree of the same clone gets the same ID" || bad "worktree id differs"

OTHER="$TMP/other"
mkrepo "$OTHER"
ID4="$(node "$RID" --cwd "$OTHER")"
[ "$ID1" != "$ID4" ] && ok "a different clone gets a different ID" || bad "two clones share an ID"

# Two worktrees deriving at once on a fresh clone must end with one salt.
RACE="$TMP/race"
mkrepo "$RACE"
git -C "$RACE" worktree add -q "$TMP/racewt" -b side
for n in 1 2 3 4; do
  node "$RID" --cwd "$RACE" > "$TMP/r$n" &
  node "$RID" --cwd "$TMP/racewt" > "$TMP/o$n" &
done
wait
[ "$(cat "$TMP"/r? "$TMP"/o? | sort -u | wc -l | tr -d ' ')" = 1 ] \
  && ok "concurrent first derivations converge on one ID" || bad "race produced several IDs"

# AC3: nothing identifying in the ID or in any file the export dir holds.
EXP="$REPO/.git/agentic-sdlc/export"
HOST="$(hostname)"; HOSTSHORT="${HOST%%.*}"
ME="$(id -un)"
leak=0
for needle in zebrafish glorbnax example.invalid "$HOST" "$HOSTSHORT" "$ME"; do
  [ -n "$needle" ] || continue
  if grep -rqiF -- "$needle" "$EXP"; then
    # A short user/host name can occur in random hex by chance; only flag it
    # when it is not purely hex characters.
    if [[ "$needle" =~ ^[0-9a-f]+$ ]]; then continue; fi
    bad "export dir contains '$needle'"; leak=1
  fi
done
[ "$leak" -eq 0 ] && ok "no repo name, remote, user or hostname in the ID or any export file"

mode="$(stat -f %Lp "$EXP/repo-id.salt" 2>/dev/null || stat -c %a "$EXP/repo-id.salt")"
[ "$mode" = 600 ] && ok "salt file is mode 0600" || bad "salt mode $mode"

LEAKID="$(USER=zebrafish node "$RID" --cwd "$REPO")"
[ "$LEAKID" = "$ID1" ] && ok "ID does not depend on the environment's USER" || bad "ID varies with USER"

[ "$fail" -eq 0 ] || { printf '\nrepo-id tests failed\n' >&2; exit 1; }
printf '\nrepo-id tests passed\n'
