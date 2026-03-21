"""
Settings router - Global application settings.
Stores settings in ~/.config/lumbergh/settings.json
"""

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from lumbergh.db_utils import get_settings_db
from lumbergh.providers import DEFAULT_PROVIDER, PROVIDERS

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
        "defaultAgent": DEFAULT_PROVIDER,
        "cloudUrl": "https://lumbergh.jc.turbo.inc",
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
    defaultAgent: str | None = None  # noqa: N815 - API field name
    password: str | None = None
    telemetryConsent: bool | None = None  # noqa: N815 - API field name
    cloudUrl: str | None = None  # noqa: N815 - API field name
    cloudToken: str | None = None  # noqa: N815 - API field name
    cloudUsername: str | None = None  # noqa: N815 - API field name


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


def _ensure_installation_id() -> str:
    """Ensure an installation ID exists in settings, generating one if missing.

    Handles both fresh installs and upgrades from versions without an ID.
    """
    all_settings = settings_table.all()
    if all_settings and all_settings[0].get("installationId"):
        return all_settings[0]["installationId"]

    installation_id = str(uuid.uuid4())
    if all_settings:
        # Upgrade path: patch existing settings

        settings_table.update({"installationId": installation_id}, doc_ids=[all_settings[0].doc_id])
    else:
        # Fresh install: insert with just the ID (defaults merge later)
        settings_table.insert({"installationId": installation_id})
    return installation_id


def get_settings() -> dict:
    """Get current settings, deep merged with defaults."""
    _ensure_installation_id()
    all_settings = settings_table.all()
    stored = all_settings[0] if all_settings else {}
    return deep_merge(_get_defaults(), stored)


def _is_ai_configured(settings: dict) -> bool:
    """Check if the current AI provider has enough config to work."""
    ai = settings.get("ai", {})
    provider = ai.get("provider", "ollama")
    config = ai.get("providers", {}).get(provider, {})

    if provider == "ollama":
        return bool(config.get("baseUrl"))
    if provider == "openai_compatible":
        return bool(config.get("baseUrl")) and bool(config.get("model"))
    # Cloud providers need an API key
    return bool(config.get("apiKey"))


@router.get("")
async def read_settings():
    """Get all settings."""
    settings = get_settings()
    is_first_run = len(settings_table.all()) == 0

    # Don't leak the password value — just report whether auth is configured
    env_pw = os.environ.get("LUMBERGH_PASSWORD", "").strip()
    config_pw = settings.get("password", "").strip()
    password_source = "env" if env_pw else ("config" if config_pw else None)

    # Strip secrets from response
    response = {k: v for k, v in settings.items() if k not in ("password", "cloudToken")}
    return {
        **response,
        "isFirstRun": is_first_run,
        "aiConfigured": _is_ai_configured(settings),
        "agentProviders": PROVIDERS,
        "passwordSet": bool(env_pw or config_pw),
        "passwordSource": password_source,
    }


def _validate_repo_search_dir(raw: str) -> str:
    """Validate and resolve a repository search directory path."""
    path = Path(raw).expanduser().resolve()
    if not path.exists():
        raise HTTPException(status_code=400, detail=f"Directory does not exist: {raw}")
    if not path.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {raw}")
    return str(path)


_OPTIONAL_FIELDS = ("password", "telemetryConsent", "cloudUrl", "cloudToken", "cloudUsername")


def _copy_optional_fields(updates: SettingsUpdate, update_data: dict[str, object]) -> None:
    """Copy non-None optional fields, stripping strings."""
    for field in _OPTIONAL_FIELDS:
        val = getattr(updates, field)
        if val is not None:
            update_data[field] = val.strip() if isinstance(val, str) else val


def _validate_updates(updates: SettingsUpdate) -> dict[str, object]:
    """Validate and extract update data from a settings update request."""
    update_data: dict[str, object] = {}

    if updates.repoSearchDir is not None:
        update_data["repoSearchDir"] = _validate_repo_search_dir(updates.repoSearchDir)

    if updates.gitGraphCommits is not None:
        if updates.gitGraphCommits < 10 or updates.gitGraphCommits > 1000:
            raise HTTPException(
                status_code=400,
                detail="Git graph commits must be between 10 and 1000",
            )
        update_data["gitGraphCommits"] = updates.gitGraphCommits

    if updates.defaultAgent is not None:
        if updates.defaultAgent not in PROVIDERS:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown agent provider: {updates.defaultAgent}",
            )
        update_data["defaultAgent"] = updates.defaultAgent

    _copy_optional_fields(updates, update_data)

    if updates.ai is not None:
        update_data["ai"] = _serialize_ai_update(updates.ai)

    return update_data


def _serialize_ai_update(ai: AISettings) -> dict:
    """Convert AI settings update to a plain dict."""
    ai_update = ai.model_dump(exclude_none=True)
    if "providers" in ai_update:
        ai_update["providers"] = {
            k: v.model_dump(exclude_none=True) if hasattr(v, "model_dump") else v
            for k, v in ai_update["providers"].items()
        }
    return ai_update


@router.patch("")
async def update_settings(updates: SettingsUpdate):
    """Update settings. Only provided fields are updated."""
    update_data = _validate_updates(updates)

    current = get_settings()
    merged = deep_merge(current, update_data)

    settings_table.truncate()
    settings_table.insert(merged)

    return get_settings()
