#!/usr/bin/env bash
#
# export-identity-more.test.sh — cooldown edges, worktree convergence and
# token confinement for export identity.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/scripts/export-identity-more.test.mjs"
