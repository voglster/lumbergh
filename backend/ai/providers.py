"""
AI provider abstraction layer.

Supports multiple AI backends with a unified interface.
"""

from abc import ABC, abstractmethod
from typing import Any

import httpx


class AIProvider(ABC):
    """Abstract base class for AI providers."""

    @abstractmethod
    async def complete(self, prompt: str) -> str:
        """Generate a completion for the given prompt."""
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """Check if the provider is available."""
        ...


class OllamaProvider(AIProvider):
    """Ollama local LLM provider."""

    def __init__(self, base_url: str = "http://localhost:11434", model: str = "llama3.2"):
        self.base_url = base_url.rstrip("/")
        self.model = model

    async def complete(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "stream": False,
                },
            )
            response.raise_for_status()
            return response.json()["response"]

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                return response.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[dict[str, Any]]:
        """List available models from Ollama."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()
            data = response.json()
            return [
                {
                    "name": m["name"],
                    "size": m.get("size", 0),
                    "parameter_size": m.get("details", {}).get("parameter_size", ""),
                }
                for m in data.get("models", [])
            ]


class OpenAIProvider(AIProvider):
    """OpenAI API provider."""

    def __init__(self, api_key: str, model: str = "gpt-4o"):
        self.api_key = api_key
        self.model = model
        self.base_url = "https://api.openai.com/v1"

    async def complete(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{self.base_url}/models",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                return response.status_code == 200
        except Exception:
            return False


class AnthropicProvider(AIProvider):
    """Anthropic Claude API provider."""

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-20250514"):
        self.api_key = api_key
        self.model = model
        self.base_url = "https://api.anthropic.com/v1"

    async def complete(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.base_url}/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "max_tokens": 1024,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()
            return response.json()["content"][0]["text"]

    async def health_check(self) -> bool:
        # Anthropic doesn't have a simple health endpoint, so just check if key exists
        return bool(self.api_key)


class GoogleAIProvider(AIProvider):
    """Google AI (Gemini) API provider."""

    def __init__(self, api_key: str, model: str = "gemini-3-flash-preview"):
        self.api_key = api_key
        self.model = model
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"

    async def complete(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.base_url}/models/{self.model}:generateContent",
                headers={
                    "x-goog-api-key": self.api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                },
            )
            response.raise_for_status()
            return response.json()["candidates"][0]["content"]["parts"][0]["text"]

    async def health_check(self) -> bool:
        # Google AI doesn't have a simple health endpoint, so just check if key exists
        return bool(self.api_key)


class OpenAICompatibleProvider(AIProvider):
    """OpenAI-compatible API provider (e.g., local vLLM, text-generation-inference)."""

    def __init__(self, base_url: str, api_key: str = "", model: str = "default"):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    async def complete(self, prompt: str) -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]

    async def health_check(self) -> bool:
        try:
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/models", headers=headers)
                return response.status_code == 200
        except Exception:
            return False


def get_provider(ai_settings: dict) -> AIProvider:
    """
    Factory function to get the appropriate AI provider based on settings.

    Args:
        ai_settings: The 'ai' section of the settings dict, containing:
            - provider: str (ollama, openai, anthropic, openai_compatible)
            - providers: dict with provider-specific settings

    Returns:
        An AIProvider instance
    """
    provider_name = ai_settings.get("provider", "ollama")
    providers_config = ai_settings.get("providers", {})
    config = providers_config.get(provider_name, {})

    if provider_name == "ollama":
        return OllamaProvider(
            base_url=config.get("baseUrl", "http://localhost:11434"),
            model=config.get("model", "llama3.2"),
        )
    elif provider_name == "openai":
        return OpenAIProvider(
            api_key=config.get("apiKey", ""),
            model=config.get("model", "gpt-4o"),
        )
    elif provider_name == "anthropic":
        return AnthropicProvider(
            api_key=config.get("apiKey", ""),
            model=config.get("model", "claude-sonnet-4-20250514"),
        )
    elif provider_name == "google":
        return GoogleAIProvider(
            api_key=config.get("apiKey", ""),
            model=config.get("model", "gemini-3-flash-preview"),
        )
    elif provider_name == "openai_compatible":
        return OpenAICompatibleProvider(
            base_url=config.get("baseUrl", ""),
            api_key=config.get("apiKey", ""),
            model=config.get("model", "default"),
        )
    else:
        raise ValueError(f"Unknown AI provider: {provider_name}")
