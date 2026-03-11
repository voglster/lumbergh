#!/bin/bash
# Usage: ./release.sh [major|minor|patch] [-y]  (default: patch)
# Pass -y to skip confirmation prompt.
set -e

BUMP="patch"
SKIP_CONFIRM=""

for arg in "$@"; do
  case "$arg" in
    -y|--yes) SKIP_CONFIRM=1 ;;
    major|minor|patch) BUMP="$arg" ;;
    *) echo "Usage: $0 [major|minor|patch] [-y]"; exit 1 ;;
  esac
done

# Get latest stable tag (vX.Y.Z), default to v0.0.0 if none
LATEST=$(git tag -l 'v*' --sort=-v:refname | head -1)
LATEST="${LATEST:-v0.0.0}"

# Parse and bump
IFS='.' read -r MAJOR MINOR PATCH <<< "${LATEST#v}"
case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac
NEW_VERSION="v${MAJOR}.${MINOR}.${PATCH}"

echo "Releasing $LATEST -> $NEW_VERSION"

if [[ -z "$SKIP_CONFIRM" ]]; then
  read -r -p "Continue? [y/N] " answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

git tag "$NEW_VERSION"
git push origin "$NEW_VERSION"
echo "Tag $NEW_VERSION pushed. GitHub Actions will build and release."
