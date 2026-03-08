#!/bin/bash
cd "$(dirname "$0")"
uv run uvicorn lumbergh.main:app --host 0.0.0.0 --port 8420 --reload
