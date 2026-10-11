#!/usr/bin/env bash
#
# signal-sync.test.sh — issue matching and update under plain Node with a stubbed
# gh adapter, so preflight and CI never touch the network.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$ROOT/scripts/signal-sync.test.mjs"
