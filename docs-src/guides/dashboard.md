---
title: Dashboard
---

# Dashboard

The dashboard is your home screen -- a bird's-eye view of every AI session you're supervising.

## Session Cards

Sessions are split into two groups:

- **Active** -- sessions with a running tmux session
- **Inactive** -- sessions whose tmux session has been stopped or removed

Each card displays:

| Field | Description |
|-------|-------------|
| **Status indicator** | Color-coded dot: 🟢 Working, 🟡 Idle (waiting for input), 🔴 Error (crashed, rate limited, or stalled >10 min), ⚪ Offline |
| **AI status summary** | A short AI-generated description of what the session is doing (requires an AI provider) |
| **Agent provider** | Which AI coding agent is running (Claude Code, Cursor, Aider, etc.) |
| **Diff stats** | Number of changed files, insertions, and deletions |
| **Tmux windows** | Number of windows in the tmux session |

## Quick Actions

Every card has quick-action buttons:

- **Edit** -- change display name, description, or working directory
- **Pause / Resume** -- temporarily stop monitoring a session without killing it
- **Reset** -- restart the tmux session from scratch (kills windows, respawns the agent)
- **Delete** -- remove the session entirely (worktree sessions also clean up the worktree directory)

Click anywhere else on a card to open the full **session detail view**.

## Top Bar

The top-right corner has controls for:

- **Theme toggle** (sun/moon icon) -- switch between dark and light mode. Your preference is saved to `localStorage` and persists across visits.
- **Settings** (gear icon) -- open the settings panel for global configuration (repo search dir, AI provider, default agent, password, etc.).
- **Version badge** -- shows your current version and alerts you when a newer version is available on PyPI.
