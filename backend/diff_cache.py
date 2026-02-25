"""
Background diff cache - computes git diffs in a thread pool so API endpoints
never block the async event loop.

Only computes diffs for sessions that have recent API interest (someone
has requested diff data in the last ~60s).
"""

import asyncio
import logging
import time

from git_utils import get_full_diff_with_untracked

logger = logging.getLogger(__name__)

# How long a session stays "active" after last API request
ACTIVE_TTL_SECONDS = 60.0


class DiffCache:
    POLL_INTERVAL = 5.0

    def __init__(self):
        self._cache: dict[str, dict] = {}  # session_name -> diff data
        self._last_interest: dict[str, float] = {}  # session_name -> timestamp
        self._task: asyncio.Task | None = None
        self._running = False

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._running = True
            self._task = asyncio.create_task(self._loop())
            logger.info("Diff cache started")

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None
            logger.info("Diff cache stopped")

    def mark_active(self, session_name: str) -> None:
        """Signal that someone is interested in diffs for this session."""
        self._last_interest[session_name] = time.monotonic()

    def invalidate(self, session_name: str) -> None:
        """Remove cached diff for a session so next request gets fresh data."""
        self._cache.pop(session_name, None)

    def get_diff(self, session_name: str) -> dict | None:
        """Return cached diff data (instant, no blocking)."""
        return self._cache.get(session_name)

    def get_stats(self, session_name: str) -> dict | None:
        """Return just the stats from cached diff data."""
        data = self._cache.get(session_name)
        if data is None:
            return None
        return {
            "files": len(data.get("files", [])),
            "additions": data.get("stats", {}).get("additions", 0),
            "deletions": data.get("stats", {}).get("deletions", 0),
        }

    def _active_sessions(self) -> list[str]:
        """Return session names with recent API interest."""
        now = time.monotonic()
        active = []
        expired = []
        for name, ts in self._last_interest.items():
            if now - ts < ACTIVE_TTL_SECONDS:
                active.append(name)
            else:
                expired.append(name)
        # Clean up expired entries
        for name in expired:
            del self._last_interest[name]
            self._cache.pop(name, None)
        return active

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._compute_diffs()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Diff cache error: {e}")
            await asyncio.sleep(self.POLL_INTERVAL)

    async def _compute_diffs(self) -> None:
        from routers.sessions import get_session_workdir

        for session_name in self._active_sessions():
            try:
                workdir = get_session_workdir(session_name)
            except Exception:
                continue
            try:
                result = await asyncio.to_thread(
                    get_full_diff_with_untracked, workdir
                )
                self._cache[session_name] = result
            except Exception as e:
                logger.warning(f"Diff cache: failed for {session_name}: {e}")


diff_cache = DiffCache()
