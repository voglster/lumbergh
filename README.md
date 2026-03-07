# Lumbergh

A self-hosted web dashboard for supervising multiple Claude Code AI sessions running in tmux.

Think "micromanager for your AI interns."

## Features

- **Multi-session dashboard** — view and manage multiple Claude Code sessions at a glance
- **Terminal streaming** — interact with live terminal sessions via xterm.js + WebSockets
- **Git diff viewer** — monitor live diffs, commit history, and branch switching as the AI works
- **Git graph** — visualize commit history with an interactive graph
- **File browser** — browse project files with syntax highlighting
- **AI chat** — manager AI agent for reviewing and coordinating work
- **Todo lists & scratchpad** — per-project notes and task tracking
- **Prompt templates** — reusable prompts with mention/variable support
- **Shared files** — share context across sessions
- **Settings** — configurable AI providers and preferences
- **Mobile-friendly** — responsive design for phones and tablets
- **PWA support** — installable as a progressive web app

## Prerequisites

You'll need these tools installed:

| Tool | Install |
|------|---------|
| **tmux** | `sudo apt install tmux` or `brew install tmux` |
| **git** | `sudo apt install git` or `brew install git` |
| **uv** | `curl -LsSf https://astral.sh/uv/install.sh \| sh` ([docs](https://docs.astral.sh/uv/)) |
| **npm** | Install via [nvm](https://github.com/nvm-sh/nvm): `nvm install --lts` |

## Quick Start

The easiest way to get running — one command that checks dependencies, installs everything, and launches the app in tmux:

```bash
./bootstrap.sh
```

This creates a tmux session with three windows:
1. **claude** — a Claude Code session (`claude --continue`)
2. **backend** — the FastAPI server (auto-installs Python deps via uv)
3. **frontend** — the Vite dev server (auto-installs npm deps)

Then opens `http://localhost:5420` in your browser.

### Running without tmux

If you prefer to run the servers directly (e.g., in separate terminals):

```bash
./start.sh              # Both in one process (Ctrl+C to stop)

# Or separately:
./backend/start.sh      # Backend on :8420
./frontend/start.sh     # Frontend on :5420
```

### Remote access (phone/tablet)

Lumbergh binds to `0.0.0.0` so it's accessible from other devices on your network. For secure remote access (especially from mobile), we recommend [Tailscale](https://tailscale.com/):

1. Install Tailscale on your server and your phone/tablet
2. Access Lumbergh at `http://<tailscale-ip>:5420`

This gives you a private, encrypted connection without exposing ports to the internet.

## Tech Stack

- **Backend:** Python 3.11+, FastAPI, libtmux, TinyDB
- **Frontend:** React + Vite + TypeScript, xterm.js, TanStack Query, Tailwind CSS

## Project Structure

```
lumbergh/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── tmux_pty.py           # PTY/tmux attachment logic
│   ├── session_manager.py    # PTY pooling for WebSocket clients
│   ├── git_utils.py          # Git operations (diff, log, branches)
│   ├── file_utils.py         # File browsing utilities
│   ├── db_utils.py           # TinyDB persistence helpers
│   ├── diff_cache.py         # Diff caching layer
│   ├── idle_detector.py      # Session idle detection
│   ├── idle_monitor.py       # Idle monitoring service
│   ├── message_buffer.py     # Message buffering for AI context
│   ├── models.py             # Pydantic models
│   ├── constants.py          # Shared constants
│   ├── ai/                   # AI provider integration
│   │   ├── providers.py
│   │   └── prompts.py
│   ├── routers/
│   │   ├── ai.py             # AI chat endpoints
│   │   ├── notes.py          # Todo, scratchpad, prompt template APIs
│   │   ├── sessions.py       # Session management endpoints
│   │   ├── settings.py       # Settings endpoints
│   │   └── shared.py         # Shared files endpoints
│   ├── tests/
│   ├── pyproject.toml
│   └── start.sh
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   └── SessionDetail.tsx
│   │   ├── components/
│   │   │   ├── Terminal.tsx
│   │   │   ├── QuickInput.tsx
│   │   │   ├── DiffViewer.tsx
│   │   │   ├── FileBrowser.tsx
│   │   │   ├── TodoList.tsx
│   │   │   ├── Scratchpad.tsx
│   │   │   ├── PromptTemplates.tsx
│   │   │   ├── SessionCard.tsx
│   │   │   ├── CreateSessionModal.tsx
│   │   │   ├── BranchPicker.tsx
│   │   │   ├── SettingsModal.tsx
│   │   │   ├── SharedFiles.tsx
│   │   │   ├── ResizablePanes.tsx
│   │   │   ├── VerticalResizablePanes.tsx
│   │   │   ├── diff/
│   │   │   │   ├── FileList.tsx
│   │   │   │   ├── FileDiff.tsx
│   │   │   │   └── CommitList.tsx
│   │   │   └── graph/
│   │   ├── hooks/
│   │   └── utils/
│   └── start.sh
├── slides/                # Slidev presentation
├── docs/                  # PRD, architecture, roadmap
├── start.sh               # Start both backend + frontend
└── LICENSE
```

## License

MIT
