---
title: Git Operations
---

# Git Operations

The **Git** tab in the right pane of the session detail view gives you real-time visibility into what the AI is changing on disk.

## Diff Viewer

The diff viewer shows the working tree diff (staged + unstaged + untracked files) with syntax highlighting. A **diff stats badge** at the top shows the file count, insertions, and deletions at a glance.

Diffs are computed by a background cache service every 5 seconds using git fingerprinting (filesystem metadata + worktree status). The frontend polls with ETag support, so unchanged data returns a `304 Not Modified` -- keeping bandwidth low even with frequent polling.

## Committing

The commit form lets you stage all changes and commit directly from the UI:

- Type a commit message manually, or
- Click **Generate** to have your configured AI provider write a conventional commit message from the current diff

!!! tip "Amend"
    Use the amend option to update the last commit message or add changes to it.

## Commit List

Below the diff viewer is a list of recent commits with their messages. Click any commit to view its full diff. Use this to track what the AI has committed and verify it matches what you asked for.

## Remote Status

When the current branch tracks a remote, Lumbergh shows an **ahead/behind indicator** so you can see at a glance whether you need to push or pull.

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

Use the branch menu or the git graph context actions to perform:

- **Create branch** -- create a new branch from the current HEAD
- **Delete branch** -- remove a local branch
- **Merge** -- merge another branch into the current one
- **Rebase** -- rebase the current branch onto another
- **Fast-forward** -- fast-forward the current branch when it's behind the target
- **Cherry-pick** -- apply individual commits from one branch onto another

## Commit Operations

From the commit list or git graph, you can:

- **Reword** -- edit a commit message
- **Reset to** -- reset the branch to a specific commit (hard or soft)
- **Revert** -- create a revert commit

## Stash

- **Stash push** -- stash working tree changes with an optional message
- **Stash pop** -- apply and remove the top stash entry
- **Stash drop** -- discard a stash entry

## Push & Pull

- **Push** -- push the current branch to its tracking remote
- **Force push** -- force push with lease (safe force push)
- **Pull** -- pull from the tracking remote

!!! warning
    Git operations modify your repository state. Make sure the AI isn't actively committing before running a merge, rebase, or reset.

## How It Works

All git operations run as subprocesses against the session's working directory. Read-only data (diffs, graph, commit list) is cached in the background and served instantly via the API. Write operations (commit, merge, rebase, etc.) run on demand and invalidate the cache.
