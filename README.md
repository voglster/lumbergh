# Lumbergh

A self-hosted web dashboard for supervising multiple Claude Code AI sessions running in tmux.

Think "micromanager for your AI interns."

## Features

- View and interact with multiple Claude Code terminal sessions (xterm.js + WebSockets)
- Monitor live git diffs as the AI works
- File browser with syntax highlighting
- Todo lists and scratchpad per project
- Prompt templates library

## Quick Start

```bash
# Install frontend dependencies (first time only)
cd frontend && npm install && cd ..

# Start both backend and frontend
./start.sh
```

Backend runs on `:8000`, frontend on `:5173`.

## Tech Stack

- **Backend:** Python 3.11+, FastAPI, libtmux, TinyDB
- **Frontend:** React + Vite + TypeScript, xterm.js, TanStack Query, Tailwind CSS

## License

MIT
