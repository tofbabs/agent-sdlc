#!/usr/bin/env bash
#
# signal-scan.test.sh — the re-validation stage under plain Node on temp dirs,
# so preflight and CI need neither a store nor the network.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$ROOT/scripts/signal-scan.test.mjs"
