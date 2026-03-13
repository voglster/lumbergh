"""
Settings router - Global application settings.
Stores settings in ~/.config/lumbergh/settings.json
"""

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from lumbergh.db_utils import get_settings_db

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Database setup
settings_db = get_settings_db()
settings_table = settings_db.table("settings")


def _get_defaults() -> dict:
    """Get default settings, using LUMBERGH_LAUNCH_DIR for repoSearchDir if available."""
    launch_dir = os.environ.get("LUMBERGH_LAUNCH_DIR", "")
    if launch_dir and launch_dir != "/" and Path(launch_dir).exists():
        repo_search_dir = launch_dir
    else:
        repo_search_dir = str(Path.home())

    return {
        "repoSearchDir": repo_search_dir,
        "gitGraphCommits": 100,
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
                "google": {
                    "apiKey": "",
                    "model": "gemini-3-flash-preview",
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
    baseUrl: str | None = None  # noqa: N815 - API field name
    apiKey: str | None = None  # noqa: N815 - API field name
    model: str | None = None


class AISettings(BaseModel):
    provider: str | None = None
    providers: dict[str, AIProviderConfig] | None = None


class SettingsUpdate(BaseModel):
    repoSearchDir: str | None = None  # noqa: N815 - API field name
    gitGraphCommits: int | None = None  # noqa: N815 - API field name
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
    return deep_merge(_get_defaults(), stored)


@router.get("")
async def read_settings():
    """Get all settings."""
    settings = get_settings()
    is_first_run = len(settings_table.all()) == 0
    return {**settings, "isFirstRun": is_first_run}


@router.patch("")
async def update_settings(updates: SettingsUpdate):
    """Update settings. Only provided fields are updated."""
    update_data: dict[str, object] = {}

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

    if updates.gitGraphCommits is not None:
        if updates.gitGraphCommits < 10 or updates.gitGraphCommits > 1000:
            raise HTTPException(
                status_code=400,
                detail="Git graph commits must be between 10 and 1000",
            )
        update_data["gitGraphCommits"] = updates.gitGraphCommits

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
