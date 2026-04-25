---
title: Development Setup
---

# Development Setup

Get a local development environment running for contributing to Lumbergh.

## Requirements

- [uv](https://docs.astral.sh/uv/)
- Node.js 20.19+ and npm
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (or any other supported agent)
- tmux on Linux/macOS, or `psmux` on Windows (`uv tool install psmux`)
- git

## Clone and Bootstrap

```bash
git clone https://github.com/voglster/lumbergh.git
cd lumbergh
./bootstrap.sh
```

The bootstrap script creates a tmux session with three windows:

1. **claude** -- Claude Code session
2. **backend** -- FastAPI server on port 8420
3. **frontend** -- Vite dev server on port 5420

Your browser opens automatically to [http://localhost:5420](http://localhost:5420).

## Manual Start

If you prefer to start services yourself:

```bash
./backend/start.sh   # Backend on :8420
./frontend/start.sh  # Frontend on :5420
```

!!! note "Dev Server Proxy"
    The Vite dev server on port 5420 proxies all `/api` requests to the backend on port 8420. Use port 5420 during development for hot reloading.

## Linting

Run the lint script before submitting PRs:

```bash
./lint.sh
```

This auto-fixes what it can with ruff (format), prettier, and eslint. Fix any remaining errors before considering your work done.

!!! warning
    The lint script exits non-zero if unfixable errors remain. CI will catch these too.

## Contributing Tips

- The backend is a thin layer over tmux and git subprocesses -- keep it simple.
- TinyDB handles persistence; no database server needed.
- WebSocket powers terminal streaming; REST + polling handles diffs and metadata.
- Mobile-first responsive design -- test on small viewports.
