"""
Settings router - Global application settings.
Stores settings in ~/.config/lumbergh/settings.json
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db_utils import get_settings_db

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Database setup
settings_db = get_settings_db()
settings_table = settings_db.table("settings")

# Default settings
DEFAULTS = {
    "repoSearchDir": str(Path.home() / "src"),
}


class SettingsUpdate(BaseModel):
    repoSearchDir: str | None = None
    # Add future settings here


def get_settings() -> dict:
    """Get current settings, merged with defaults."""
    all_settings = settings_table.all()
    stored = all_settings[0] if all_settings else {}
    return {**DEFAULTS, **stored}


@router.get("")
async def read_settings():
    """Get all settings."""
    return get_settings()


@router.patch("")
async def update_settings(updates: SettingsUpdate):
    """Update settings. Only provided fields are updated."""
    update_data = {}

    if updates.repoSearchDir is not None:
        path = Path(updates.repoSearchDir).expanduser().resolve()

        if not path.exists():
            raise HTTPException(
                status_code=400,
                detail=f"Directory does not exist: {updates.repoSearchDir}",
            )
        if not path.is_dir():
            raise HTTPException(
                status_code=400,
                detail=f"Path is not a directory: {updates.repoSearchDir}",
            )

        update_data["repoSearchDir"] = str(path)

    current = get_settings()
    merged = {**current, **update_data}

    # Remove defaults from stored data (only store overrides)
    to_store = {k: v for k, v in merged.items() if k not in DEFAULTS or v != DEFAULTS[k]}

    settings_table.truncate()
    if to_store:
        settings_table.insert(to_store)

    return get_settings()
