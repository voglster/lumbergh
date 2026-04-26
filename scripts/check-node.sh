#!/bin/bash
# Check Node.js version meets minimum requirements (>=20.19.0)
# Sourced by bootstrap.sh and frontend/start.sh

REQUIRED_MAJOR=20
REQUIRED_MINOR=19
REQUIRED_PATCH=0

if ! command -v node &>/dev/null; then
    echo "Error: 'node' not found on PATH."
    echo "  PATH=$PATH"
    echo "  If node is installed (e.g. 'which node' works in your shell), your"
    echo "  login shell config likely isn't loading in this (non-interactive) context."
    echo "  Recommended: install via nvm (Node Version Manager)"
    echo "  Install nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
    echo "  Then: nvm install --lts"
    exit 1
fi

if ! command -v npm &>/dev/null; then
    echo "Error: 'npm' not found on PATH (but 'node' was found at: $(command -v node))."
    echo "  PATH=$PATH"
    echo "  npm usually ships with node. If 'which npm' works in your interactive"
    echo "  shell but fails here, your shell config (e.g. ~/.config/fish/config.fish)"
    echo "  is adding npm's directory only for interactive sessions. Move the PATH"
    echo "  setup out of the interactive-only block so non-interactive scripts see it."
    exit 1
fi

NODE_VERSION=$(node --version | sed 's/^v//')
IFS='.' read -r MAJOR MINOR PATCH <<< "$NODE_VERSION"

if [ "$MAJOR" -lt "$REQUIRED_MAJOR" ] || \
   { [ "$MAJOR" -eq "$REQUIRED_MAJOR" ] && [ "$MINOR" -lt "$REQUIRED_MINOR" ]; } || \
   { [ "$MAJOR" -eq "$REQUIRED_MAJOR" ] && [ "$MINOR" -eq "$REQUIRED_MINOR" ] && [ "$PATCH" -lt "$REQUIRED_PATCH" ]; }; then
    echo "Error: Node.js v${NODE_VERSION} is too old. Lumbergh requires Node.js >= ${REQUIRED_MAJOR}.${REQUIRED_MINOR}.${REQUIRED_PATCH}"
    echo "  Your version: v${NODE_VERSION}"
    if command -v nvm &>/dev/null; then
        echo "  Fix: nvm install --lts && nvm use --lts"
    else
        echo "  Recommended: install nvm, then: nvm install --lts"
        echo "  Install nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
    fi
    exit 1
fi
