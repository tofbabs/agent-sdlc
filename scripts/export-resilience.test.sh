#!/usr/bin/env bash
#
# export-resilience.test.sh — the export client's queue, backoff and kill-switch behaviour,
# run against a local stub server only (no external network).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node --test "$ROOT/scripts/export-resilience.test.mjs" || { printf '\nexport resilience tests failed\n' >&2; exit 1; }
printf '\nexport resilience tests passed\n'
