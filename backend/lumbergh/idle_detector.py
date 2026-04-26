"""
Pattern-based overrides for session state detection.

The primary idle/working classifier is in :mod:`idle_monitor` and uses
pane-content quiescence (the agent's spinner / timer / token counter
animates continuously while working, so a frozen pane means idle).

This module provides :func:`classify_overrides` for cases where quiescence
is not enough: rate-limit errors, crashes, and shell prompts (agent
exited).  These patterns take priority over quiescence because a stable
pane showing an error or shell prompt is not really "idle".
"""

import re
from enum import Enum


class SessionState(Enum):
    UNKNOWN = "unknown"
    IDLE = "idle"  # Waiting for user input
    WORKING = "working"
    ERROR = "error"  # Agent exited, crashed, or hit a rate limit
    STALLED = "stalled"  # Working for too long without progress


# Patterns indicating an error state (agent exited, rate limited, crashed).
ERROR_PATTERNS: list[re.Pattern] = [
    re.compile(r"rate limit|rate_limit", re.IGNORECASE),
    re.compile(r"\b429\b|too many requests", re.IGNORECASE),
    re.compile(r"overloaded", re.IGNORECASE),
    re.compile(r"APIError|API error|APIConnectionError", re.IGNORECASE),
    re.compile(r"unexpected error|Connection error", re.IGNORECASE),
]

# Shell prompt patterns on the last non-empty line (agent exited, user is
# back at their shell).  Only checked as a fallback.
SHELL_PROMPT_PATTERNS: list[re.Pattern] = [
    re.compile(r"[\$%#]\s*$"),
    re.compile(r"@.*[\$%#]\s*$"),
]

_ANSI_PATTERN = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[PX^_][^\x1b]*\x1b\\")

# Indicators that the agent is actively working — used to disambiguate a
# stable pane that still has an active status line (edge case: animation
# paused mid-frame).  If present, we do NOT treat the pane as shell/error.
_ACTIVE_AGENT_HINTS: list[re.Pattern] = [
    re.compile(r"esc to (interrupt|cancel)", re.IGNORECASE),
    re.compile(r"shift\+tab to cycle", re.IGNORECASE),
    re.compile(r"accept edits", re.IGNORECASE),
    re.compile(r"\? for shortcuts", re.IGNORECASE),
]


def _strip_ansi(text: str) -> str:
    return _ANSI_PATTERN.sub("", text)


def _recent_lines(content: str, n: int = 15) -> list[str]:
    lines = [_strip_ansi(line).rstrip() for line in content.split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    return lines[-n:]


def classify_overrides(content: str) -> SessionState | None:
    """
    Return an override SessionState if pattern matching indicates one,
    else None (meaning "use the quiescence classifier").

    Priority:
      1. ERROR patterns (rate limits, crashes)
      2. Shell prompt on last line (agent exited) -> ERROR

    A shell prompt match is suppressed if the pane also shows an active
    agent hint (e.g. "esc to interrupt" in the status line), since those
    lines can end with a `$` too.
    """
    lines = _recent_lines(content)
    if not lines:
        return None

    for pattern in ERROR_PATTERNS:
        for line in lines:
            if pattern.search(line):
                return SessionState.ERROR

    has_agent_hint = any(p.search(line) for line in lines for p in _ACTIVE_AGENT_HINTS)
    if not has_agent_hint:
        last_line = lines[-1]
        for pattern in SHELL_PROMPT_PATTERNS:
            if pattern.search(last_line):
                return SessionState.ERROR

    return None
