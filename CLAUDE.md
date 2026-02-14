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
├── backend/              # FastAPI backend (uv + pyproject.toml)
│   ├── main.py           # App entrypoint, routes, WebSocket
│   ├── tmux_pty.py       # PTY/tmux attachment logic
│   ├── pyproject.toml    # Python dependencies
│   └── start.sh          # Backend startup script
├── frontend/             # React + Vite frontend
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Terminal.tsx
│   │   │   └── QuickInput.tsx
│   │   └── hooks/
│   │       └── useTerminalSocket.ts
│   └── start.sh          # Frontend startup script
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
- Use TinyDB for persistence (stored at `~/.lumbergh/db.json`)
- WebSocket for terminal streaming, REST+polling for diffs and metadata
- Mobile-first responsive design (this will be used from phones/tablets)

## Current Phase

Phase 1: "Intern" MVP - Single terminal session working in browser with xterm.js attached to a tmux pane via WebSocket.
