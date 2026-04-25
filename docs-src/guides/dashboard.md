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
| **Star ("the one")** | Toggle the star to mark a session as your highest priority — it sorts first and gets cycle-priority. See [Starring "The One"](sessions.md#starring-the-one). |

## Quick Actions

Every card has quick-action buttons:

- **Edit** — change display name, description, or working directory
- **Pause / Resume** — temporarily stop monitoring a session without killing it
- **Reset** — restart the tmux session from scratch (kills windows, respawns the agent)
- **Delete** — remove the session. For worktrees, you can opt in to also removing the worktree directory; it's not removed by default.

## Sort Order

Active sessions are listed in this priority:

1. Starred ("the one") sessions first
2. Then by most-recent activity

Inactive sessions are grouped below.

## Session Summary Banner

When an AI provider is configured, a one-line summary of "what this session
is doing right now" appears across the top of each card. Click into a
session and use the regenerate button on the summary overlay to force a
refresh.

Click anywhere else on a card to open the full **session detail view**.

## Top Bar

The top-right corner has controls for:

- **Theme toggle** (sun/moon icon) -- switch between dark and light mode. Your preference is saved to `localStorage` and persists across visits.
- **Settings** (gear icon) — open the settings panel for global configuration (repo search dir, AI provider, default agent, password, cloud connection, telemetry consent, etc.).
- **Version badge** — shows your current version and alerts you when a newer version is available on PyPI.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+]` | Cycle to next session (starred sessions first if any are idle) |
| `Ctrl+[` | Cycle to previous session (ignores star priority — escape hatch) |
