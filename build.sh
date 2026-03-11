#!/bin/bash
set -e

echo "Building Lumbergh..."

# Write version if provided
if [ -n "$VERSION" ]; then
  echo "Setting version to $VERSION"
  echo "__version__ = \"$VERSION\"" > backend/lumbergh/_version.py
fi

# Build frontend
echo "Building frontend..."
cd frontend && npm ci && npm run build && cd ..

# Copy frontend dist to package
echo "Copying frontend dist to package..."
rm -rf backend/lumbergh/frontend_dist
cp -r frontend/dist backend/lumbergh/frontend_dist

# Build Python package
echo "Building Python package..."
cd backend && python -m build

echo "Done! Package is in backend/dist/"
