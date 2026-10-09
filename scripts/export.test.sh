#!/usr/bin/env bash
#
# export.test.sh — the export client's queue, backoff and kill-switch behaviour,
# run against a local stub server only (no external network).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node --test "$ROOT/scripts/export.test.mjs" || { printf '\nexport tests failed\n' >&2; exit 1; }
printf '\nexport tests passed\n'
