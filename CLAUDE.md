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

## Conventions

- Keep the backend simple - it's a thin layer over tmux/git subprocesses
- TinyDB for persistence:
  - Project data: `~/.config/lumbergh/projects/{hash}.json` (todos, scratchpad, prompts)
  - Global data: `~/.config/lumbergh/global.json` (shared prompts)
- WebSocket for terminal streaming, REST+polling for diffs and metadata
- Mobile-first responsive design (this will be used from phones/tablets)

## Current Phase

Phase 3: "Office Floor" - Building multi-session support. Phases 1-2 complete (terminal, diff viewer, file browser, todos, prompts all working).
