"""
In-memory per-session message buffer.

Captures user instructions sent via the REST /send endpoint
to provide "why" context for AI commit message generation.
"""

from collections import defaultdict
from dataclasses import dataclass, field

MAX_TOTAL_CHARS = 4000
MAX_MESSAGE_CHARS = 1000


@dataclass
class _Buffer:
    messages: list[str] = field(default_factory=list)
    total_chars: int = 0


class MessageBuffer:
    def __init__(self):
        self._buffers: dict[str, _Buffer] = defaultdict(_Buffer)

    def add(self, session_name: str, text: str) -> None:
        text = text.strip()
        if not text:
            return
        if len(text) > MAX_MESSAGE_CHARS:
            text = text[:MAX_MESSAGE_CHARS] + "..."

        buf = self._buffers[session_name]
        buf.messages.append(text)
        buf.total_chars += len(text)

        # Evict oldest messages when over limit
        while buf.total_chars > MAX_TOTAL_CHARS and buf.messages:
            removed = buf.messages.pop(0)
            buf.total_chars -= len(removed)

    def get_formatted(self, session_name: str) -> str:
        buf = self._buffers.get(session_name)
        if not buf or not buf.messages:
            return ""
        return "\n".join(f"- {msg}" for msg in buf.messages)

    def get_messages(self, session_name: str) -> list[str]:
        buf = self._buffers.get(session_name)
        if not buf:
            return []
        return list(buf.messages)

    def clear(self, session_name: str) -> None:
        self._buffers.pop(session_name, None)


# Singleton
message_buffer = MessageBuffer()
