"""
Agent provider registry for multi-agent support.
Maps provider keys to their launch commands and display labels.
"""

PROVIDERS: dict[str, dict[str, str]] = {
    "claude-code": {"launch": "claude --continue || claude", "label": "Claude Code"},
    "cursor": {"launch": "agent --continue || agent", "label": "Cursor"},
    "opencode": {"launch": "opencode", "label": "OpenCode"},
    "gemini-cli": {"launch": "gemini", "label": "Gemini CLI"},
    "aider": {"launch": "aider", "label": "Aider"},
    "codex": {"launch": "codex", "label": "Codex CLI"},
}

DEFAULT_PROVIDER = "claude-code"


def get_launch_command(agent_provider: str | None, default_agent: str | None = None) -> str:
    """Resolve the launch command for a given provider.

    Args:
        agent_provider: Provider key from the session, or None to use default.
        default_agent: Global default provider from settings, or None for DEFAULT_PROVIDER.

    Returns:
        The shell command string to launch the agent.
    """
    provider = agent_provider or default_agent or DEFAULT_PROVIDER
    entry = PROVIDERS.get(provider)
    if entry:
        return entry["launch"]
    # Unknown provider — fall back to global default
    return PROVIDERS[DEFAULT_PROVIDER]["launch"]
