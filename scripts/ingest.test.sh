#!/usr/bin/env bash
#
# ingest.test.sh — the edge handler under plain Node against an in-memory db,
# so preflight and CI need neither wrangler nor the network.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$ROOT/scripts/ingest.test.mjs"
