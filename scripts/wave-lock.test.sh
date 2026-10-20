#!/usr/bin/env bash
#
# wave-lock.test.sh — a stuck phase must be detected the same way every time,
# so each rule is pinned against a JSON payload; the script never calls gh.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WL="$ROOT/plugins/agentic-sdlc/scripts/wave-lock.mjs"

fail=0
ok()  { printf '  ✓ %s\n' "$*"; }
bad() { printf '  ✗ %s\n' "$*" >&2; fail=1; }

run() { printf '%s' "$1" | node "$WL" 2>&1; }
check() { # name, payload, expected json line
  local got; got=$(run "$2")
  [ "$got" = "$3" ] && ok "$1" || bad "$1: got '$got', want '$3'"
}

NOW='2026-01-02T12:00:00Z'
T='"timeouts":{"plan":60,"build":240}'
m() { printf '{"body":"<!-- wave-run phase=%s started=%s -->"}' "$1" "$2"; }

check "label plus fresh marker reports held with phase and start" \
"{\"labels\":[\"brief\",\"phase-running\"],\"comments\":[$(m build 2026-01-02T10:00:00Z)],\"now\":\"$NOW\",$T}" \
'{"ok":true,"outcome":"held","lock":{"held":true,"phase":"build","started":"2026-01-02T10:00:00Z","stale":false}}'

check "no label means free even with an old marker" \
"{\"labels\":[\"brief\"],\"comments\":[$(m plan 2026-01-01T00:00:00Z)],\"now\":\"$NOW\",$T}" \
'{"ok":true,"outcome":"free","lock":{"held":false}}'

check "plan past 60m is stale and counts as one failed attempt" \
"{\"labels\":[\"phase-running\"],\"comments\":[$(m plan 2026-01-02T10:30:00Z)],\"now\":\"$NOW\",$T}" \
'{"ok":true,"outcome":"cleared","phase":"plan","lock":{"held":true,"phase":"plan","started":"2026-01-02T10:30:00Z","stale":true},"attempts":1}'

check "the same age is still held for build, whose timeout is 4h" \
"{\"labels\":[\"phase-running\"],\"comments\":[$(m build 2026-01-02T10:30:00Z)],\"now\":\"$NOW\",$T}" \
'{"ok":true,"outcome":"held","lock":{"held":true,"phase":"build","started":"2026-01-02T10:30:00Z","stale":false}}'

check "two failed attempts block the phase" \
"{\"labels\":[\"phase-running\"],\"comments\":[$(m build 2026-01-01T01:00:00Z),$(m build 2026-01-02T01:00:00Z)],\"now\":\"$NOW\",$T}" \
'{"ok":true,"outcome":"blocked","phase":"build","lock":{"held":true,"phase":"build","started":"2026-01-02T01:00:00Z","stale":true},"attempts":2}'

# A reopened brief keeps its old comments; only runs since its current wave label count.
TWO="$(m build 2026-01-01T01:00:00Z),$(m build 2026-01-01T06:00:00Z)"
check "two stale runs older than wave_labeled_at and none after: one failure, not blocked" \
"{\"labels\":[\"phase-running\"],\"comments\":[$TWO],\"now\":\"$NOW\",\"wave_labeled_at\":\"2026-01-01T20:00:00Z\",$T}" \
'{"ok":true,"outcome":"cleared","phase":"build","lock":{"held":true,"phase":"build","started":"2026-01-01T06:00:00Z","stale":true},"attempts":1}'

check "the same two after wave_labeled_at block" \
"{\"labels\":[\"phase-running\"],\"comments\":[$TWO],\"now\":\"$NOW\",\"wave_labeled_at\":\"2026-01-01T00:00:00Z\",$T}" \
'{"ok":true,"outcome":"blocked","phase":"build","lock":{"held":true,"phase":"build","started":"2026-01-01T06:00:00Z","stale":true},"attempts":2}'

check "malformed started: named error, held, never stale" \
"{\"labels\":[\"phase-running\"],\"comments\":[$(m build yesterday)],\"now\":\"$NOW\",$T}" \
'{"ok":false,"error":"started-malformed","outcome":"held","lock":{"held":true,"stale":false,"phase":"build"}}'

check "missing started: named error, held, never stale" \
"{\"labels\":[\"phase-running\"],\"comments\":[{\"body\":\"<!-- wave-run phase=plan -->\"}],\"now\":\"$NOW\",$T}" \
'{"ok":false,"error":"started-missing","outcome":"held","lock":{"held":true,"stale":false,"phase":"plan"}}'

check "label with no marker at all is held with a named error" \
"{\"labels\":[\"phase-running\"],\"comments\":[{\"body\":\"hello\"}],\"now\":\"$NOW\",$T}" \
'{"ok":false,"error":"lock-marker-missing","outcome":"held","lock":{"held":true,"stale":false}}'

check "label objects from raw REST are accepted" \
"{\"labels\":[{\"name\":\"phase-running\"}],\"comments\":[$(m plan 2026-01-02T11:30:00Z)],\"now\":\"$NOW\",$T}" \
'{"ok":true,"outcome":"held","lock":{"held":true,"phase":"plan","started":"2026-01-02T11:30:00Z","stale":false}}'

exit $fail
