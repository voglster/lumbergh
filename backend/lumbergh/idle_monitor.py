"""
Background monitor for session idle state detection.

Periodically polls all live tmux sessions and updates their state,
independent of whether any WebSocket clients are connected.

State classification is based on pane-content quiescence: Claude Code
(and other agent CLIs) animate spinners, timers, and token counters
continuously while working, so a frozen pane means the session is idle.
Each poll takes a short burst of captures (to avoid aliasing with the
animation period) and compares the tail fingerprint across bursts and
across polls.

Pattern-based overrides from :mod:`idle_detector` catch cases that
quiescence alone cannot (rate limit errors, shell prompts).
"""

import asyncio
import hashlib
import json
import logging
import re
import time
from datetime import UTC, datetime

import sys

if sys.platform == "win32":
    import psmux as tmux_provider
else:
    import libtmux as tmux_provider

from lumbergh.constants import TMUX_CMD
from lumbergh.db_utils import (
    get_session_data_db,
    recover_session_data_db,
    session_data_lock,
)
from lumbergh.idle_detector import SessionState, classify_overrides
from lumbergh.tmux_pty import IS_WINDOWS, capture_pane_content

logger = logging.getLogger(__name__)

_ANSI_PATTERN = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[PX^_][^\x1b]*\x1b\\")


