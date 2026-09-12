"""Heavy endpoints must not be served on the event loop.

Creating and closing a worktree session both shell out to commands that take as
long as they take: `git worktree remove` over a tree holding a borrowed
`node_modules`, or a project's own post-create hook, which is routinely an
`npm install`. Run on the loop, none of that yields, so no other request — no
terminal frame, no poll, no click — is served until it finishes, and the whole
UI reads as frozen.

These tests measure the loop directly rather than racing a second request
against the slow one: which of two concurrent requests reaches the loop first is
scheduling luck, and a test that depends on it passes on a blocked loop often
enough to be worthless.
"""

import asyncio
import time

import pytest
from httpx import ASGITransport, AsyncClient

SLOW_SECONDS = 0.5
# A blocked loop shows up as one huge gap; normal scheduling jitter is ~ms.
MAX_ACCEPTABLE_GAP = 0.1


async def worst_loop_gap(stop: asyncio.Event) -> float:
    """The longest the event loop went unserved, in seconds.

    A coroutine that asks only to be woken every 10ms can measure exactly what a
    request handler on a blocked loop suffers: how long it actually waited.
    """
    worst = 0.0
    last = time.monotonic()
    while not stop.is_set():
        await asyncio.sleep(0.01)
        now = time.monotonic()
        worst = max(worst, now - last - 0.01)
        last = now
    return worst


async def measure_while(app, request):
    """Run `request` against `app`, returning (worst loop gap, request seconds)."""
    stop = asyncio.Event()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        watcher = asyncio.create_task(worst_loop_gap(stop))
        started = time.monotonic()
        response = await request(client)
        elapsed = time.monotonic() - started
        stop.set()
        gap = await watcher
    return gap, elapsed, response


@pytest.fixture
def sessions_app(tmp_path, monkeypatch):
    monkeypatch.setenv("LUMBERGH_DATA_DIR", str(tmp_path / "cfg"))
    import importlib

    from lumbergh import constants, db_utils, worktrees
    from lumbergh.routers import sessions
    from lumbergh.tunnel import cloud_tunnel

    importlib.reload(constants)
    importlib.reload(db_utils)
    importlib.reload(worktrees)

    monkeypatch.setattr(sessions, "create_tmux_session", lambda *_a, **_kw: None)
    monkeypatch.setattr(cloud_tunnel, "notify_session_change", lambda: None)

    from lumbergh.main import app

    return app, sessions, tmp_path


def _slow(*result):
    def fn(*_a, **_kw):
        time.sleep(SLOW_SECONDS)
        return result[0] if len(result) == 1 else result

    return fn


async def test_closing_a_session_does_not_block_the_loop(sessions_app, monkeypatch):
    app, sessions, tmp_path = sessions_app
    workdir = tmp_path / "wt"
    workdir.mkdir()
    monkeypatch.setattr(
        sessions,
        "get_stored_sessions",
        lambda: {
            "doomed": {
                "type": "worktree",
                "worktree_parent_repo": str(tmp_path / "repo"),
                "workdir": str(workdir),
            }
        },
    )
    monkeypatch.setattr(sessions, "get_live_sessions", dict)
    monkeypatch.setattr(sessions.worktrees, "reap", _slow({"status": "removed"}))

    gap, elapsed, _ = await measure_while(
        app, lambda c: c.delete("/api/sessions/doomed?cleanup_worktree=true")
    )

    assert elapsed >= SLOW_SECONDS, "the cleanup did not actually run"
    assert gap < MAX_ACCEPTABLE_GAP, f"event loop stalled {gap:.2f}s while a session closed"


async def test_creating_a_worktree_session_does_not_block_the_loop(sessions_app, monkeypatch):
    app, sessions, tmp_path = sessions_app
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    workdir = tmp_path / "wt"
    workdir.mkdir()
    monkeypatch.setattr(sessions, "get_live_sessions", dict)
    monkeypatch.setattr(sessions, "get_stored_sessions", dict)
    monkeypatch.setattr(sessions, "_resolve_worktree_workdir", _slow(workdir, str(repo), "feat/x"))

    gap, elapsed, _ = await measure_while(
        app,
        lambda c: c.post(
            "/api/sessions",
            json={
                "name": "newbie",
                "mode": "worktree",
                "worktree": {"parent_repo": str(repo), "branch": "feat/x"},
            },
        ),
    )

    assert elapsed >= SLOW_SECONDS, "the create did not actually run"
    assert gap < MAX_ACCEPTABLE_GAP, (
        f"event loop stalled {gap:.2f}s while a worktree session was created"
    )
