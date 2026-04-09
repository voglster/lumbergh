"""Tests for the idle state detector scoring system."""

from lumbergh.idle_detector import IdleDetector, SessionState


def _make_detector(lines: list[str]) -> IdleDetector:
    """Create a detector with pre-populated buffer."""
    detector = IdleDetector()
    for line in lines:
        detector._buffer.append(line)
    return detector


# ---------------------------------------------------------------------------
# ERROR detection
# ---------------------------------------------------------------------------


class TestErrorDetection:
    def test_rate_limit(self):
        detector = _make_detector(["Some output", "rate limit exceeded"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.ERROR

    def test_429(self):
        detector = _make_detector(["429 Too Many Requests"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.ERROR

    def test_api_error(self):
        detector = _make_detector(["APIError: connection refused"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.ERROR

    def test_overloaded(self):
        detector = _make_detector(["The server is overloaded"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.ERROR


# ---------------------------------------------------------------------------
# Shell prompt detection
# ---------------------------------------------------------------------------


class TestShellPromptDetection:
    def test_shell_prompt_no_activity(self):
        """Shell prompt with no agent indicators = ERROR (exited)."""
        detector = _make_detector(["user@host:~$"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.ERROR

    def test_shell_prompt_with_activity_not_error(self):
        """Shell prompt with agent indicators should NOT be error."""
        detector = _make_detector(["\u280b Thinking...", "user@host:~$"])
        state, _, _ = detector._analyze_state()
        assert state != SessionState.ERROR


# ---------------------------------------------------------------------------
# Spinner detection
# ---------------------------------------------------------------------------


class TestSpinnerDetection:
    def test_spinner_on_last_line(self):
        detector = _make_detector(["\u280b Processing files..."])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.WORKING


# ---------------------------------------------------------------------------
# Bug regression: esc to cancel
# ---------------------------------------------------------------------------


class TestEscToCancelBug:
    def test_esc_to_cancel_with_idle_context_is_idle(self):
        """The original bug: 'Esc to cancel' in an idle prompt must be IDLE."""
        detector = _make_detector(
            [
                "Do you want to proceed?",
                "Yes  No",
                "Esc to cancel",
                "? for shortcuts",
            ]
        )
        state, _, _ = detector._analyze_state()
        assert state == SessionState.IDLE

    def test_esc_to_interrupt_is_working(self):
        """'esc to interrupt' during active processing should be WORKING."""
        detector = _make_detector(
            [
                "Thinking...",
                "esc to interrupt",
            ]
        )
        state, _, _ = detector._analyze_state()
        assert state == SessionState.WORKING

    def test_esc_to_cancel_alone_is_idle(self):
        """'Esc to cancel' with no working context should be IDLE."""
        detector = _make_detector(
            [
                "Press enter to confirm or esc to cancel",
            ]
        )
        state, _, _ = detector._analyze_state()
        assert state == SessionState.IDLE


# ---------------------------------------------------------------------------
# WORKING pattern detection
# ---------------------------------------------------------------------------


class TestWorkingDetection:
    def test_thinking_pattern(self):
        detector = _make_detector(["Thinking about your request..."])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.WORKING

    def test_thought_for_seconds(self):
        detector = _make_detector(["thought for 12s"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.WORKING

    def test_working_seconds_pattern(self):
        detector = _make_detector(["Working (45s"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.WORKING

    def test_running_tool(self):
        detector = _make_detector(["Running\u2026"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.WORKING

    def test_subagent_marker(self):
        detector = _make_detector(["\u25fc Running subagent task"])
        state, _, reason = detector._analyze_state()
        assert state == SessionState.WORKING
        assert "\u25fc" in reason  # Critical for idle_monitor subagent detection


# ---------------------------------------------------------------------------
# IDLE pattern detection
# ---------------------------------------------------------------------------


class TestIdleDetection:
    def test_prompt_character(self):
        """\u276f on the last line should be IDLE."""
        detector = _make_detector(["\u276f"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.IDLE

    def test_yes_no_prompt(self):
        detector = _make_detector(["Do you want to proceed?", "Yes  No"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.IDLE

    def test_yn_prompt(self):
        detector = _make_detector(["Continue? (y/n)"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.IDLE

    def test_type_your_message(self):
        detector = _make_detector(["Type your message"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.IDLE

    def test_action_required(self):
        detector = _make_detector(["Action Required"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.IDLE

    def test_allow_once(self):
        detector = _make_detector(["Allow once"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.IDLE


# ---------------------------------------------------------------------------
# Scoring / recency
# ---------------------------------------------------------------------------


class TestScoringRecency:
    def test_recent_idle_beats_old_working(self):
        """IDLE on last lines should beat a single WORKING on an old line."""
        detector = _make_detector(
            [
                "Thinking...",  # WORKING, old
                "line 2",
                "line 3",
                "line 4",
                "line 5",
                "line 6",
                "line 7",
                "line 8",
                "Do you want to proceed?",  # IDLE, recent
                "Yes  No",  # IDLE, last line
            ]
        )
        state, _, _ = detector._analyze_state()
        assert state == SessionState.IDLE

    def test_recent_working_beats_old_idle(self):
        """WORKING on last lines should beat old IDLE signals."""
        detector = _make_detector(
            [
                "Do you want to proceed?",  # IDLE, old
                "Yes  No",  # IDLE, old
                "line 3",
                "line 4",
                "line 5",
                "line 6",
                "line 7",
                "line 8",
                "Thinking...",  # WORKING, recent
                "esc to interrupt",  # WORKING, last line
            ]
        )
        state, _, _ = detector._analyze_state()
        assert state == SessionState.WORKING

    def test_multiple_idle_beats_single_working(self):
        """Multiple IDLE signals should beat a single WORKING signal."""
        detector = _make_detector(
            [
                "esc to interrupt",  # WORKING
                "Do you want to proceed?",  # IDLE
                "Yes  No",  # IDLE
                "? for shortcuts",  # IDLE
            ]
        )
        state, _, _ = detector._analyze_state()
        assert state == SessionState.IDLE


# ---------------------------------------------------------------------------
# UNKNOWN fallback
# ---------------------------------------------------------------------------


class TestUnknownFallback:
    def test_empty_buffer(self):
        detector = IdleDetector()
        state, _, _ = detector._analyze_state()
        assert state == SessionState.UNKNOWN

    def test_no_patterns_match(self):
        detector = _make_detector(["random text", "more random stuff"])
        state, _, _ = detector._analyze_state()
        assert state == SessionState.UNKNOWN


# ---------------------------------------------------------------------------
# Recency multiplier
# ---------------------------------------------------------------------------


class TestRecencyMultiplier:
    def test_last_line(self):
        assert IdleDetector._recency_multiplier(0) == 2.0

    def test_recent_lines(self):
        assert IdleDetector._recency_multiplier(1) == 1.5
        assert IdleDetector._recency_multiplier(2) == 1.5

    def test_old_lines(self):
        assert IdleDetector._recency_multiplier(3) == 1.0
        assert IdleDetector._recency_multiplier(9) == 1.0


# ---------------------------------------------------------------------------
# process_output hysteresis
# ---------------------------------------------------------------------------


class TestProcessOutput:
    def test_initial_state_is_unknown(self):
        detector = IdleDetector()
        assert detector.get_state() == SessionState.UNKNOWN

    def test_hysteresis_delays_state_change(self):
        """State should not change until stable for STATE_CHANGE_DELAY_MS."""
        detector = IdleDetector()
        detector.process_output("Thinking...")
        # First detection starts the pending timer; current state stays UNKNOWN
        assert detector.get_state() == SessionState.UNKNOWN


# ---------------------------------------------------------------------------
# analyze_initial_content
# ---------------------------------------------------------------------------


class TestAnalyzeInitialContent:
    def test_idle_content(self):
        detector = IdleDetector()
        result = detector.analyze_initial_content("Some previous output\n\u276f")
        assert result.state == SessionState.IDLE

    def test_working_content(self):
        detector = IdleDetector()
        result = detector.analyze_initial_content("Some previous output\n\u280b Thinking...")
        assert result.state == SessionState.WORKING

    def test_error_content(self):
        detector = IdleDetector()
        result = detector.analyze_initial_content("APIError: connection refused")
        assert result.state == SessionState.ERROR

    def test_skips_hysteresis(self):
        """analyze_initial_content should set state immediately."""
        detector = IdleDetector()
        detector.analyze_initial_content("Thinking...")
        assert detector.get_state() == SessionState.WORKING


# ---------------------------------------------------------------------------
# ANSI stripping
# ---------------------------------------------------------------------------


class TestStripAnsi:
    def test_strips_color_codes(self):
        assert IdleDetector._strip_ansi("\x1b[31mred text\x1b[0m") == "red text"

    def test_no_ansi_unchanged(self):
        assert IdleDetector._strip_ansi("plain text") == "plain text"
