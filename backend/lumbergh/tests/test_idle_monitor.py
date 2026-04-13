"""
Tests for quiescence-based idle detection in IdleMonitor.

Core idea: Claude Code (and similar agents) animate spinners, timers, and
token counters continuously while working.  If the pane content stops
changing for long enough, the session is idle.  Pattern matching is used
only for ERROR detection and for labeling specific idle sub-states.

These tests exercise the pure classification logic without a live tmux.
"""

from lumbergh.idle_detector import SessionState
from lumbergh.idle_monitor import IdleMonitor

# Real Claude Code "working" state (from live wrangled-dashboard session).
# The spinner char and elapsed-time counter change every second or so, so
# two captures ~150ms apart normally catch different frames.  Below are
# two plausible frames that differ only in the spinner line.
BUSY_FRAME_1 = """\
● Spec committed (c01ebd6). Now invoking the writing-plans skill to produce the
  implementation plan.

● Skill(superpowers:writing-plans)
  \u23ba  Successfully loaded skill

● I'm using the writing-plans skill to create the implementation plan.

· Invoking writing-plans\u2026 (1m 18s \u00b7 \u2193 47 tokens \u00b7 thinking with medium effort)

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
\u276f\u00a0
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  \u23f5\u23f5 accept edits on (shift+tab to cycle) \u00b7 esc to interrupt \u00b7 ctrl+t to hide tasks
"""

BUSY_FRAME_2 = """\
● Spec committed (c01ebd6). Now invoking the writing-plans skill to produce the
  implementation plan.

● Skill(superpowers:writing-plans)
  \u23ba  Successfully loaded skill

● I'm using the writing-plans skill to create the implementation plan.

\u2022 Invoking writing-plans\u2026 (1m 19s \u00b7 \u2193 52 tokens \u00b7 thinking with medium effort)

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
\u276f\u00a0
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  \u23f5\u23f5 accept edits on (shift+tab to cycle) \u00b7 esc to interrupt \u00b7 ctrl+t to hide tasks
"""

# Real Claude Code "idle" state: empty prompt, status line WITHOUT
# "esc to interrupt", pane is fully static.
IDLE_CAPTURE = """\
● Spec committed (c01ebd6). Now invoking the writing-plans skill to produce the
  implementation plan.

● Brewed for 1m 12s \u00b7 10 cache read \u00b7 2.3k output

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
\u276f\u00a0
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  \u23f5\u23f5 accept edits on (shift+tab to cycle)
"""


def test_changing_captures_within_burst_returns_working():
    """Spinner animating across a 3-frame burst -> WORKING."""
    mon = IdleMonitor()
    # Seed baseline
    mon._classify_burst("s1", [BUSY_FRAME_1, BUSY_FRAME_1, BUSY_FRAME_1], now=100.0)
    # Next poll catches animation
    state = mon._classify_burst("s1", [BUSY_FRAME_2, BUSY_FRAME_1, BUSY_FRAME_2], now=102.0)
    assert state == SessionState.WORKING


def test_changing_captures_across_polls_returns_working():
    """Content differs between polls (spinner ticked) -> WORKING."""
    mon = IdleMonitor()
    mon._classify_burst("s1", [BUSY_FRAME_1, BUSY_FRAME_1, BUSY_FRAME_1], now=100.0)
    state = mon._classify_burst("s1", [BUSY_FRAME_2, BUSY_FRAME_2, BUSY_FRAME_2], now=102.0)
    assert state == SessionState.WORKING


def test_stable_captures_eventually_return_idle():
    """Identical captures for longer than quiet threshold -> IDLE."""
    mon = IdleMonitor()
    mon._classify_burst("s1", [IDLE_CAPTURE, IDLE_CAPTURE, IDLE_CAPTURE], now=100.0)
    # Well past quiet threshold
    state = mon._classify_burst("s1", [IDLE_CAPTURE, IDLE_CAPTURE, IDLE_CAPTURE], now=100.0 + 30.0)
    assert state == SessionState.IDLE


def test_stable_captures_within_grace_period_still_working():
    """Stable but not yet past quiet threshold -> still WORKING (conservative)."""
    mon = IdleMonitor()
    mon._classify_burst("s1", [IDLE_CAPTURE, IDLE_CAPTURE, IDLE_CAPTURE], now=100.0)
    state = mon._classify_burst("s1", [IDLE_CAPTURE, IDLE_CAPTURE, IDLE_CAPTURE], now=101.0)
    assert state == SessionState.WORKING


def test_regression_busy_pane_with_empty_prompt_not_marked_idle():
    """
    Regression: in recent Claude Code, the \u276f prompt character renders even
    while working.  The old pattern-based detector flipped to IDLE the moment
    it saw \u276f on a recent line.  Quiescence must not make that mistake as
    long as the pane is still animating.
    """
    mon = IdleMonitor()
    # Several consecutive polls, each catching animation differences
    mon._classify_burst("wrangled", [BUSY_FRAME_1, BUSY_FRAME_1, BUSY_FRAME_1], now=100.0)
    for offset in (2.0, 4.0, 6.0, 8.0, 10.0, 12.0):
        # Alternate frames so every poll shows change
        frames = [BUSY_FRAME_2 if i % 2 else BUSY_FRAME_1 for i in range(3)]
        state = mon._classify_burst("wrangled", frames, now=100.0 + offset)
    assert state == SessionState.WORKING


def test_error_pattern_overrides_quiescence():
    """Rate limit message -> ERROR even if pane is stable."""
    error_content = IDLE_CAPTURE + "\nrate limit exceeded (429)\n"
    mon = IdleMonitor()
    mon._classify_burst("s1", [error_content, error_content, error_content], now=100.0)
    state = mon._classify_burst("s1", [error_content, error_content, error_content], now=200.0)
    assert state == SessionState.ERROR


def test_sessions_tracked_independently():
    """Two sessions with independent state -> independent classification."""
    mon = IdleMonitor()
    # s1: idle (stable captures)
    mon._classify_burst("s1", [IDLE_CAPTURE] * 3, now=100.0)
    # s2: busy
    mon._classify_burst("s2", [BUSY_FRAME_1] * 3, now=100.0)

    s1_state = mon._classify_burst("s1", [IDLE_CAPTURE] * 3, now=130.0)
    s2_state = mon._classify_burst("s2", [BUSY_FRAME_2, BUSY_FRAME_1, BUSY_FRAME_2], now=130.0)
    assert s1_state == SessionState.IDLE
    assert s2_state == SessionState.WORKING
