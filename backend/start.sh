#!/bin/bash
cd "$(dirname "$0")"
source "$(dirname "$0")/../scripts/ensure-path.sh"
# Machine-local backend settings (e.g. LUMBERGH_OVERSEER_PIPER=1), kept out of the repo and
# out of every other shell. KEY=value lines.
backend_env="${LUMBERGH_DATA_DIR:-$HOME/.config/lumbergh}/backend.env"
if [ -f "$backend_env" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$backend_env"
    set +a
fi
uv run uvicorn lumbergh.main:app --host 127.0.0.1 --port 8420 --reload --timeout-graceful-shutdown 3
