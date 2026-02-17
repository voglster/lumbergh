"""
Background monitor for session idle state detection.

Periodically polls all live tmux sessions and updates their idle state,
independent of whether any WebSocket clients are connected.
"""

import asyncio
import logging
import time
from datetime import datetime

import libtmux

from db_utils import get_session_data_db
from idle_detector import IdleDetector, IdleDetectionResult, SessionState
from tmux_pty import capture_pane_content

logger = logging.getLogger(__name__)


class IdleMonitor:
    """
    Background service that monitors all tmux sessions for idle state.

    Runs independently of WebSocket connections so the dashboard can
    always show accurate idle states.
    """

    POLL_INTERVAL_SECONDS = 2.0  # How often to check sessions
    STALL_THRESHOLD_SECONDS = 600

    def __init__(self):
        self._detectors: dict[str, IdleDetector] = {}
        self._states: dict[str, SessionState] = {}
        self._working_since: dict[str, float] = {}
        self._task: asyncio.Task | None = None
        self._running = False

    def start(self) -> None:
        """Start the background monitoring task."""
        if self._task is None or self._task.done():
            self._running = True
            self._task = asyncio.create_task(self._monitor_loop())
            logger.info("Idle monitor started")

    def stop(self) -> None:
        """Stop the background monitoring task."""
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None
            logger.info("Idle monitor stopped")

    def get_state(self, session_name: str) -> SessionState:
        """Get the current state for a session."""
        return self._states.get(session_name, SessionState.UNKNOWN)

    async def _monitor_loop(self) -> None:
        """Main monitoring loop."""
        while self._running:
            try:
                await self._check_all_sessions()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Idle monitor error: {e}")

            await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

    async def _check_all_sessions(self) -> None:
        """Check all live tmux sessions."""
        loop = asyncio.get_event_loop()

        # Get list of live sessions
        try:
            sessions = await loop.run_in_executor(None, self._get_live_session_names)
        except Exception as e:
            logger.warning(f"Failed to get live sessions: {e}")
            return

        # Clean up detectors for dead sessions
        dead_sessions = set(self._detectors.keys()) - set(sessions)
        for name in dead_sessions:
            del self._detectors[name]
            self._states.pop(name, None)
            self._working_since.pop(name, None)

        # Check each live session
        for session_name in sessions:
            try:
                await self._check_session(session_name)
            except Exception as e:
                logger.warning(f"Failed to check session {session_name}: {e}")

    def _get_live_session_names(self) -> list[str]:
        """Get names of all live tmux sessions."""
        try:
            server = libtmux.Server()
            return [s.name for s in server.sessions]
        except Exception:
            return []

    async def _check_session(self, session_name: str) -> None:
        """Check a single session's idle state."""
        loop = asyncio.get_event_loop()

        # Capture current pane content
        content = await loop.run_in_executor(
            None, capture_pane_content, session_name
        )

        if not content:
            return

        # Get or create detector for this session
        if session_name not in self._detectors:
            self._detectors[session_name] = IdleDetector()

        detector = self._detectors[session_name]

        # Analyze content
        # Use analyze_initial_content since we're getting full pane snapshots
        result = detector.analyze_initial_content(content)

        if result.state == SessionState.WORKING:
            if session_name not in self._working_since:
                self._working_since[session_name] = time.time()
            elif time.time() - self._working_since[session_name] > self.STALL_THRESHOLD_SECONDS:
                result = IdleDetectionResult(SessionState.STALLED, result.confidence, "Working too long")
        else:
            self._working_since.pop(session_name, None)

        # Check for state change
        old_state = self._states.get(session_name, SessionState.UNKNOWN)
        if result.state != old_state:
            self._states[session_name] = result.state
            logger.info(f"Session {session_name} state: {old_state.value} -> {result.state.value}")

            # Persist to TinyDB
            await self._persist_state(session_name, result.state)

    async def _persist_state(self, session_name: str, state: SessionState) -> None:
        """Persist session state to TinyDB."""
        loop = asyncio.get_event_loop()

        def _save():
            session_db = get_session_data_db(session_name)
            state_table = session_db.table("idle_state")
            state_table.truncate()
            state_table.insert({
                "state": state.value,
                "updatedAt": datetime.utcnow().isoformat(),
            })

        try:
            await loop.run_in_executor(None, _save)
        except Exception as e:
            logger.warning(f"Failed to persist state for {session_name}: {e}")


# Global singleton instance
idle_monitor = IdleMonitor()
