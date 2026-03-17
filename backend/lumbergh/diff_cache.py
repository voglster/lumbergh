"""
Background diff/graph cache - computes git diffs and graph data in a thread pool
so API endpoints never block the async event loop.

Only computes for sessions that have recent API interest (someone
has requested data in the last ~60s).

Uses filesystem fingerprinting (.git/HEAD, .git/index, .git/refs/) to skip
expensive git commands when nothing has changed.
"""

import asyncio
import logging
import os
import time
from pathlib import Path

from lumbergh.git_utils import get_full_diff_with_untracked, get_graph_log

logger = logging.getLogger(__name__)

# How long a session stays "active" after last API request
ACTIVE_TTL_SECONDS = 60.0


def _git_fingerprint(workdir: Path) -> tuple:
    """Cheap fingerprint of git state using filesystem metadata.

    Checks mtime of .git/HEAD, .git/index, and .git/refs/ (recursive).
    If none have changed, no commits, staging, or branch changes happened.
    """
    git_dir = workdir / ".git"
    if not git_dir.is_dir():
        return ()

    mtimes = []
    # HEAD (branch switch, commit)
    head = git_dir / "HEAD"
    if head.exists():
        mtimes.append(os.path.getmtime(head))

    # index (staging changes)
    index = git_dir / "index"
    if index.exists():
        mtimes.append(os.path.getmtime(index))

    # refs/ (new commits, branches, tags)
    refs_dir = git_dir / "refs"
    if refs_dir.is_dir():
        mtimes.extend(
            os.path.getmtime(os.path.join(root, f))
            for root, _dirs, files in os.walk(refs_dir)
            for f in files
        )

    return tuple(mtimes)


class DiffCache:
    POLL_INTERVAL = 5.0

    def __init__(self):
        self._diff_cache: dict[str, dict] = {}  # session_name -> diff data
        self._graph_cache: dict[str, dict] = {}  # session_name -> graph data
        self._graph_limits: dict[str, int] = {}  # session_name -> last requested limit
        self._fingerprints: dict[str, tuple] = {}  # session_name -> last fingerprint
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
        """Signal that someone is interested in data for this session."""
        self._last_interest[session_name] = time.monotonic()

    def invalidate(self, session_name: str) -> None:
        """Remove cached data for a session so next request gets fresh data."""
        self._diff_cache.pop(session_name, None)
        self._graph_cache.pop(session_name, None)
        self._fingerprints.pop(session_name, None)

    def get_diff(self, session_name: str) -> dict | None:
        """Return cached diff data (instant, no blocking)."""
        return self._diff_cache.get(session_name)

    def get_stats(self, session_name: str) -> dict | None:
        """Return just the stats from cached diff data."""
        data = self._diff_cache.get(session_name)
        if data is None:
            return None
        return {
            "files": len(data.get("files", [])),
            "additions": data.get("stats", {}).get("additions", 0),
            "deletions": data.get("stats", {}).get("deletions", 0),
        }

    def get_graph(self, session_name: str) -> dict | None:
        """Return cached graph data (instant, no blocking)."""
        return self._graph_cache.get(session_name)

    def set_graph_limit(self, session_name: str, limit: int) -> None:
        """Track the requested graph limit for background computation."""
        if self._graph_limits.get(session_name) != limit:
            self._graph_limits[session_name] = limit
            # Invalidate graph cache when limit changes
            self._graph_cache.pop(session_name, None)

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
            self._diff_cache.pop(name, None)
            self._graph_cache.pop(name, None)
            self._fingerprints.pop(name, None)
            self._graph_limits.pop(name, None)
        return active

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._compute_all()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Diff cache error: {e}")
            await asyncio.sleep(self.POLL_INTERVAL)

    async def _compute_all(self) -> None:
        from lumbergh.routers.sessions import get_session_workdir

        for session_name in self._active_sessions():
            try:
                workdir = get_session_workdir(session_name)
            except Exception:  # noqa: S112 - skip sessions without workdir
                continue

            # Cheap filesystem check - skip git commands if nothing changed
            fingerprint = await asyncio.to_thread(_git_fingerprint, workdir)
            if fingerprint and fingerprint == self._fingerprints.get(session_name):
                continue

            self._fingerprints[session_name] = fingerprint

            # Compute diff
            try:
                result = await asyncio.to_thread(get_full_diff_with_untracked, workdir)
                self._diff_cache[session_name] = result
            except Exception as e:
                logger.warning(f"Diff cache: failed for {session_name}: {e}")

            # Compute graph
            try:
                limit = self._graph_limits.get(session_name, 100)
                result = await asyncio.to_thread(get_graph_log, workdir, limit)
                self._graph_cache[session_name] = result
            except Exception as e:
                logger.warning(f"Graph cache: failed for {session_name}: {e}")


diff_cache = DiffCache()
