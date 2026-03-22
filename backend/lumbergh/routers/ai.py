"""
AI router - Endpoints for AI-powered features.

Provides:
- Commit message generation
- AI provider status/configuration
- AI prompt management
"""

import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from lumbergh.ai.prompts import (
    get_ai_prompt,
    get_global_ai_prompts,
    get_project_ai_prompts,
    render_prompt,
    save_global_ai_prompts,
    save_project_ai_prompts,
)
from lumbergh.ai.providers import LumberghCloudProvider, OllamaProvider, get_provider
from lumbergh.routers.settings import get_settings

router = APIRouter(prefix="/api/ai", tags=["ai"])


# --- Models ---


class GenerateCommitMessageRequest(BaseModel):
    diff: str
    file_summary: str | None = None


class GenerateCommitMessageResponse(BaseModel):
    message: str


class GeneratePromptNameRequest(BaseModel):
    content: str


class GeneratePromptNameResponse(BaseModel):
    name: str


class AIPrompt(BaseModel):
    id: str
    task: str
    name: str
    template: str
    isDefault: bool = False  # noqa: N815 - API field name


class AIPromptList(BaseModel):
    prompts: list[AIPrompt]


class ProviderStatus(BaseModel):
    provider: str
    available: bool
    model: str
    models: list[dict[str, Any]] | None = None


# --- Endpoints ---


@router.get("/status")
async def get_ai_status() -> ProviderStatus:
    """Get the current AI provider status and available models."""
    settings = get_settings()
    ai_settings = settings.get("ai", {})
    provider_name = ai_settings.get("provider", "ollama")
    providers_config = ai_settings.get("providers", {})
    config = providers_config.get(provider_name, {})

    provider = get_provider(ai_settings, settings)
    available = await provider.health_check()

    result = ProviderStatus(
        provider=provider_name,
        available=available,
        model=config.get("model", ""),
        models=None,
    )

    # For Ollama, also fetch available models
    if provider_name == "ollama" and available and isinstance(provider, OllamaProvider):
        try:
            result.models = await provider.list_models()
        except Exception:  # noqa: S110 - model listing is optional
            pass

    # For Lumbergh Cloud, also fetch available models
    if (
        provider_name == "lumbergh_cloud"
        and available
        and isinstance(provider, LumberghCloudProvider)
    ):
        try:
            result.models = await provider.list_models()
        except Exception:  # noqa: S110 - model listing is optional
            pass

    return result


@router.get("/ollama/models")
async def list_ollama_models() -> list[dict[str, Any]]:
    """List available Ollama models."""
    settings = get_settings()
    ai_settings = settings.get("ai", {})
    ollama_config = ai_settings.get("providers", {}).get("ollama", {})

    provider = OllamaProvider(
        base_url=ollama_config.get("baseUrl", "http://localhost:11434"),
    )

    try:
        return await provider.list_models()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to connect to Ollama: {e}")


@router.get("/cloud/models")
async def list_cloud_models() -> list[dict[str, Any]]:
    """List available models from Lumbergh Cloud."""
    settings = get_settings()
    cloud_url = settings.get("cloudUrl", "")
    cloud_token = settings.get("cloudToken", "")

    if not cloud_url or not cloud_token:
        raise HTTPException(status_code=400, detail="Not connected to Lumbergh Cloud")

    provider = LumberghCloudProvider(cloud_url=cloud_url, cloud_token=cloud_token)
    try:
        return await provider.list_models()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to fetch cloud models: {e}")


@router.post("/generate/commit-message")
async def generate_commit_message(
    request: GenerateCommitMessageRequest,
    project_path: str | None = None,
) -> GenerateCommitMessageResponse:
    """Generate a commit message using the configured AI provider."""
    from lumbergh.ai.commit_message import build_commit_prompt, parse_commit_response

    settings = get_settings()
    ai_settings = settings.get("ai", {})

    # Check for custom prompt override
    project = Path(project_path) if project_path else None
    custom_template = get_ai_prompt("commit_message", project)

    # Use adaptive prompt builder (handles preprocessing + truncation)
    # unless user has a custom template
    if custom_template and not custom_template.startswith("You are a commit message generator."):
        # User has customized the prompt — use their template as-is
        prompt = render_prompt(
            custom_template,
            {
                "git_diff": request.diff,
                "file_summary": request.file_summary or "",
            },
        )
    else:
        # Use the adaptive v17-based prompt builder
        prompt = build_commit_prompt(
            request.diff,
            file_summary=request.file_summary or "",
        )

    # Get the AI provider and generate
    try:
        provider = get_provider(ai_settings, settings)
        message = await provider.complete(prompt)
        message = parse_commit_response(message)
        return GenerateCommitMessageResponse(message=message)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI generation failed: {e}")


@router.post("/generate/prompt-name")
async def generate_prompt_name(
    request: GeneratePromptNameRequest,
) -> GeneratePromptNameResponse:
    """Generate a short snake_case name for a prompt template using AI."""
    settings = get_settings()
    ai_settings = settings.get("ai", {})

    prompt = (
        "Given this text, generate a short descriptive snake_case name (2-4 words, "
        "like `setup_instructions` or `code_review_checklist`). "
        "Reply with ONLY the name, nothing else.\n\n"
        f"{request.content[:2000]}"
    )

    try:
        provider = get_provider(ai_settings, settings)
        name = await provider.complete(prompt)
        # Sanitize: strip, lowercase, replace spaces/hyphens with _, remove non-alphanumeric
        name = name.strip().strip("`").lower()
        name = re.sub(r"[\s\-]+", "_", name)
        name = re.sub(r"[^a-z0-9_]", "", name)
        name = name.strip("_")
        if not name:
            name = "untitled_prompt"
        return GeneratePromptNameResponse(name=name)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI generation failed: {e}")


# --- AI Prompt Management ---


@router.get("/prompts")
async def get_prompts() -> list[AIPrompt]:
    """Get all global AI prompts."""
    prompts = get_global_ai_prompts()
    return [AIPrompt(**p) for p in prompts]


@router.post("/prompts")
async def save_prompts(prompt_list: AIPromptList) -> list[AIPrompt]:
    """Save/update global AI prompts."""
    prompts = [p.model_dump() for p in prompt_list.prompts]
    saved = save_global_ai_prompts(prompts)
    return [AIPrompt(**p) for p in saved]


@router.get("/prompts/project")
async def get_project_prompts(project_path: str) -> list[AIPrompt]:
    """Get AI prompts for a specific project."""
    prompts = get_project_ai_prompts(Path(project_path))
    return [AIPrompt(**p) for p in prompts]


@router.post("/prompts/project")
async def save_project_prompts_endpoint(
    project_path: str, prompt_list: AIPromptList
) -> list[AIPrompt]:
    """Save AI prompts for a specific project."""
    prompts = [p.model_dump() for p in prompt_list.prompts]
    saved = save_project_ai_prompts(Path(project_path), prompts)
    return [AIPrompt(**p) for p in saved]
