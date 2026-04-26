"""CLI entry point for Lumbergh."""

import argparse
import os
import platform
import shutil
import sys

from lumbergh._version import __version__
from lumbergh.constants import TMUX_CMD
from lumbergh.tailscale import detect_tailscale

IS_WINDOWS = platform.system() == "Windows"

REQUIRED_TOOLS = {
    TMUX_CMD: (
        "uv tool install psmux" if IS_WINDOWS else "sudo apt install tmux  (or: brew install tmux)"
    ),
    "git": "sudo apt install git  (or: brew install git)",
}


def _check_dependencies():
    """Check that required system tools are installed."""
    missing = []
    for cmd, install_hint in REQUIRED_TOOLS.items():
        if shutil.which(cmd) is None:
            missing.append((cmd, install_hint))
    if missing:
        print("Lumbergh requires the following tools:\n", file=sys.stderr)
        for cmd, hint in missing:
            print(f"  {cmd} — install with: {hint}", file=sys.stderr)
        print(file=sys.stderr)
        sys.exit(1)


def run():
    """Run the Lumbergh server."""
    parser = argparse.ArgumentParser(description="Lumbergh - AI Session Supervisor")
    parser.add_argument("--version", action="version", version=f"lumbergh {__version__}")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", "-p", type=int, default=8420, help="Port to bind to")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    parser.add_argument(
        "--tailscale-only",
        action="store_true",
        help="Bind only to the Tailscale interface",
    )
    args = parser.parse_args()

    _check_dependencies()

    ts = detect_tailscale()
    if ts:
        print(f"Tailscale: http://{ts['hostname']}:{args.port}")
        if args.tailscale_only:
            args.host = ts["ip"]
    elif args.tailscale_only:
        print(
            "Error: --tailscale-only requires Tailscale to be installed and connected.",
            file=sys.stderr,
        )
        sys.exit(1)

    display_host = "localhost" if args.host == "0.0.0.0" else args.host
    url = f"http://{display_host}:{args.port}"
    print(f"Lumbergh: {url}")

    if IS_WINDOWS and args.host == "0.0.0.0":
        print()
        print("=" * 60)
        print(f"  OPEN THIS URL:  {url}")
        print()
        print("  Windows users: ignore the 0.0.0.0 address below.")
        print("  Use localhost instead — 0.0.0.0 won't work in your browser.")
        print("=" * 60)
        print()

    os.environ["LUMBERGH_LAUNCH_DIR"] = os.getcwd()

    import uvicorn

    extra: dict = {}
    if args.reload:
        extra["timeout_graceful_shutdown"] = 3

    uvicorn.run("lumbergh.main:app", host=args.host, port=args.port, reload=args.reload, **extra)


if __name__ == "__main__":
    run()
