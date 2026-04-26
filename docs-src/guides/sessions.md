---
title: Sessions
---

# Sessions

A session is a single Claude Code AI workspace tied to a tmux session and a working directory.

## Creating a Session

**+ New Session** on the dashboard opens a modal with three creation modes (Direct, Worktree, New Project). A separate **Scratch** button on the dashboard creates a throwaway session without opening the modal — see [Scratch Mode](#scratch-mode) below.

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

### Scratch Mode

Spin up a throwaway session for one-off experiments without picking a directory or repo.

1. Click **Scratch** on the dashboard
2. Lumbergh creates an isolated working directory under `~/.config/lumbergh/scratch/<name>/` and starts an agent in it
3. Use it like any other session

Scratch sessions auto-clean themselves after `scratchMaxAgeDays` (default: 7
days) once they're idle and no clients are connected. You can promote a useful
scratch session into a permanent one via the **Promote** banner that appears
inside the session — it'll prompt you to pick a real workdir or save the
scratch directory in place.

## Agent Selection

Each session runs an AI coding agent. The provider key (used in settings and
the session edit panel) maps to a launch command:

| Provider key | Label | Launch command |
|--------------|-------|----------------|
| `claude-code` (default) | Claude Code | `claude --continue \|\| claude` |
| `cursor` | Cursor | `agent --continue \|\| agent` |
| `opencode` | OpenCode | `opencode` |
| `gemini-cli` | Gemini CLI | `gemini` |
| `aider` | Aider | `aider` |
| `codex` | Codex CLI | `codex` |

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

Delete removes the session from Lumbergh and kills the tmux session. For
worktree sessions, you can opt in to also removing the worktree directory by
checking the **Remove worktree** option in the delete confirmation — by
default the worktree is left in place. The branch itself is never deleted.

!!! warning
    If a worktree has uncommitted changes, you'll see a warning before
    deletion. Committed work on the branch is never lost — only the worktree
    checkout directory is removed when you opt in.

## Starring "The One"

Click the star icon on a session card to designate it as **"the one"** — your
highest-priority conversation. The starred session:

- Sorts to the top of the dashboard
- Pins to the left in the session navigator dots, with a separator
- Gets priority when cycling forward through sessions (`Ctrl+]`): if it's idle
  and waiting for input, you land there first

Multiple sessions can be starred. Star is a per-session toggle and persists
across restarts. `Ctrl+[` (cycle backward) ignores the priority and walks
the normal alphabetical order — use it as an escape hatch.

## Session Summaries

Lumbergh's AI provider can generate a one-line **summary** of what each
session is currently doing. Summaries appear in a banner over the session
card on the dashboard and update automatically as the conversation
progresses. Trigger a manual refresh from the session detail view. Summaries
require a configured AI provider (Settings → AI); without one, the dashboard
just shows the pattern-based status indicator and skips the summary line.

## Uncommitted Changes Warning

When switching between sessions or performing destructive actions, Lumbergh checks for uncommitted changes in the working directory and warns you before proceeding. This prevents accidentally losing in-progress AI work.
