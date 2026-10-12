#!/usr/bin/env bash
#
# gh-rest-only.test.sh — the guard that keeps shipped content off gh's
# GraphQL-backed subcommands, which cloud sessions block.
#
# The guard is scripts/check-gh-rest-only.sh [<plugin-root>]; it exits non-zero
# and names each offending file:line. Defaults to plugins/agentic-sdlc.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/scripts/check-gh-rest-only.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

fresh() {
  rm -rf "$TMP/p" && mkdir -p "$TMP/p"/{commands,agents,reference,scripts}
  printf 'Use `gh api repos/{owner}/{repo}/pulls/1`.\nNever `gh pr checkout` here.\n' > "$TMP/p/commands/ok.md"
}

fresh
if out=$(bash "$CHECK" "$TMP/p" 2>&1); then ok "clean tree passes"; else bad "clean tree failed: $out"; fi

for sub in "pr view 3 --json state" "pr list" "pr checks 3" "pr review 3 --approve" "pr comment 3 --body x" "pr create --fill" "issue list"; do
  for dir in commands agents reference scripts; do
    fresh
    ext=md; [ "$dir" = scripts ] && ext=mjs
    printf 'intro\nrun gh %s now\n' "$sub" > "$TMP/p/$dir/planted.$ext"
    out=$(bash "$CHECK" "$TMP/p" 2>&1); rc=$?
    if [ "$rc" -ne 0 ] && grep -q "$dir/planted.$ext:2" <<< "$out"; then
      ok "gh $sub in $dir flagged with file:line"
    else
      bad "gh $sub in $dir not flagged (rc=$rc): $out"
    fi
  done
done

# A test fixture may legitimately spell a banned call to prove it is refused.
fresh
printf 'gh pr view 3\n' > "$TMP/p/scripts/thing.test.sh"
if out=$(bash "$CHECK" "$TMP/p" 2>&1); then ok "*.test.sh fixtures are exempt"; else bad "test fixture flagged: $out"; fi

exit "$fail"
