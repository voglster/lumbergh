# Lumbergh Documentation

Welcome to the Lumbergh docs — a self-hosted web dashboard for supervising multiple AI coding agent sessions (Claude Code, Cursor, Aider, and more) running in tmux.

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

- **Multi-session dashboard** — all your AI sessions at a glance with live idle detection (working / idle / error / stalled)
- **Multi-agent support** — run Claude Code, Cursor, Aider, Gemini CLI, OpenCode, or Codex per session
- **Live terminals** — interact with real terminal sessions via xterm.js + WebSockets
- **Git diff viewer** — watch diffs, commits, and branch changes as the AI writes code
- **Git operations** — commit, merge, rebase, cherry-pick, stash, reword, reset, force-push, and more
- **AI commit messages** — generate conventional commit messages from the current diff
- **Git graph** — interactive metro-style commit history visualization
- **File browser** — browse project files with syntax highlighting and markdown preview
- **Prompt templates** — reusable prompts at project and global scope, fire them with one click
- **Todos & scratchpad** — per-project notes and task tracking with cross-session todo moves
- **Shared files** — share context (including images) across sessions
- **AI status summaries** — AI-generated labels for what each session is doing
- **Cloud sync** — optional cloud backup, prompt sharing, and community prompt discovery via Lumbergh Cloud
- **Optional authentication** — password protection with signed cookie sessions
- **Mobile-first + PWA** — responsive design, installable on your phone or tablet
- **Tailscale integration** — auto-detects Tailscale for secure remote access with HTTPS/TLS support
- **Dark and light themes** — toggle with one click

> *"Being able to code anywhere is a real game changer. Before, I had to lug around my laptop — now I just pull out my phone."*
>
> — @jcamierpy24

## Quick Install

```bash
uv tool install pylumbergh
lumbergh
# open http://localhost:8420
```

Requires **tmux** and **git**. See [Prerequisites](getting-started/prerequisites.md) for details.

!!! tip "Need uv?"
    [uv](https://docs.astral.sh/uv/) is a fast Python package manager that installs tools in isolated environments. Get it with:

    ```bash
    curl -LsSf https://astral.sh/uv/install.sh | sh
    ```

    Prefer pip? `pip install pylumbergh` works too.
