#!/usr/bin/env bash
#
# export-identity.test.sh — client identity for report export: registration,
# token storage and reuse, against a local stub server on 127.0.0.1.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/scripts/export-identity.test.mjs"
