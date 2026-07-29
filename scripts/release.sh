#!/usr/bin/env bash
#
# release.sh <version>
#
# Guards the one failure mode that silently ships nothing: a tag whose
# plugin.json version string did not change. Claude Code resolves a plugin's
# version from plugin.json first, and keeps the cached copy when the string
# matches — so commits without a bump reach nobody.
#
# Bump plugin.json and write the CHANGELOG section FIRST, then run this.

set -euo pipefail

VERSION="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/plugins/agentic-sdlc/.claude-plugin/plugin.json"
MARKETPLACE="$ROOT/.claude-plugin/marketplace.json"
CHANGELOG="$ROOT/CHANGELOG.md"

die() { echo "release: $*" >&2; exit 1; }

[ -n "$VERSION" ] || die "usage: ./scripts/release.sh <version>   e.g. 0.2.0"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "'$VERSION' is not semver x.y.z"

# 1. The manifest is the version authority. It must already say $VERSION.
MANIFEST_VERSION="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$MANIFEST" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
[ "$MANIFEST_VERSION" = "$VERSION" ] \
  || die "plugin.json says '$MANIFEST_VERSION', you asked for '$VERSION'. Bump the manifest first."

# 2. A version in BOTH files is silently won by plugin.json. Refuse it.
grep -q '"version"' "$MARKETPLACE" \
  && die "marketplace.json declares a version. plugin.json always wins, silently — remove it."

# 3. No CHANGELOG section means consuming projects cannot tell what changed.
grep -q "^## $VERSION" "$CHANGELOG" \
  || die "CHANGELOG.md has no '## $VERSION' section."

# 4. Structural validation, if the CLI is present.
if command -v claude >/dev/null 2>&1; then
  claude plugin validate "$ROOT" || die "claude plugin validate failed."
else
  echo "release: claude CLI not found, skipping plugin validate" >&2
fi

# 5. Clean tree, unused tag.
[ -z "$(git -C "$ROOT" status --porcelain)" ] || die "working tree is dirty. Commit first."
git -C "$ROOT" rev-parse "v$VERSION" >/dev/null 2>&1 && die "tag v$VERSION already exists."

git -C "$ROOT" tag -a "v$VERSION" -m "agentic-sdlc v$VERSION"
echo "release: tagged v$VERSION"
echo "release: now  git push && git push origin v$VERSION"
echo "release: then bump each consuming project's marketplace ref to v$VERSION"
