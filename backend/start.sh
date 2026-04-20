#!/bin/bash
cd "$(dirname "$0")"
source "$(dirname "$0")/../scripts/ensure-path.sh"
uv run uvicorn lumbergh.main:app --host 0.0.0.0 --port 8420 --reload --timeout-graceful-shutdown 3
