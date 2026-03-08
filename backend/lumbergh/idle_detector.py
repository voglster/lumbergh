"""
Idle state detector for Claude Code terminal sessions.

Analyzes terminal output to detect whether Claude is idle (waiting for input)
or actively working on a task.
"""

import re
import time
from collections import deque
from enum import Enum


class SessionState(Enum):
    UNKNOWN = "unknown"
    IDLE = "idle"      # Waiting for user input
    WORKING = "working"
    ERROR = "error"      # Claude Code exited, crashed, or hit a rate limit
    STALLED = "stalled"  # Working for too long without progress


class IdleDetectionResult:
    """Result of idle detection analysis."""

    def __init__(self, state: SessionState, confidence: float, reason: str = ""):
        self.state = state
        self.confidence = confidence
        self.reason = reason


class IdleDetector:
    """
    Detects whether a Claude Code session is idle or working.

    Maintains a rolling buffer of terminal lines and analyzes patterns
    to determine the current state.
    """

    # Spinner characters used by Claude Code
    SPINNER_CHARS = set("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏")

    # Patterns indicating active work (thinking, running tools)
    WORKING_PATTERNS = [
        re.compile(r"Thinking|Channelling", re.IGNORECASE),
        re.compile(r"⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏"),  # Spinner chars
        re.compile(r"Running…|Executing"),  # Tool execution
        re.compile(r"thought for \d+s"),  # "thought for Xs" indicator
        re.compile(r"esc to interrupt", re.IGNORECASE),  # Actively processing
    ]

    # Patterns indicating idle state (waiting for user input)
    IDLE_PATTERNS = [
        re.compile(r"❯"),  # Claude Code prompt character
        re.compile(r"Do you want to proceed\?"),
        re.compile(r"Esc to cancel"),
        re.compile(r"\? for shortcuts"),
        re.compile(r"Yes.*No", re.DOTALL),  # Yes/No choice
    ]

    # Patterns indicating an error state (Claude Code exited, rate limited, crashed)
    ERROR_PATTERNS = [
        re.compile(r"rate limit|rate_limit", re.IGNORECASE),
        re.compile(r"429|too many requests", re.IGNORECASE),
        re.compile(r"overloaded", re.IGNORECASE),
        re.compile(r"APIError|API error|APIConnectionError", re.IGNORECASE),
        re.compile(r"unexpected error|Connection error", re.IGNORECASE),
    ]

    # Shell prompt patterns (Claude Code exited, user is back at their shell)
    SHELL_PROMPT_PATTERNS = [
        re.compile(r"[\$%#]\s*$"),                    # Ends with $ % or #
        re.compile(r"@.*[\$%#]\s*$"),                  # user@host$
        re.compile(r"^\s*\w+@[\w.-]+[:\s]"),           # user@hostname:
    ]

    # Pattern for Claude Code prompt (idle state) - not used anymore but kept for reference
    PROMPT_PATTERN = re.compile(r"^[❯>]\s*$")

    # Hysteresis settings
    STATE_CHANGE_DELAY_MS = 500  # Must be stable for this long before reporting

    def __init__(self, buffer_lines: int = 50):
        """
        Initialize the idle detector.

        Args:
            buffer_lines: Number of recent lines to keep for analysis
        """
        self._buffer: deque[str] = deque(maxlen=buffer_lines)
        self._current_state = SessionState.UNKNOWN
        self._pending_state: SessionState | None = None
        self._pending_state_time: float = 0
        self._last_output_time: float = 0

    def process_output(self, data: str) -> IdleDetectionResult:
        """
        Process terminal output and detect state changes.

        Args:
            data: Raw terminal output data

        Returns:
            IdleDetectionResult with current state and confidence
        """
        self._last_output_time = time.time()

        # Split into lines and add to buffer
        lines = data.split("\n")
        for line in lines:
            # Strip ANSI escape codes for analysis
            clean_line = self._strip_ansi(line)
            if clean_line:  # Only add non-empty lines
                self._buffer.append(clean_line)

        # Analyze current state
        detected_state, confidence, reason = self._analyze_state()

        # Handle hysteresis - only change state if stable
        now = time.time()

        if detected_state != self._current_state:
            if self._pending_state != detected_state:
                # New state detected, start waiting
                self._pending_state = detected_state
                self._pending_state_time = now
            elif (now - self._pending_state_time) * 1000 >= self.STATE_CHANGE_DELAY_MS:
                # State has been stable long enough, apply change
                self._current_state = detected_state
                self._pending_state = None
        else:
            # State matches current, clear pending
            self._pending_state = None

        return IdleDetectionResult(self._current_state, confidence, reason)

    def get_state(self) -> SessionState:
        """Get the current detected state."""
        return self._current_state

    def analyze_initial_content(self, content: str) -> IdleDetectionResult:
        """
        Analyze initial pane content to determine starting state.

        Args:
            content: Full pane content captured at connection time

        Returns:
            IdleDetectionResult with initial state
        """
        # Process content but skip hysteresis for initial state
        lines = content.split("\n")
        for line in lines:
            clean_line = self._strip_ansi(line)
            if clean_line:
                self._buffer.append(clean_line)

        detected_state, confidence, reason = self._analyze_state()

        # Set initial state immediately (no hysteresis)
        self._current_state = detected_state

        return IdleDetectionResult(self._current_state, confidence, reason)

    def _analyze_state(self) -> tuple[SessionState, float, str]:
        """
        Analyze buffer to determine current state.

        Priority order:
        1. ERROR patterns (rate limits, crashes) - highest
        2. Shell prompt (Claude Code exited) - only if no working/idle indicators
        3. Spinner on last line - WORKING
        4. WORKING patterns in recent lines
        5. IDLE patterns in recent lines
        6. UNKNOWN - fallback

        Returns:
            Tuple of (state, confidence, reason)
        """
        if not self._buffer:
            return SessionState.UNKNOWN, 0.0, "No data"

        recent_lines = list(self._buffer)[-10:]  # Last 10 lines
        last_line = recent_lines[-1] if recent_lines else ""

        for line in recent_lines:
            for pattern in self.ERROR_PATTERNS:
                if pattern.search(line):
                    return SessionState.ERROR, 0.9, f"Error pattern: {pattern.pattern}"

        has_working_or_idle = False
        for line in recent_lines:
            if any(char in line for char in self.SPINNER_CHARS):
                has_working_or_idle = True
                break
            for pattern in self.WORKING_PATTERNS:
                if pattern.search(line):
                    has_working_or_idle = True
                    break
            if has_working_or_idle:
                break
            for pattern in self.IDLE_PATTERNS:
                if pattern.search(line):
                    has_working_or_idle = True
                    break
            if has_working_or_idle:
                break

        if not has_working_or_idle:
            for pattern in self.SHELL_PROMPT_PATTERNS:
                if pattern.search(last_line):
                    return SessionState.ERROR, 0.85, f"Shell prompt: {pattern.pattern}"

        # Check for spinner in last line (high confidence working)
        if any(char in last_line for char in self.SPINNER_CHARS):
            return SessionState.WORKING, 0.95, "Spinner detected"

        # Check for working patterns in recent lines (working takes priority)
        for line in recent_lines:
            for pattern in self.WORKING_PATTERNS:
                if pattern.search(line):
                    return SessionState.WORKING, 0.85, f"Working pattern: {pattern.pattern}"

        # Check for idle patterns in recent lines
        for line in recent_lines:
            for pattern in self.IDLE_PATTERNS:
                if pattern.search(line):
                    return SessionState.IDLE, 0.9, f"Idle pattern: {pattern.pattern}"

        # Default to unknown if we can't determine
        return SessionState.UNKNOWN, 0.3, "Unable to determine"

    @staticmethod
    def _strip_ansi(text: str) -> str:
        """Remove ANSI escape codes from text."""
        ansi_pattern = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[PX^_][^\x1b]*\x1b\\")
        return ansi_pattern.sub("", text)
