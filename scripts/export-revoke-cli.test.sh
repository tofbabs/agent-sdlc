#!/usr/bin/env bash
#
# export-revoke-cli.test.sh — the `export-identity.mjs revoke` entry point:
# exit code, URL selection and silence when there is nothing to revoke.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/scripts/export-revoke-cli.test.mjs"
