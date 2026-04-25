---
title: Prerequisites
---

# Prerequisites

Lumbergh has a small set of dependencies. Most are likely already on your system.

## Required

### Python 3.11+

The backend runs on Python 3.11 or newer.

```bash
python3 --version
```

### tmux (or psmux on Windows)

Terminal session management is built on tmux. On Windows, Lumbergh uses
[`psmux`](https://pypi.org/project/psmux/) — a PowerShell-based tmux clone — in
its place. WSL is **not** required.

=== "Ubuntu/Debian"

    ```bash
    sudo apt install tmux
    ```

=== "macOS"

    ```bash
    brew install tmux
    ```

=== "Windows"

    Install psmux as a uv tool (see uv setup below). Lumbergh detects the
    `psmux` binary automatically; no extra configuration is needed.

    ```powershell
    uv tool install psmux
    ```

    The `pywinpty` PTY layer ships as a dependency of `pylumbergh` on Windows
    and installs automatically.

### git

Used for the diff viewer and worktree management. Usually pre-installed on most systems.

```bash
git --version
```

## Installation Tool

### uv (recommended)

[uv](https://docs.astral.sh/uv/) is a fast Python package manager from [Astral](https://astral.sh/). It installs CLI tools like Lumbergh in isolated environments, keeping your system Python clean. Think of it like `npx` or `pipx`, but faster.

=== "Linux/macOS"

    ```bash
    curl -LsSf https://astral.sh/uv/install.sh | sh
    ```

=== "macOS (Homebrew)"

    ```bash
    brew install uv
    ```

=== "Windows"

    ```powershell
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    ```

For other methods, see the [uv installation docs](https://docs.astral.sh/uv/getting-started/installation/).

!!! tip "Alternative: pip"
    You can also install with `pip` if you prefer. Any Python package manager that supports PyPI packages will work.

## Development Only

### Node.js 20.19+

Only required if you're working on Lumbergh itself. Not needed for normal usage.

```bash
node --version
```
