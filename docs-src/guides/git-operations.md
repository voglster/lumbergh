---
title: Git Operations
---

# Git Operations

The **Git** tab in the right pane of the session detail view gives you real-time visibility into what the AI is changing on disk.

## Diff Viewer

The diff viewer shows three categories of changes:

- **Unstaged changes** -- modified files not yet added to the index
- **Staged changes** -- files added to the index, ready to commit
- **Recent commits** -- committed changes with line-by-line additions and deletions

Diffs auto-poll every few seconds, so you can watch changes appear in near real-time as the AI writes code.

## Commit List

Below the diff viewer is a list of recent commits with their messages. Use this to track what the AI has committed and verify it matches what you asked for.

## Git Graph

An interactive commit history visualization rendered directly in the browser.

```
* a1b2c3d  fix: handle edge case in auth
* d4e5f6g  feat: add login endpoint
|\
| * 7h8i9j  docs: update README
|/
* k0l1m2n  initial commit
```

!!! tip "Adjusting graph depth"
    In **Settings**, you can configure how many commits the graph displays. The range is 10--1000, with a default of 100. Lower values load faster; higher values give you more history.

## Branch Operations

Right-click a branch in the git graph or use the branch menu to perform common operations:

- **Merge** -- merge another branch into the current one
- **Rebase** -- rebase the current branch onto another
- **Fast-forward** -- fast-forward the current branch when it's behind the target
- **Cherry-pick** -- apply individual commits from one branch onto another

These run as git subprocesses against the session's working directory and report results back in the UI.

!!! warning
    Branch operations modify your git state. Make sure the AI isn't actively committing before running a merge or rebase.

## How It Works

All read-only git operations (diffs, graph, commit list) run as subprocesses against the session's working directory. Branch information is displayed alongside the diff and graph views.
