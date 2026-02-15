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
    "ai": {
        "provider": "ollama",
        "providers": {
            "ollama": {
                "baseUrl": "http://localhost:11434",
                "model": "gemma3:latest",
            },
            "openai": {
                "apiKey": "",
                "model": "gpt-4o",
            },
            "anthropic": {
                "apiKey": "",
                "model": "claude-sonnet-4-20250514",
            },
            "openai_compatible": {
                "baseUrl": "",
                "apiKey": "",
                "model": "",
            },
        },
    },
}


class AIProviderConfig(BaseModel):
    baseUrl: str | None = None
    apiKey: str | None = None
    model: str | None = None


class AISettings(BaseModel):
    provider: str | None = None
    providers: dict[str, AIProviderConfig] | None = None


class SettingsUpdate(BaseModel):
    repoSearchDir: str | None = None
    ai: AISettings | None = None


def deep_merge(base: dict, override: dict) -> dict:
    """
    Deep merge two dicts. Values in override take precedence.
    Nested dicts are merged recursively.
    """
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def get_settings() -> dict:
    """Get current settings, deep merged with defaults."""
    all_settings = settings_table.all()
    stored = all_settings[0] if all_settings else {}
    return deep_merge(DEFAULTS, stored)


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

    if updates.ai is not None:
        ai_update = updates.ai.model_dump(exclude_none=True)
        # Convert nested pydantic models to dicts
        if "providers" in ai_update:
            ai_update["providers"] = {
                k: v.model_dump(exclude_none=True) if hasattr(v, "model_dump") else v
                for k, v in ai_update["providers"].items()
            }
        update_data["ai"] = ai_update

    current = get_settings()
    merged = deep_merge(current, update_data)

    # Store the merged settings (we store everything since AI settings are complex)
    settings_table.truncate()
    settings_table.insert(merged)

    return get_settings()
