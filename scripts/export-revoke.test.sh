#!/usr/bin/env bash
#
# export-revoke.test.sh — client revoke: when local state is dropped and when
# it must survive for a retry.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/scripts/export-revoke.test.mjs"
