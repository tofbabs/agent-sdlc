#!/usr/bin/env bash
#
# ingest-retention.test.sh — deletion scoping and the retention sweep, run
# against the in-memory db so a wrong WHERE clause shows up without wrangler.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$ROOT/scripts/ingest-retention.test.mjs"
node "$ROOT/scripts/ingest-schedule.test.mjs"
