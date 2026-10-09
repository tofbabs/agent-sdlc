#!/usr/bin/env bash
#
# ingest-limits.test.sh — /v1/register rate limits against the in-memory db.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$ROOT/scripts/ingest-limits.test.mjs"
