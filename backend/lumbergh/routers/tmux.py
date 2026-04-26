"""Tmux mouse mode detection and config management."""

import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from lumbergh.constants import TMUX_CMD

router = APIRouter(prefix="/api/tmux", tags=["tmux"])

TMUX_CONF = Path.home() / ".tmux.conf"
BUNDLED_CONF = Path(__file__).parent.parent / "assets" / "tmux.conf"


class EnableMouseRequest(BaseModel):
    mode: str  # "full" or "mouse_only"


@router.get("/mouse-status")
async def mouse_status():
    """Check if tmux mouse mode is enabled and if config exists."""
    enabled = False
    has_config = False

    # Check live tmux setting
    try:
        result = subprocess.run(
            [TMUX_CMD, "show-option", "-gv", "mouse"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            enabled = result.stdout.strip() == "on"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"enabled": False, "has_config": False}

    # Check if ~/.tmux.conf has mouse on
    if TMUX_CONF.exists():
        content = TMUX_CONF.read_text()
        has_config = any(
            line.strip() == "set -g mouse on"
            for line in content.splitlines()
            if not line.strip().startswith("#")
        )

    return {"enabled": enabled, "has_config": has_config}


@router.post("/enable-mouse")
async def enable_mouse(body: EnableMouseRequest):
    """Enable tmux mouse mode by installing config."""
    if body.mode not in ("full", "mouse_only"):
        raise HTTPException(status_code=400, detail="mode must be 'full' or 'mouse_only'")

    if body.mode == "full":
        # Back up existing config
        if TMUX_CONF.exists():
            shutil.copy2(TMUX_CONF, TMUX_CONF.with_suffix(".conf.bak"))
        # Install bundled config
        shutil.copy2(BUNDLED_CONF, TMUX_CONF)
    else:
        # mouse_only: append if not already present
        mouse_line = "set -g mouse on"
        if TMUX_CONF.exists():
            content = TMUX_CONF.read_text()
            lines = [
                line.strip() for line in content.splitlines() if not line.strip().startswith("#")
            ]
            if mouse_line in lines:
                # Already present, just source it
                pass
            else:
                with open(TMUX_CONF, "a") as f:
                    f.write(f"\n# Mouse support\n{mouse_line}\n")
        else:
            TMUX_CONF.write_text(f"# Mouse support\n{mouse_line}\n")

    # Apply immediately
    subprocess.run(
        [TMUX_CMD, "source-file", str(TMUX_CONF)],
        capture_output=True,
        text=True,
        timeout=5,
    )

    return {"status": "enabled"}
