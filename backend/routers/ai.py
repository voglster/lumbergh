"""
AI router - Endpoints for AI-powered features.

Provides:
- Commit message generation
- AI provider status/configuration
- AI prompt management
"""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ai.prompts import (
    get_ai_prompt,
    get_global_ai_prompts,
    get_project_ai_prompts,
    render_prompt,
    save_global_ai_prompts,
    save_project_ai_prompts,
)
from ai.providers import OllamaProvider, get_provider
from routers.settings import get_settings

router = APIRouter(prefix="/api/ai", tags=["ai"])


# --- Models ---


class GenerateCommitMessageRequest(BaseModel):
    diff: str
    file_summary: str | None = None


class GenerateCommitMessageResponse(BaseModel):
    message: str


class AIPrompt(BaseModel):
    id: str
    task: str
    name: str
    template: str
    isDefault: bool = False


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

    provider = get_provider(ai_settings)
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
        except Exception:
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


@router.post("/generate/commit-message")
async def generate_commit_message(
    request: GenerateCommitMessageRequest,
    project_path: str | None = None,
) -> GenerateCommitMessageResponse:
    """Generate a commit message using the configured AI provider."""
    settings = get_settings()
    ai_settings = settings.get("ai", {})

    # Get the prompt template
    project = Path(project_path) if project_path else None
    template = get_ai_prompt("commit_message", project)

    if not template:
        raise HTTPException(status_code=500, detail="No commit message prompt template found")

    # Render the prompt with variables
    prompt = render_prompt(
        template,
        {
            "git_diff": request.diff,
            "file_summary": request.file_summary or "",
        },
    )

    # Get the AI provider and generate
    try:
        provider = get_provider(ai_settings)
        message = await provider.complete(prompt)
        # Clean up the response - remove any markdown code blocks if present
        message = message.strip()
        if message.startswith("```"):
            lines = message.split("\n")
            # Remove first and last lines if they're code fence markers
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            message = "\n".join(lines).strip()

        return GenerateCommitMessageResponse(message=message)
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
async def save_project_prompts_endpoint(project_path: str, prompt_list: AIPromptList) -> list[AIPrompt]:
    """Save AI prompts for a specific project."""
    prompts = [p.model_dump() for p in prompt_list.prompts]
    saved = save_project_ai_prompts(Path(project_path), prompts)
    return [AIPrompt(**p) for p in saved]
