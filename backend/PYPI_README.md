# Lumbergh

A self-hosted web dashboard for supervising multiple Claude Code AI sessions running in tmux. Think "micromanager for your AI interns."

![Lumbergh Dashboard](https://raw.githubusercontent.com/voglster/lumbergh/main/docs/screenshots/dashboard.png)

## Install and Run

```bash
uv tool install pylumbergh   # or: pip install pylumbergh
lumbergh
# open http://localhost:8420
```

You just need **tmux** and **git** installed. Lumbergh checks on startup and tells you what's missing.

## Features

- **Multi-session dashboard** -- view and manage all your Claude Code sessions at a glance
- **Live terminals** -- interact with real terminal sessions via xterm.js and WebSockets
- **Git diff viewer** -- watch diffs, commits, and branch changes in real time
- **Git graph** -- interactive commit history visualization
- **File browser** -- browse project files with syntax highlighting
- **Manager AI** -- built-in AI chat pane for reviewing and coordinating work
- **Prompt templates** -- reusable prompts with variables, fire them at any session with one click
- **Todo lists and scratchpad** -- per-project notes and task tracking
- **Mobile-first** -- responsive design with PWA support, works great from a phone or tablet
- **Dark and light themes** -- toggle with one click

## Prerequisites

| Tool | Install |
|------|---------|
| **tmux** | `sudo apt install tmux` / `brew install tmux` |
| **git** | `sudo apt install git` / `brew install git` |

## Remote Access

Lumbergh binds to `0.0.0.0` so it works from other devices on your network. For secure remote access (especially mobile), we recommend [Tailscale](https://tailscale.com/) -- private, encrypted, no exposed ports.

## Links

- [Documentation and Screenshots](https://voglster.github.io/lumbergh/)
- [GitHub](https://github.com/voglster/lumbergh)
- [Issues](https://github.com/voglster/lumbergh/issues)
- [Changelog](https://github.com/voglster/lumbergh/releases)

## License

MIT
