"""
AI module for Lumbergh.

Provides provider-agnostic AI completions with support for:
- Ollama (local)
- OpenAI
- Anthropic
- OpenAI-compatible endpoints
"""

from ai.prompts import DEFAULT_COMMIT_MESSAGE_PROMPT, get_ai_prompt
from ai.providers import AIProvider, get_provider

__all__ = ["get_provider", "AIProvider", "get_ai_prompt", "DEFAULT_COMMIT_MESSAGE_PROMPT"]
