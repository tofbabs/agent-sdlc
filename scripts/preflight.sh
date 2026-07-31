#!/usr/bin/env bash
#
# preflight.sh — run the CI invariants locally, before pushing.
#
# THIS SCRIPT DOES NOT TAG, AND DOES NOT BUMP ANYTHING. It used to do both.
# release-please now owns the version, the tag and CHANGELOG.md:
#
#   1. Land conventional commits on main (feat: / fix: cut a release).
#   2. release-please opens a release PR bumping version.txt, the manifest and
#      plugins/agentic-sdlc/.claude-plugin/plugin.json, with generated notes.
#   3. Edit that PR's CHANGELOG section if the release deserves narrative.
#   4. Merge it. That tags, and merging is the human gate.
#
# Hand-editing a version file will be reverted by the next release PR and will
# fail the version-agreement check below in the meantime.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/plugins/agentic-sdlc/.claude-plugin/plugin.json"
MARKETPLACE="$ROOT/.claude-plugin/marketplace.json"
fail=0

note() { printf '  %s\n' "$*"; }
bad()  { printf '✗ %s\n' "$*" >&2; fail=1; }
ok()   { printf '✓ %s\n' "$*"; }

# 1. Structure.
if command -v claude >/dev/null 2>&1; then
  claude plugin validate "$ROOT" >/dev/null && ok "marketplace manifest valid"
  claude plugin validate "$ROOT/plugins/agentic-sdlc" >/dev/null && ok "plugin manifest valid"
else
  note "claude CLI not found — skipping plugin validate"
fi

# 2. A version in marketplace.json is silently beaten by plugin.json.
if grep -q '"version"' "$MARKETPLACE"; then
  bad "marketplace.json declares a version — plugin.json always wins, silently. Remove it."
else
  ok "version declared in exactly one place"
fi

# 3. The three version files must agree, or a release tags without moving the
#    string Claude Code actually reads — and reaches nobody.
PLUGIN=$(python3 -c "import json;print(json.load(open('$MANIFEST'))['version'])")
TXT=$(tr -d '[:space:]' < "$ROOT/version.txt")
RPM=$(python3 -c "import json;print(json.load(open('$ROOT/.release-please-manifest.json'))['.'])")
if [ "$PLUGIN" = "$TXT" ] && [ "$PLUGIN" = "$RPM" ]; then
  ok "version files agree ($PLUGIN)"
else
  bad "version files disagree — plugin.json=$PLUGIN version.txt=$TXT manifest=$RPM"
  note "all three are machine-written; check extra-files in release-please-config.json"
fi

# 4. Shipped content edited on this branch needs a releasable commit, or the
#    change ships to no existing install. Advisory locally; enforced in CI
#    against the PR title, which is what gets squashed onto main.
if git -C "$ROOT" rev-parse --verify -q origin/main >/dev/null; then
  CHANGED=$(git -C "$ROOT" diff --name-only origin/main...HEAD || true)
  if printf '%s\n' "$CHANGED" | grep -q '^plugins/'; then
    if git -C "$ROOT" log --format=%s origin/main..HEAD | grep -qE '^(feat|fix)(\([^)]*\))?!?:|^[a-z]+(\([^)]*\))?!:'; then
      ok "plugins/ edited, and a feat/fix commit will cut a release"
    else
      bad "plugins/ edited with no feat: or fix: commit — this would ship to nobody"
      note "PR title is what gets squashed; retitle it feat:/fix: or split the PR"
    fi
  fi
fi

# 5. pair-log.mjs enforces the two limits that keep a PAIR story's carryover
#    linear. They were prose before and drifted in every measured story, so they
#    are now code — and code that ships in the plugin gets tested here.
if command -v node >/dev/null 2>&1; then
  if "$ROOT/scripts/pair-log.test.sh" >/dev/null 2>&1; then
    ok "pair-log invariants hold"
  else
    bad "pair-log tests failed — run scripts/pair-log.test.sh to see which invariant broke"
  fi
else
  note "node not found — skipping pair-log tests"
fi

[ "$fail" -eq 0 ] || { printf '\npreflight failed\n' >&2; exit 1; }
printf '\npreflight passed — push, then let the release PR do the rest\n'
