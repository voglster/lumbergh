#!/bin/bash
# Usage: ./release.sh [major|minor|patch]  (default: patch)
set -e

BUMP="${1:-patch}"

# Get latest stable tag (vX.Y.Z), default to v0.0.0 if none
LATEST=$(git tag -l 'v*' --sort=-v:refname | head -1)
LATEST="${LATEST:-v0.0.0}"

# Parse and bump
IFS='.' read -r MAJOR MINOR PATCH <<< "${LATEST#v}"
case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
  *) echo "Usage: $0 [major|minor|patch]"; exit 1 ;;
esac
NEW_VERSION="v${MAJOR}.${MINOR}.${PATCH}"

echo "Releasing $LATEST -> $NEW_VERSION"
echo "Press Enter to continue or Ctrl+C to abort..."
read

git tag "$NEW_VERSION"
git push origin "$NEW_VERSION"
echo "Tag $NEW_VERSION pushed. GitHub Actions will build and release."
