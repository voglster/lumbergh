"""
Idle state detector for agent terminal sessions.

Analyzes terminal output to detect whether the agent is idle (waiting for input)
or actively working on a task.  Supports Claude Code, Cursor CLI, and other providers.
"""

import re
import time
from collections import deque
from enum import Enum


class SessionState(Enum):
    UNKNOWN = "unknown"
    IDLE = "idle"  # Waiting for user input
    WORKING = "working"
    ERROR = "error"  # Agent exited, crashed, or hit a rate limit
    STALLED = "stalled"  # Working for too long without progress


class IdleDetectionResult:
    """Result of idle detection analysis."""

    def __init__(self, state: SessionState, confidence: float, reason: str = ""):
        self.state = state
        self.confidence = confidence
        self.reason = reason


class IdleDetector:
    """
    Detects whether an agent session is idle or working.

    Maintains a rolling buffer of terminal lines and analyzes patterns
    to determine the current state.  Patterns cover Claude Code, Cursor CLI,
    and other supported providers.
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
        re.compile(r"Reading|Writing|Searching", re.IGNORECASE),  # Cursor agent tool usage
        re.compile(r"Working \(\d+s", re.IGNORECASE),  # Codex CLI working indicator
        re.compile(r"◼\s"),  # Claude Code subagent task in progress
    ]

    # Patterns indicating idle state (waiting for user input)
    IDLE_PATTERNS = [
        re.compile(r"\u276f"),  # Agent prompt character (U+276F)
        re.compile(r"Do you want to proceed\?"),
        re.compile(r"Esc to cancel"),
        re.compile(r"\? for shortcuts"),
        re.compile(r"Yes.*No", re.DOTALL),  # Yes/No choice
        re.compile(r"Shift\+Tab"),  # Cursor CLI mode switching hint
        re.compile(r"\(y/n\)"),  # Command approval prompt (Cursor)
        re.compile(r"Type your message"),  # Gemini CLI input prompt
        re.compile(r"Action Required"),  # Gemini CLI approval prompt
        re.compile(r"Apply this change\?"),  # Gemini CLI file write approval
        re.compile(r"Allow (once|execution|for this session)"),  # Gemini CLI permission
        re.compile(r"Would you like to make the following edits"),  # Codex CLI approval
        re.compile(r"Yes, proceed|Yes, and don't ask again"),  # Codex CLI approval choices
        re.compile(r"Press enter to confirm or esc to cancel"),  # Codex CLI confirmation
        re.compile(r"\d+% left · ~/"),  # Codex CLI status bar (idle)
    ]

    # Patterns indicating an error state (agent exited, rate limited, crashed)
    ERROR_PATTERNS = [
        re.compile(r"rate limit|rate_limit", re.IGNORECASE),
        re.compile(r"429|too many requests", re.IGNORECASE),
        re.compile(r"overloaded", re.IGNORECASE),
        re.compile(r"APIError|API error|APIConnectionError", re.IGNORECASE),
        re.compile(r"unexpected error|Connection error", re.IGNORECASE),
    ]

    # Shell prompt patterns (agent exited, user is back at their shell)
    SHELL_PROMPT_PATTERNS = [
        re.compile(r"[\$%#]\s*$"),  # Ends with $ % or #
        re.compile(r"@.*[\$%#]\s*$"),  # user@host$
        re.compile(r"^\s*\w+@[\w.-]+[:\s]"),  # user@hostname:
    ]

    # Agent prompt pattern (idle state)
    PROMPT_PATTERN = re.compile(r"^[\u276f>]\s*$")

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

    def _match_patterns(self, lines: list[str], patterns: list[re.Pattern]) -> re.Pattern | None:
        """Return the first matching pattern across lines, or None."""
        for line in lines:
            for pattern in patterns:
                if pattern.search(line):
                    return pattern
        return None

    def _has_activity_indicators(self, lines: list[str]) -> bool:
        """Check if any lines contain spinner, working, or idle indicators."""
        for line in lines:
            if any(char in line for char in self.SPINNER_CHARS):
                return True
            if any(p.search(line) for p in self.WORKING_PATTERNS):
                return True
            if any(p.search(line) for p in self.IDLE_PATTERNS):
                return True
        return False

    @staticmethod
    def _recency_multiplier(distance_from_end: int) -> float:
        """Return scoring multiplier based on line recency."""
        if distance_from_end == 0:
            return 2.0
        if distance_from_end <= 2:
            return 1.5
        return 1.0

    # Scoring weights
    _BASE_WEIGHT = 3.0  # Per-pattern match
    _SPINNER_WEIGHT = 8.0  # Spinner on last line (unambiguous)
    _PROMPT_WEIGHT = 8.0  # Agent prompt on last line (unambiguous)

    def _score_lines(
        self, recent_lines: list[str]
    ) -> tuple[dict[SessionState, float], dict[SessionState, list[str]]]:
        """Score recent lines against WORKING and IDLE patterns with recency bias."""
        scores: dict[SessionState, float] = {
            SessionState.WORKING: 0.0,
            SessionState.IDLE: 0.0,
        }
        reasons: dict[SessionState, list[str]] = {
            SessionState.WORKING: [],
            SessionState.IDLE: [],
        }
        last_line = recent_lines[-1] if recent_lines else ""
        num_lines = len(recent_lines)

        # Special: spinner on last line
        if any(char in last_line for char in self.SPINNER_CHARS):
            scores[SessionState.WORKING] += self._SPINNER_WEIGHT
            reasons[SessionState.WORKING].append("Spinner on last line")

        # Special: agent prompt on last line
        if self.PROMPT_PATTERN.search(last_line):
            scores[SessionState.IDLE] += self._PROMPT_WEIGHT
            reasons[SessionState.IDLE].append("Agent prompt on last line")

        # Score each line against all patterns
        for i, line in enumerate(recent_lines):
            dist = num_lines - 1 - i
            mult = self._recency_multiplier(dist)

            for pattern in self.WORKING_PATTERNS:
                if pattern.search(line):
                    scores[SessionState.WORKING] += self._BASE_WEIGHT * mult
                    reasons[SessionState.WORKING].append(f"{pattern.pattern} (line -{dist})")

            for pattern in self.IDLE_PATTERNS:
                if pattern.search(line):
                    scores[SessionState.IDLE] += self._BASE_WEIGHT * mult
                    reasons[SessionState.IDLE].append(f"{pattern.pattern} (line -{dist})")

        return scores, reasons

    def _analyze_state(self) -> tuple[SessionState, float, str]:
        """
        Analyze buffer to determine current state using score-based detection.

        ERROR and shell prompt are short-circuited (unambiguous).
        WORKING vs IDLE is resolved by scoring: each pattern match adds a
        weighted score (with recency bias), and the highest total wins.
        """
        if not self._buffer:
            return SessionState.UNKNOWN, 0.0, "No data"

        recent_lines = list(self._buffer)[-10:]
        last_line = recent_lines[-1] if recent_lines else ""

        # 1. Error patterns (short-circuit — unambiguous)
        match = self._match_patterns(recent_lines, self.ERROR_PATTERNS)
        if match:
            return SessionState.ERROR, 0.9, f"Error pattern: {match.pattern}"

        # 2. Shell prompt (short-circuit — depends on absence of indicators)
        if not self._has_activity_indicators(recent_lines):
            match = self._match_patterns([last_line], self.SHELL_PROMPT_PATTERNS)
            if match:
                return SessionState.ERROR, 0.85, f"Shell prompt: {match.pattern}"

        # 3. Score-based WORKING vs IDLE detection
        scores, reasons = self._score_lines(recent_lines)
        w_score = scores[SessionState.WORKING]
        i_score = scores[SessionState.IDLE]

        if w_score == 0.0 and i_score == 0.0:
            return SessionState.UNKNOWN, 0.3, "No patterns matched"

        total = w_score + i_score
        if w_score >= i_score:
            top = "; ".join(reasons[SessionState.WORKING][:3])
            return SessionState.WORKING, min(0.95, w_score / total), f"Working: {top}"
        top = "; ".join(reasons[SessionState.IDLE][:3])
        return SessionState.IDLE, min(0.95, i_score / total), f"Idle: {top}"

    @staticmethod
    def _strip_ansi(text: str) -> str:
        """Remove ANSI escape codes from text."""
        ansi_pattern = re.compile(
            r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[PX^_][^\x1b]*\x1b\\"
        )
        return ansi_pattern.sub("", text)
