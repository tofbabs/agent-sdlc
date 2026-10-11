#!/usr/bin/env bash
#
# export-outcomes.test.sh — outcome events, decisions and settlements leave in the
# same report payload as the rest, keyed by decision_id only. Local stub only.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

node --test "$ROOT/scripts/export-outcomes.test.mjs" || { printf '\nexport outcomes tests failed\n' >&2; exit 1; }
printf '\nexport outcomes tests passed\n'
