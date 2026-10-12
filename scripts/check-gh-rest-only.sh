#!/usr/bin/env bash
#
# check-gh-rest-only.sh [<plugin-root>] — fail on gh subcommands that ride
# GraphQL. Cloud sessions block GraphQL, so shipped content must use
# `gh api` REST routes. `gh pr checkout` is plain git underneath and allowed.
# *.test.sh files are skipped: fixtures spell banned calls to prove refusal.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="${1:-$ROOT/plugins/agentic-sdlc}"

dirs=()
for d in commands agents reference scripts; do
  [ -d "$PLUGIN/$d" ] && dirs+=("$PLUGIN/$d")
done
[ "${#dirs[@]}" -gt 0 ] || exit 0

hits=$(grep -rnE --exclude='*.test.sh' 'gh +(pr +(view|list|checks|review|comment|create)|issue)\b' "${dirs[@]}" || true)

if [ -n "$hits" ]; then
  printf '%s\n' "$hits" >&2
  exit 1
fi
