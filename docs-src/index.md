# Lumbergh Documentation

Welcome to the Lumbergh docs — a self-hosted web dashboard for supervising multiple Claude Code AI sessions running in tmux.

Watch diffs roll in, fire off prompts, check todos, and keep your AI workers on task — all from your browser or phone.

<div class="grid cards" markdown>

-   :material-rocket-launch: **Getting Started**

    ---

    Install Lumbergh in 30 seconds and start supervising your first session.

    [:octicons-arrow-right-24: Installation](getting-started/index.md)

-   :material-book-open-variant: **Guides**

    ---

    Learn how to use the dashboard, terminals, git viewer, prompts, and more.

    [:octicons-arrow-right-24: Feature Guides](guides/dashboard.md)

-   :material-cog: **Reference**

    ---

    Configuration options, environment variables, data storage paths.

    [:octicons-arrow-right-24: Configuration](reference/configuration.md)

-   :material-wrench: **Troubleshooting**

    ---

    Common issues and how to fix them.

    [:octicons-arrow-right-24: Troubleshooting](troubleshooting.md)

</div>

## What You Get

- **Multi-session dashboard** — all your Claude Code sessions at a glance with live status detection
- **Live terminals** — interact with real terminal sessions via xterm.js + WebSockets
- **Git diff viewer** — watch diffs, commits, and branch changes as the AI writes code
- **Git operations** — merge, rebase, fast-forward, and cherry-pick branches from the UI
- **Git graph** — interactive commit history visualization
- **File browser** — browse project files with syntax highlighting and markdown preview
- **Prompt templates** — reusable prompts with variables, fire them with one click
- **Todos & scratchpad** — per-project notes and task tracking
- **Shared files** — share context across sessions
- **Mobile-first + PWA** — responsive design, installable on your phone or tablet
- **Tailscale integration** — auto-detects Tailscale for secure remote access
- **Dark and light themes** — toggle with one click

## Quick Install

```bash
uv tool install pylumbergh
lumbergh
# open http://localhost:8420
```

Requires **tmux** and **git**. No `uv`? Use `pip install pylumbergh`.
