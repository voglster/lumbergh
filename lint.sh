#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
errors=0

heading() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

# ── Backend ──────────────────────────────────────────────────────────
heading "ruff format (backend)"
cd "$ROOT/backend"
if ! uv run ruff format .; then
  errors=1
fi

heading "ruff check --fix (backend)"
if ! uv run ruff check --fix .; then
  errors=1
fi

heading "mypy (backend)"
if ! uv run mypy .; then
  errors=1
fi

# ── Frontend ─────────────────────────────────────────────────────────
heading "prettier --write (frontend)"
cd "$ROOT/frontend"
if ! npx prettier --write src/; then
  errors=1
fi

heading "eslint --fix (frontend)"
if ! npx eslint --fix .; then
  errors=1
fi

heading "tsc (frontend)"
if ! npx tsc -b; then
  errors=1
fi

# ── Result ───────────────────────────────────────────────────────────
echo
if [ "$errors" -ne 0 ]; then
  printf '\033[1;31mLint completed with errors.\033[0m\n'
  exit 1
else
  printf '\033[1;32mAll lints passed.\033[0m\n'
fi
