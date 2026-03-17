# Project Lumbergh

A self-hosted web dashboard for supervising multiple Claude Code AI sessions running in tmux. Think "micromanager for your AI interns."

## Project Overview

Lumbergh provides a web UI to:
- View and interact with multiple Claude Code terminal sessions (via xterm.js + WebSockets)
- Monitor live git diffs as the AI works
- Manage context/planning docs and chat with a "Manager" AI agent

See `docs/` for full PRD, architecture, and implementation roadmap.

## Tech Stack

**Backend:** Python 3.11+, FastAPI, libtmux, TinyDB
**Frontend:** React + Vite + TypeScript, xterm.js, TanStack Query, Tailwind CSS

## Project Structure

```
lumbergh/
├── backend/
│   ├── main.py             # FastAPI app, git/file/session endpoints
│   ├── tmux_pty.py         # PTY/tmux attachment logic
│   ├── session_manager.py  # PTY pooling for WebSocket clients
│   ├── routers/
│   │   └── notes.py        # Todo, scratchpad, prompt template APIs
│   ├── pyproject.toml      # Python dependencies (uv)
│   └── start.sh
├── frontend/
│   ├── src/
│   │   ├── App.tsx         # Main app with session selector + tabs
│   │   ├── components/
│   │   │   ├── Terminal.tsx
│   │   │   ├── QuickInput.tsx
│   │   │   ├── DiffViewer.tsx
│   │   │   ├── FileBrowser.tsx
│   │   │   ├── TodoList.tsx
│   │   │   ├── Scratchpad.tsx
│   │   │   ├── PromptTemplates.tsx
│   │   │   ├── ResizablePanes.tsx
│   │   │   ├── VerticalResizablePanes.tsx
│   │   │   └── diff/
│   │   │       ├── FileList.tsx
│   │   │       ├── FileDiff.tsx
│   │   │       └── CommitList.tsx
│   │   └── hooks/
│   │       └── useTerminalSocket.ts
│   └── start.sh
├── start.sh              # Start both backend + frontend
└── docs/                 # PRD, architecture, roadmap
```

## Quick Start

```bash
# First time only
cd frontend && npm install && cd ..

# Start everything (both bind to 0.0.0.0)
./start.sh
```

Or run separately:
```bash
./backend/start.sh   # Backend on :8000
./frontend/start.sh  # Frontend on :5173
```

## Linting

Run `./lint.sh` before finishing any task. It auto-fixes what it can (ruff format, prettier, eslint --fix) and exits non-zero if unfixable errors remain. Fix all errors before considering work done.

## Testing

- **Red-green-refactor**: When fixing a bug, write a failing test first that reproduces it, verify it fails, then fix the code and verify the test passes.
- Backend unit tests: `cd backend && uv run pytest`
- E2E tests: `./test/e2e-vm.sh` (spins up QEMU VM, runs all E2E + UI tests)
- Run E2E locally against running server: `cd test/e2e && pytest`

## Conventions

- Keep the backend simple - it's a thin layer over tmux/git subprocesses
- TinyDB for persistence:
  - Project data: `~/.config/lumbergh/projects/{hash}.json` (todos, scratchpad, prompts)
  - Global data: `~/.config/lumbergh/global.json` (shared prompts)
- WebSocket for terminal streaming, REST+polling for diffs and metadata
- Mobile-first responsive design (this will be used from phones/tablets)

## Releasing

When asked to release, read and follow `docs/release-workflow.md`.

## Lumbergh Cloud (Sibling Project)

`../lumbergh-cloud/` is the closed-source companion server (Home Assistant model). See `../lumbergh-cloud/docs/launch-plan.md` for the full plan. The cloud server handles prompt sharing, settings sync, and future paid features (hosted VMs, team workspaces). The open-source app works 100% offline without it.

## Current Phase

Phase 4: "The Manager & Context" - Building the AI chat/review pane. Phases 1-3 complete (terminal, diff viewer, file browser, todos, prompts, multi-session dashboard all working).
