#!/usr/bin/env bash
#
# signal-render.test.sh — the issue renderer under plain Node, so preflight and
# CI need neither a store nor the network.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$ROOT/scripts/signal-render.test.mjs"
