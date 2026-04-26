#!/usr/bin/env pwsh
Set-Location $PSScriptRoot
uv run uvicorn lumbergh.main:app --host 0.0.0.0 --port 8420 --reload --timeout-graceful-shutdown 3
