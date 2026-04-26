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
│   ├── lumbergh/
│   │   ├── main.py             # FastAPI app, middleware, project-level endpoints
│   │   ├── auth.py             # Password auth middleware + login/logout
│   │   ├── diff_cache.py       # Background diff/graph caching with fingerprinting
│   │   ├── idle_detector.py    # Pattern-based agent state detection
│   │   ├── idle_monitor.py     # Background session monitoring service
│   │   ├── session_manager.py  # PTY pooling for WebSocket clients
│   │   ├── tmux_pty.py         # PTY/tmux attachment logic
│   │   ├── file_utils.py       # Path validation, language detection
│   │   ├── git_utils.py        # Git subprocess wrappers
│   │   ├── version_check.py    # PyPI version checking
│   │   ├── ai/
│   │   │   ├── providers.py    # Multi-provider AI (Ollama, OpenAI, Anthropic, Google)
│   │   │   └── prompts.py      # AI prompt templates with variable substitution
│   │   └── routers/
│   │       ├── sessions.py     # Session CRUD, git ops, todos, files, AI endpoints
│   │       ├── ai.py           # AI status, commit gen, prompt management
│   │       ├── settings.py     # Global settings read/write
│   │       ├── shared.py       # Shared files upload/serve/manage
│   │       ├── notes.py        # Global prompt templates
│   │       └── tmux.py         # Mouse mode configuration
│   ├── pyproject.toml
│   └── start.sh
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── SessionDetail.tsx
│   │   │   └── LoginPage.tsx
│   │   ├── components/
│   │   │   ├── Terminal.tsx, TerminalHeader.tsx
│   │   │   ├── QuickInput.tsx
│   │   │   ├── DiffViewer.tsx, diff/
│   │   │   ├── FileBrowser.tsx
│   │   │   ├── TodoList.tsx, TodoItem.tsx
│   │   │   ├── Scratchpad.tsx
│   │   │   ├── PromptTemplates.tsx
│   │   │   ├── SharedFiles.tsx
│   │   │   ├── SettingsModal.tsx
│   │   │   ├── SessionCard.tsx
│   │   │   ├── CreateSessionModal.tsx
│   │   │   └── ResizablePanes.tsx, VerticalResizablePanes.tsx
│   │   └── hooks/
│   │       ├── useTerminalSocket.ts
│   │       ├── useAuth.tsx
│   │       └── useApiClient.ts
│   └── start.sh
├── test/
│   ├── e2e/                # API E2E tests (httpx + pytest)
│   ├── e2e-ui/             # UI E2E tests (Playwright + pytest-bdd)
│   └── e2e-vm.sh           # QEMU VM test runner
├── bootstrap.sh
└── docs/
```

## Quick Start

```bash
./bootstrap.sh
```

This creates a tmux session with claude, backend (port 8420), and frontend (port 5420) windows and opens the browser.

Or run services separately:
```bash
./backend/start.sh   # Backend on :8420
./frontend/start.sh  # Frontend on :5420
```

## Linting

Run `./lint.sh` before finishing any task. It auto-fixes what it can (ruff format, prettier, eslint --fix) and exits non-zero if unfixable errors remain. Fix all errors before considering work done.

## Testing

- **Red-green-refactor**: When fixing a bug, write a failing test first that reproduces it, verify it fails, then fix the code and verify the test passes.
- Backend unit tests: `cd backend && uv run pytest`
- E2E tests: `./test/e2e-vm.sh` (spins up QEMU VM, runs all E2E + UI tests)
- Run E2E locally against running server: `cd test/e2e && pytest`

## Debugging Event Loop Lag

A permanent watchdog in `main.py` logs to `/tmp/lumbergh-lag.log` whenever the event loop is blocked >200ms, including thread stacks. If the terminal feels laggy:

1. Check for entries: `cat /tmp/lumbergh-lag.log`
2. The stacks show what was running on each thread at the time of the stall
3. Common causes: synchronous TinyDB writes without `run_in_executor`, corrupt session JSON files (check `~/.config/lumbergh/session_data/`), or thread pool exhaustion from too many concurrent `capture_pane_content` calls

To validate a fix, clear the log (`> /tmp/lumbergh-lag.log`) and watch for new entries.

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

Phases 1-5 complete (terminal, diff viewer, file browser, todos, prompts, multi-session dashboard, auth, AI features, shared files, settings). Phase 6 (Manager AI chat) is next.
