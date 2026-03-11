# Lumbergh

**Micromanage your AI interns.**

A self-hosted web dashboard for supervising multiple Claude Code sessions running in tmux. Watch diffs roll in, fire off prompts, check todos, and keep your AI workers on task -- all from your browser (or your phone).

![Lumbergh Dashboard](docs/screenshots/dashboard.png)

## Install in 30 seconds

You need `tmux` and `git` on your machine. Then:

```bash
uv tool install pylumbergh
lumbergh
```

Open **http://localhost:8420**. Done.

> No `uv`? Use `pip install pylumbergh` instead. Lumbergh checks for tmux/git on startup and tells you what's missing.

## What you get

- **Multi-session dashboard** -- all your Claude Code sessions at a glance, with live status detection
- **Live terminals** -- interact with real terminal sessions via xterm.js + WebSockets
- **Git diff viewer** -- watch diffs, commits, and branch changes as the AI writes code
- **Git graph** -- interactive commit history visualization
- **File browser** -- browse project files with syntax highlighting
- **Manager AI** -- built-in AI chat pane for reviewing and coordinating work across sessions
- **Prompt templates** -- reusable prompts with variables, fire them with one click
- **Todos & scratchpad** -- per-project notes and task tracking
- **Shared files** -- share context across sessions
- **Mobile-first + PWA** -- responsive design, installable on your phone or tablet
- **Dark and light themes** -- toggle with one click

## Remote access (phone/tablet)

Lumbergh binds to `0.0.0.0` so it's accessible from other devices on your network. For secure remote access, we recommend [Tailscale](https://tailscale.com/) -- private, encrypted, no exposed ports.

## Development

Want to contribute or hack on Lumbergh?

```bash
git clone https://github.com/voglster/lumbergh.git
cd lumbergh
./bootstrap.sh
```

This creates a tmux session with three windows (claude, backend, frontend) and opens `http://localhost:5420` with hot-reloading. You'll need **uv**, **npm**, and **Claude Code** in addition to tmux and git.

**Tech stack:** Python 3.11+ / FastAPI / libtmux / TinyDB on the backend. React / Vite / TypeScript / xterm.js / Tailwind on the frontend.

Run `./lint.sh` before submitting PRs -- it handles formatting and catches errors.

## Links

- **[Documentation & Screenshots](https://voglster.github.io/lumbergh/)** -- full usage guide, configuration, mobile setup
- [PyPI package](https://pypi.org/project/pylumbergh/)
- [Issues](https://github.com/voglster/lumbergh/issues)
- [Changelog](https://github.com/voglster/lumbergh/releases)

## License

MIT
