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

    # Patterns indicating active work
    WORKING_PATTERNS = [
        re.compile(r"Thinking\.\.\."),
        re.compile(r"⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏"),  # Spinner chars
        re.compile(r"Reading|Writing|Editing|Searching"),  # Tool names
        re.compile(r"Running|Executing"),
        re.compile(r"\.{3}$"),  # Trailing ellipsis (loading indicator)
    ]

    # Pattern for Claude Code prompt (idle state)
    # The prompt is typically "> " at the start of a line
    PROMPT_PATTERN = re.compile(r"^>\s*$")

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

        Returns:
            Tuple of (state, confidence, reason)
        """
        if not self._buffer:
            return SessionState.UNKNOWN, 0.0, "No data"

        # Check recent lines for working indicators
        recent_lines = list(self._buffer)[-10:]  # Last 10 lines
        last_line = recent_lines[-1] if recent_lines else ""

        # Check for spinner in last line (high confidence working)
        if any(char in last_line for char in self.SPINNER_CHARS):
            return SessionState.WORKING, 0.95, "Spinner detected"

        # Check for working patterns in recent lines
        for line in recent_lines:
            for pattern in self.WORKING_PATTERNS:
                if pattern.search(line):
                    return SessionState.WORKING, 0.85, f"Working pattern: {pattern.pattern}"

        # Check if last line is the Claude prompt
        if self.PROMPT_PATTERN.match(last_line.strip()):
            return SessionState.IDLE, 0.9, "Prompt detected"

        # Check for prompt-like patterns in last few lines
        for line in reversed(recent_lines[-3:]):
            stripped = line.strip()
            if stripped == ">" or stripped.endswith(">"):
                return SessionState.IDLE, 0.75, "Likely prompt"

        # Default to unknown if we can't determine
        return SessionState.UNKNOWN, 0.3, "Unable to determine"

    @staticmethod
    def _strip_ansi(text: str) -> str:
        """Remove ANSI escape codes from text."""
        ansi_pattern = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[PX^_][^\x1b]*\x1b\\")
        return ansi_pattern.sub("", text)
