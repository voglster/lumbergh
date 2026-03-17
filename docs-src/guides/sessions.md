---
title: Sessions
---

# Sessions

A session is a single Claude Code AI workspace tied to a tmux session and a working directory.

## Creating a Session

Click **+ New Session** on the dashboard. There are three creation modes:

### Direct Mode

Point at an existing directory on disk.

1. Give the session a name
2. Pick a working directory using the **repo finder** (scans your configured repo search directory) or type a path manually
3. Optionally add a description
4. Choose which **AI agent** to run (defaults to your global setting)

### Worktree Mode

Create a git worktree from an existing repo -- perfect for running parallel feature branches.

1. Pick a **parent repo** from the repo finder
2. Choose an **existing branch** or create a new one
3. Lumbergh creates the worktree and wires everything up automatically

!!! tip "When to use worktrees"
    Worktrees let you have multiple branches checked out simultaneously. Spin up two sessions on different features of the same repo and let them work in parallel without conflicts.

### New Project Mode

Initialize a brand-new git repository and start from scratch.

1. Give the session a name
2. Specify a directory path for the new project
3. Lumbergh runs `git init` and spawns a fresh session

## Agent Selection

Each session runs an AI coding agent. You can choose from:

- **Claude Code** (default) -- `claude`
- **Cursor** -- `cursor`
- **OpenCode** -- `opencode`
- **Gemini CLI** -- `gemini`
- **Aider** -- `aider`
- **Codex** -- `codex`

Set a default agent globally in **Settings**, or override per-session during creation or via the session edit panel.

## Session IDs

Lumbergh auto-generates a URL-safe ID from the session name:

```
"Auth Feature"  →  auth-feature
"Bug Fix #42"   →  bug-fix-42
```

## Managing Sessions

### Editing

Change a session's name, description, or working directory at any time via the edit action on the dashboard card or inside the session detail view.

### Pausing & Resuming

Pause a session to temporarily stop monitoring it. The tmux session stays alive -- Lumbergh just stops polling. Resume to pick back up.

### Resetting

Reset restarts the underlying tmux session. Use this when the AI gets stuck or you want a clean slate.

### Deleting

Delete removes the session from Lumbergh and kills the tmux session. For worktree sessions, the worktree directory is also automatically removed — the branch itself remains safe in the parent repo.

!!! warning
    If the worktree has uncommitted changes, you'll see a warning before deletion. Committed work on the branch is never lost — only the worktree checkout directory is removed.

## Uncommitted Changes Warning

When switching between sessions or performing destructive actions, Lumbergh checks for uncommitted changes in the working directory and warns you before proceeding. This prevents accidentally losing in-progress AI work.
