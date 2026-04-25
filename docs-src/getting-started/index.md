---
title: Installation
---

# Installation

Get Lumbergh running in under a minute.

## Quick Start

```bash
uv tool install pylumbergh
lumbergh
```

Open [http://localhost:8420](http://localhost:8420) in your browser. That's it.

!!! info "What's uv?"
    [uv](https://docs.astral.sh/uv/) is a fast Python package manager from [Astral](https://astral.sh/). `uv tool install` installs CLI tools into isolated environments so they don't conflict with other Python packages on your system. If you don't have it yet:

    ```bash
    curl -LsSf https://astral.sh/uv/install.sh | sh
    ```

    See the [uv docs](https://docs.astral.sh/uv/getting-started/installation/) for other install methods (Homebrew, pip, Windows, etc).

!!! tip "Alternative: pip"
    If you'd rather not use uv, pip works too:

    ```bash
    pip install pylumbergh
    ```

!!! note "Prerequisites"
    Lumbergh requires Python 3.11+, `tmux` (or `psmux` on Windows), and git.
    See [Prerequisites](prerequisites.md) for full details.

## Windows

Lumbergh runs natively on Windows using [`psmux`](https://pypi.org/project/psmux/) — a PowerShell-based tmux clone — in place of tmux. WSL is **not** required.

```powershell
uv tool install psmux
uv tool install pylumbergh
lumbergh
```

`pywinpty` is installed automatically as a dependency on Windows. When you launch with the default host, Lumbergh prints a hint to use `http://localhost:8420` (the `0.0.0.0` bind address shown by uvicorn isn't browsable on Windows).

## First Run

When you run `lumbergh` for the first time, it will:

1. Start the web dashboard on port 8420
2. Show a **welcome screen** that pre-fills your repo search directory to the folder you launched from
3. Let you confirm the directory and create your first session right away

!!! tip "Launch from your projects folder"
    Run `lumbergh` from the directory that contains your git repos (e.g. `~/src`) so it auto-detects the right search path.

## CLI Options

```bash
lumbergh                          # Start with defaults
lumbergh --host 0.0.0.0           # Bind to all interfaces (default)
lumbergh --port 8420 / -p 8420    # Set the port (default: 8420)
lumbergh --reload                 # Auto-reload on code changes (dev only)
lumbergh --tailscale-only         # Bind only to the Tailscale interface
lumbergh --version                # Print version and exit
```

If Tailscale is detected, Lumbergh prints the Tailscale URL on startup. Pass
`--tailscale-only` to skip binding to local interfaces entirely.

To override the data directory (where TinyDB files and scratch sessions live),
set `LUMBERGH_DATA_DIR=/path/to/dir` before launching. See
[Configuration](../reference/configuration.md) for details.

## WSL

If you prefer WSL on Windows, Lumbergh works great there too. Inside WSL,
install `tmux` (not `psmux`) and follow the Linux instructions:

```bash
wsl --install
```

Ports forward automatically from WSL to Windows, so the dashboard is reachable
at `http://localhost:8420` from your Windows browser with no extra
configuration.