class IdleMonitor:
    """Background service that monitors tmux sessions via quiescence detection."""

    POLL_INTERVAL_SECONDS = 2.0
    BURST_CAPTURES = 3
    BURST_GAP_SECONDS = 0.15
    QUIET_THRESHOLD_SECONDS = 5.0
    STALL_THRESHOLD_SECONDS = 600
    FINGERPRINT_LINE_COUNT = 20

    def __init__(self):
        self._fingerprints: dict[str, str] = {}
        self._last_change: dict[str, float] = {}
        self._states: dict[str, SessionState] = {}
        self._working_since: dict[str, float] = {}
        self._task: asyncio.Task | None = None
        self._running = False

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._running = True
            self._task = asyncio.create_task(self._monitor_loop())
            logger.info("Idle monitor started")

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None
            logger.info("Idle monitor stopped")

    def get_state(self, session_name: str) -> SessionState:
        return self._states.get(session_name, SessionState.UNKNOWN)

    @classmethod
    def _fingerprint(cls, content: str) -> str:
        """Hash the tail of pane content (ANSI stripped, whitespace trimmed)."""
        lines = [_ANSI_PATTERN.sub("", line).rstrip() for line in content.split("\n")]
        while lines and not lines[-1]:
            lines.pop()
        tail = lines[-cls.FINGERPRINT_LINE_COUNT :]
        return hashlib.sha1("\n".join(tail).encode("utf-8")).hexdigest()

    def _classify_burst(self, session_name: str, captures: list[str], now: float) -> SessionState:
        """
        Classify a session's state from a burst of captures.

        Returns WORKING if the pane changed within the burst or since the
        last poll.  Returns IDLE once the pane has been stable for at least
        ``QUIET_THRESHOLD_SECONDS``.  Pattern overrides (ERROR, shell
        prompts) take precedence.
        """
        if not captures:
            return SessionState.UNKNOWN

        override = classify_overrides(captures[-1])
        if override is not None:
            return override

        fingerprints = [self._fingerprint(c) for c in captures]
        last_fp = fingerprints[-1]
        prev_fp = self._fingerprints.get(session_name)

        burst_stable = len(set(fingerprints)) == 1
        changed_since_prev_poll = prev_fp is not None and prev_fp != last_fp

        if not burst_stable or changed_since_prev_poll:
            self._last_change[session_name] = now
            self._fingerprints[session_name] = last_fp
            return SessionState.WORKING

        # Fully stable within burst and across polls
        self._fingerprints[session_name] = last_fp
        if session_name not in self._last_change:
            # First sighting: bias toward working until quiet threshold elapses
            self._last_change[session_name] = now
            return SessionState.WORKING

        quiet_for = now - self._last_change[session_name]
        if quiet_for >= self.QUIET_THRESHOLD_SECONDS:
            return SessionState.IDLE
        return SessionState.WORKING

    async def _monitor_loop(self) -> None:
        while self._running:
            try:
                await self._check_all_sessions()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Idle monitor error: {e}")
            await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

    async def _check_all_sessions(self) -> None:
        loop = asyncio.get_event_loop()
        try:
            sessions = await loop.run_in_executor(None, self._get_live_session_names)
        except Exception as e:
            logger.warning(f"Failed to get live sessions: {e}")
            return

        dead_sessions = set(self._fingerprints.keys()) - set(sessions)
        for name in dead_sessions:
            self._fingerprints.pop(name, None)
            self._last_change.pop(name, None)
            self._states.pop(name, None)
            self._working_since.pop(name, None)

        await asyncio.gather(
            *(self._check_session(name) for name in sessions),
            return_exceptions=True,
        )

    def _get_live_session_names(self) -> list[str]:
        try:
            server = (
                tmux_provider.Server() if IS_WINDOWS else tmux_provider.Server(tmux_bin=TMUX_CMD)
            )
            names = [s.name for s in server.sessions if s.name is not None]
            if names or not IS_WINDOWS:
                return names
        except Exception:
            if not IS_WINDOWS:
                return []

        # Windows fallback: psmux's `-F` format flags don't always work
        # under libtmux, so parse the default `list-sessions` output.
        try:
            import subprocess

            result = subprocess.run(
                [TMUX_CMD, "list-sessions"],
                capture_output=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            if result.returncode != 0:
                return []
            names = []
            pattern = re.compile(r"^([^:]+):")
            for line in result.stdout.splitlines():
                match = pattern.match(line)
                if match:
                    names.append(match.group(1))
            return names
        except Exception:
            return []

    async def _burst_capture(self, session_name: str) -> list[str]:
        """Take BURST_CAPTURES snapshots with short async gaps between them."""
        loop = asyncio.get_event_loop()
        captures: list[str] = []
        for i in range(self.BURST_CAPTURES):
            if i > 0:
                await asyncio.sleep(self.BURST_GAP_SECONDS)
            content = await loop.run_in_executor(None, capture_pane_content, session_name)
            captures.append(content or "")
        return captures

    async def _check_session(self, session_name: str) -> None:
        captures = await self._burst_capture(session_name)
        if not any(captures):
            return

        state = self._classify_burst(session_name, captures, time.time())

        if state == SessionState.WORKING:
            if session_name not in self._working_since:
                self._working_since[session_name] = time.time()
            elif time.time() - self._working_since[session_name] > self.STALL_THRESHOLD_SECONDS:
                state = SessionState.STALLED
        else:
            self._working_since.pop(session_name, None)

        old_state = self._states.get(session_name, SessionState.UNKNOWN)
        if state != old_state:
            logger.info(f"Session {session_name} state: {old_state.value} -> {state.value}")
            self._states[session_name] = state
            await self._persist_state(session_name, state)

    async def _persist_state(self, session_name: str, state: SessionState) -> None:
        loop = asyncio.get_event_loop()

        def _save():
            with session_data_lock(session_name):
                try:
                    _write_idle_state(session_name, state)
                except (ValueError, json.JSONDecodeError) as e:
                    logger.warning(f"Corrupt DB for {session_name}; attempting recovery: {e}")
                    if recover_session_data_db(session_name):
                        _write_idle_state(session_name, state)
                    else:
                        raise

        try:
            await loop.run_in_executor(None, _save)
        except Exception as e:
            logger.error(f"Failed to persist state for {session_name}: {e}")


def _write_idle_state(session_name: str, state: SessionState) -> None:
    """Write the idle_state row.  Caller must hold session_data_lock(name)."""
    session_db = get_session_data_db(session_name)
    state_table = session_db.table("idle_state")
    state_table.truncate()
    state_table.insert(
        {
            "state": state.value,
            "updatedAt": datetime.now(tz=UTC).isoformat(),
        }
    )


# Global singleton instance
idle_monitor = IdleMonitor()
