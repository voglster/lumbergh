"""Tests for SessionManager.

Covers the tmux pane-state probe (parsing, and the kill+reap contract that keeps
the 250ms poll loop from leaking fds until EMFILE), the monitor that broadcasts
that state to terminal WebSocket clients, the replay that gives a client joining
a pooled session the current state, and "latest active device wins" sizing.
"""

import asyncio
import contextlib
import logging
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from pytest_mock import MockerFixture

if TYPE_CHECKING:
    from collections.abc import Sized

from lumbergh.session_manager import (
    ManagedSession,
    PaneState,
    SessionManager,
    TerminalClient,
    _parse_pane_state,
)


def _make_proc(stdout: bytes = b"", returncode: int | None = None) -> MagicMock:
    """Build a mock asyncio subprocess. returncode=None means 'still running'.

    A completed communicate() sets returncode, like the real thing: production
    communicate() awaits wait() internally, so it never leaves a reaped-but-
    unrecorded child. Getting this wrong is what made an unconditional reap look
    like it would kill on the success path. Tests that patch wait_for to raise
    never let communicate() finish, so their proc stays "still running" and the
    kill+reap contract is still exercised.
    """
    proc = MagicMock()
    proc.returncode = returncode

    async def communicate() -> tuple[bytes, bytes]:
        proc.returncode = 0
        return (stdout, b"")

    proc.communicate = AsyncMock(side_effect=communicate)
    proc.wait = AsyncMock(return_value=0)
    proc.kill = MagicMock()
    return proc


def _fail_wait_for(exc: BaseException):
    """wait_for side_effect that closes the awaited coroutine before raising,
    so AsyncMock-produced coroutines don't linger as un-awaited warnings."""

    async def _raise(coro, timeout):  # noqa: ARG001 - signature must match asyncio.wait_for
        coro.close()
        raise exc

    return _raise


def test_parse_pane_state_plain_shell() -> None:
    assert _parse_pane_state("|000\n") == PaneState(copy_mode=False, mouse_app=False)


def test_parse_pane_state_copy_mode() -> None:
    assert _parse_pane_state("copy-mode|000\n") == PaneState(copy_mode=True, mouse_app=False)


def test_parse_pane_state_mouse_app() -> None:
    """A fullscreen mouse-mode TUI (Claude Code) sets the tmux mouse flags."""
    assert _parse_pane_state("|111\n") == PaneState(copy_mode=False, mouse_app=True)


def test_parse_pane_state_any_single_mouse_flag_counts() -> None:
    """Only mouse_standard_flag set is still a mouse app."""
    assert _parse_pane_state("|001\n") == PaneState(copy_mode=False, mouse_app=True)


def test_parse_pane_state_fullscreen_without_mouse_is_not_a_mouse_app() -> None:
    """`less` is on the alternate screen but never asks for the mouse, so tmux
    still owns the wheel and the client must not take it over."""
    assert _parse_pane_state("|000\n") == PaneState(copy_mode=False, mouse_app=False)


def test_parse_pane_state_tolerates_unknown_format_variable() -> None:
    """A tmux too old to know these variables yields empty output. Falling back
    to mouse_app=False keeps the safe native-scroll path."""
    assert _parse_pane_state("") == PaneState(copy_mode=False, mouse_app=False)


async def test_poll_pane_state_reports_copy_mode(mocker: MockerFixture) -> None:
    proc = _make_proc(stdout=b"copy-mode|000\n")
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)

    result = await SessionManager()._poll_pane_state("s1")

    assert result == PaneState(copy_mode=True, mouse_app=False)
    proc.kill.assert_not_called()


async def test_poll_pane_state_reports_mouse_app(mocker: MockerFixture) -> None:
    proc = _make_proc(stdout=b"|111\n")
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)

    result = await SessionManager()._poll_pane_state("s1")

    assert result == PaneState(copy_mode=False, mouse_app=True)
    proc.kill.assert_not_called()


async def test_poll_pane_state_returns_false_for_normal_pane(mocker: MockerFixture) -> None:
    proc = _make_proc(stdout=b"|000\n")
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)

    result = await SessionManager()._poll_pane_state("s1")

    assert result == PaneState(copy_mode=False, mouse_app=False)
    proc.kill.assert_not_called()


async def test_poll_pane_state_returns_none_on_undecodable_output(mocker: MockerFixture) -> None:
    """Undecodable bytes must degrade to None, the safe native path, rather than
    escaping. The monitor now logs and continues, so an escape is survivable, but
    a probe that raises instead of reporting "unknown" would drop a real sample
    on every hiccup and log noise for a case with a defined answer."""
    proc = _make_proc(stdout=b"\xff\xfe|000\n")
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)

    assert await SessionManager()._poll_pane_state("s1") is None


async def test_poll_pane_state_reaps_proc_on_timeout(mocker: MockerFixture) -> None:
    """TimeoutError during communicate() must kill and await the proc so pipes close."""
    proc = _make_proc(returncode=None)
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)
    mocker.patch("asyncio.wait_for", side_effect=_fail_wait_for(TimeoutError()))

    result = await SessionManager()._poll_pane_state("s1")

    assert result is None
    proc.kill.assert_called_once()
    proc.wait.assert_awaited_once()


async def test_poll_pane_state_reaps_proc_on_oserror(mocker: MockerFixture) -> None:
    """OSError (e.g. EMFILE) during communicate() must also reap the proc."""
    proc = _make_proc(returncode=None)
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)
    mocker.patch("asyncio.wait_for", side_effect=_fail_wait_for(OSError("boom")))

    result = await SessionManager()._poll_pane_state("s1")

    assert result is None
    proc.kill.assert_called_once()
    proc.wait.assert_awaited_once()


async def test_poll_pane_state_reaps_proc_on_cancellation(mocker: MockerFixture) -> None:
    """Session teardown cancels the monitor, which can land mid-communicate().
    The child must still be killed, and the cancellation must propagate."""
    proc = _make_proc(returncode=None)
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)
    mocker.patch("asyncio.wait_for", side_effect=_fail_wait_for(asyncio.CancelledError()))

    with pytest.raises(asyncio.CancelledError):
        await SessionManager()._poll_pane_state("s1")

    proc.kill.assert_called_once()
    proc.wait.assert_awaited_once()


async def test_poll_pane_state_reaps_proc_on_unexpected_error(mocker: MockerFixture) -> None:
    """The reap has to cover exceptions nobody enumerated, or the EMFILE
    pipe-leak class stays open for every failure mode not on the list."""
    proc = _make_proc(returncode=None)
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)
    mocker.patch("asyncio.wait_for", side_effect=_fail_wait_for(IndexError("boom")))

    with pytest.raises(IndexError):
        await SessionManager()._poll_pane_state("s1")

    proc.kill.assert_called_once()
    proc.wait.assert_awaited_once()


async def test_poll_pane_state_survives_a_kill_that_errors(mocker: MockerFixture) -> None:
    """The reap runs in a finally, while an exception may already be propagating,
    so it must not raise: doing so would replace the real error with a confusing
    one. It must still try to reap after a failed kill."""
    proc = _make_proc(returncode=None)
    proc.kill.side_effect = PermissionError("operation not permitted")
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)
    mocker.patch("asyncio.wait_for", side_effect=_fail_wait_for(TimeoutError()))

    assert await SessionManager()._poll_pane_state("s1") is None
    proc.wait.assert_awaited_once()


async def test_poll_pane_state_skips_kill_if_proc_already_exited(mocker: MockerFixture) -> None:
    """If returncode is set, proc has exited - don't try to kill it again."""
    proc = _make_proc(returncode=0)
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)
    mocker.patch("asyncio.wait_for", side_effect=_fail_wait_for(TimeoutError()))

    result = await SessionManager()._poll_pane_state("s1")

    assert result is None
    proc.kill.assert_not_called()


async def test_poll_pane_state_returns_none_when_spawn_itself_fails(
    mocker: MockerFixture,
) -> None:
    """If subprocess spawn raises OSError, there's no proc to reap - just bail."""
    mocker.patch(
        "asyncio.create_subprocess_exec",
        side_effect=OSError("no tmux"),
    )

    result = await SessionManager()._poll_pane_state("s1")

    assert result is None


@pytest.fixture(autouse=True)
def _reset_singleton() -> None:
    """SessionManager is a singleton — clear _sessions between tests."""
    mgr = SessionManager()
    mgr._sessions.clear()


def _fake_pty() -> MagicMock:
    pty = MagicMock()
    pty.cols = 80
    pty.rows = 24

    def resize(cols: int, rows: int) -> None:
        pty.cols, pty.rows = cols, rows

    pty.resize.side_effect = resize
    return pty


def _register(mgr: SessionManager, name: str, *clients: AsyncMock) -> ManagedSession:
    managed = ManagedSession(pty=_fake_pty())
    managed.clients.update(cast("tuple[TerminalClient, ...]", clients))
    mgr._sessions[name] = managed
    return managed


def _last_sync(client: AsyncMock) -> tuple[int, int] | None:
    """Return (cols, rows) of the most recent resize_sync sent to a client."""
    for call in reversed(client.send_json.call_args_list):
        msg = call.args[0]
        if msg.get("type") == "resize_sync":
            return (msg["cols"], msg["rows"])
    return None


async def test_latest_active_device_wins_shared_size() -> None:
    """Desktop is active first; then the phone activates. The phone (latest
    active) drives the shared window and every client is synced to its size."""
    mgr = SessionManager()
    desktop, phone = AsyncMock(), AsyncMock()
    managed = _register(mgr, "s", desktop, phone)

    await mgr.handle_client_message("s", {"type": "activate", "cols": 200, "rows": 50}, desktop)
    await mgr.handle_client_message("s", {"type": "activate", "cols": 48, "rows": 40}, phone)

    assert (managed.pty.cols, managed.pty.rows) == (48, 40)
    assert _last_sync(desktop) == (48, 40)


async def test_backgrounded_device_yields_window_to_remaining_device() -> None:
    """When the active phone backgrounds, the desktop reclaims the window and
    all clients are resized back to the desktop's size."""
    mgr = SessionManager()
    desktop, phone = AsyncMock(), AsyncMock()
    managed = _register(mgr, "s", desktop, phone)

    await mgr.handle_client_message("s", {"type": "activate", "cols": 200, "rows": 50}, desktop)
    await mgr.handle_client_message("s", {"type": "activate", "cols": 48, "rows": 40}, phone)
    await mgr.handle_client_message("s", {"type": "deactivate"}, phone)

    assert (managed.pty.cols, managed.pty.rows) == (200, 50)
    assert _last_sync(phone) == (200, 50)


async def test_background_resize_does_not_steal_window() -> None:
    """A resize from a backgrounded device updates its stored size but must not
    yank the window away from the active device."""
    mgr = SessionManager()
    desktop, phone = AsyncMock(), AsyncMock()
    managed = _register(mgr, "s", desktop, phone)

    await mgr.handle_client_message("s", {"type": "activate", "cols": 48, "rows": 40}, phone)
    # Desktop never activated (background tab) but reports a layout change.
    await mgr.handle_client_message("s", {"type": "resize", "cols": 200, "rows": 50}, desktop)

    assert (managed.pty.cols, managed.pty.rows) == (48, 40)


async def test_disconnect_lets_remaining_device_reclaim_window() -> None:
    """Unregistering the active device hands the window to whoever is left."""
    mgr = SessionManager()
    desktop, phone = AsyncMock(), AsyncMock()
    managed = _register(mgr, "s", desktop, phone)

    await mgr.handle_client_message("s", {"type": "activate", "cols": 200, "rows": 50}, desktop)
    await mgr.handle_client_message("s", {"type": "activate", "cols": 48, "rows": 40}, phone)

    await mgr.unregister_client("s", phone)

    assert (managed.pty.cols, managed.pty.rows) == (200, 50)
    assert _last_sync(desktop) == (200, 50)


class _RecordingClient:
    """Minimal stand-in for TerminalClient that records broadcast messages."""

    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.messages.append(message)


@pytest.fixture
def _fast_polling(mocker: MockerFixture) -> None:
    """Shorten the monitor's poll interval so tests don't wait 250ms per tick.

    Still a real asyncio.sleep, just a shorter one - the loop keeps yielding to
    the event loop, which is exactly what replacing asyncio.sleep with a bare
    AsyncMock destroys (see _run_monitor_until).

    Must not drop below _run_monitor_until's 10ms check granularity. At 10ms the
    monitor's period is that sleep *plus* the poll work, so it can never gain a
    full tick on the checker and the exact-count assertions hold. Going lower
    lets it overshoot: at 5ms, the exact-list assertion in
    test_monitor_treats_a_failed_poll_as_no_change fails ~98% of the time.
    """
    mocker.patch("lumbergh.session_manager._PANE_POLL_INTERVAL", 0.01)


async def _run_monitor_until(
    mgr: SessionManager, session_name: str, observed: "Sized", count: int, what: str
) -> None:
    """Run the monitor until `observed` holds `count` items, then cancel it.

    `observed` is a collection the monitor appends to indirectly - broadcasts
    recorded by a _RecordingClient, or polls recorded by a stubbed
    _poll_pane_state. Gating on recorded progress rather than on elapsed wall
    clock means a starved event loop can only make the test slower, never flaky.

    Deliberately does NOT patch asyncio.sleep. A bare AsyncMock replacement
    never yields to the event loop, which turns the monitor's poll loop into a
    tight non-yielding spin and hangs the test. Shortening the interval (see the
    _fast_polling fixture) keeps the sleep real.
    """
    task = asyncio.create_task(mgr._pane_state_monitor(session_name))
    try:
        for _ in range(300):  # ~3s ceiling at 10ms granularity
            if len(observed) >= count:
                return
            await asyncio.sleep(0.01)
        raise AssertionError(f"only got {len(observed)} {what}, wanted {count}")
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


def _seed_session(mgr: SessionManager, name: str, client: _RecordingClient) -> ManagedSession:
    managed = ManagedSession(pty=_fake_pty())
    managed.clients.add(client)
    mgr._sessions[name] = managed
    return managed


@pytest.mark.usefixtures("_fast_polling")
async def test_monitor_broadcasts_first_poll_even_when_state_never_changes(
    mocker: MockerFixture,
) -> None:
    """A client connecting while Claude Code is already running must still learn
    mouse_app=True - otherwise the wheel stays on the native path forever."""
    mgr = SessionManager()
    client = _RecordingClient()
    _seed_session(mgr, "s1", client)
    mocker.patch.object(
        mgr, "_poll_pane_state", return_value=PaneState(copy_mode=False, mouse_app=True)
    )

    await _run_monitor_until(mgr, "s1", client.messages, 1, "messages")

    assert client.messages[0] == {"type": "copy_mode", "active": False, "mouse_app": True}


@pytest.mark.usefixtures("_fast_polling")
async def test_monitor_broadcasts_when_only_mouse_app_changes(mocker: MockerFixture) -> None:
    mgr = SessionManager()
    client = _RecordingClient()
    _seed_session(mgr, "s1", client)
    # A finite side_effect list would raise StopIteration once the poll loop
    # outruns it. Clamp to the final state instead.
    pending = iter(
        [
            PaneState(copy_mode=False, mouse_app=False),
            PaneState(copy_mode=False, mouse_app=True),
        ]
    )
    final = PaneState(copy_mode=False, mouse_app=True)

    async def poll(_session_name: str) -> PaneState:
        return next(pending, final)

    mocker.patch.object(mgr, "_poll_pane_state", side_effect=poll)

    await _run_monitor_until(mgr, "s1", client.messages, 2, "messages")

    assert client.messages[0]["mouse_app"] is False
    assert client.messages[1]["mouse_app"] is True


@pytest.mark.usefixtures("_fast_polling")
async def test_monitor_does_not_rebroadcast_unchanged_state(mocker: MockerFixture) -> None:
    mgr = SessionManager()
    client = _RecordingClient()
    _seed_session(mgr, "s1", client)
    state = PaneState(copy_mode=True, mouse_app=False)
    polls: list[PaneState | None] = []

    async def poll(_session_name: str) -> PaneState:
        polls.append(state)
        return state

    mocker.patch.object(mgr, "_poll_pane_state", side_effect=poll)

    # Wait for four identical polls: the first broadcasts, the rest must stay
    # silent. Gated on polls (not elapsed time) so the assertion means "four
    # polls happened and one message was sent".
    await _run_monitor_until(mgr, "s1", polls, 4, "polls")

    assert len(client.messages) == 1


@pytest.mark.usefixtures("_fast_polling")
async def test_monitor_treats_a_failed_poll_as_no_change(mocker: MockerFixture) -> None:
    """tmux display-message can time out on a loaded box. That is not a state
    change - resetting the remembered state on failure would re-broadcast
    identical state on every hiccup and churn the frontend."""
    mgr = SessionManager()
    client = _RecordingClient()
    _seed_session(mgr, "s1", client)
    state = PaneState(copy_mode=True, mouse_app=False)
    polls: list[PaneState | None] = []

    async def poll(_session_name: str) -> PaneState | None:
        # S, S, None, S - the failed probe sits between identical states.
        result = None if len(polls) == 2 else state
        polls.append(result)
        return result

    mocker.patch.object(mgr, "_poll_pane_state", side_effect=poll)

    await _run_monitor_until(mgr, "s1", polls, 4, "polls")

    assert polls == [state, state, None, state]
    assert len(client.messages) == 1


@pytest.mark.usefixtures("_fast_polling")
async def test_monitor_survives_an_unexpected_poll_error(mocker: MockerFixture) -> None:
    """An unexpected exception must not kill the monitor task. _parse_pane_state
    is total today, but the next format variable parsed with split()[2] raises
    IndexError, which is not a ValueError. A dead monitor stops every future
    update AND poisons unregister_client's teardown."""
    mgr = SessionManager()
    client = _RecordingClient()
    _seed_session(mgr, "s1", client)
    state = PaneState(copy_mode=False, mouse_app=True)
    polls: list[str] = []

    async def poll(_session_name: str) -> PaneState:
        polls.append("called")
        if len(polls) == 1:
            raise IndexError("a future format-variable parse bug")
        return state

    mocker.patch.object(mgr, "_poll_pane_state", side_effect=poll)

    await _run_monitor_until(mgr, "s1", client.messages, 1, "messages")

    # Recovered on the poll after the exception rather than dying on it.
    assert client.messages == [{"type": "copy_mode", "active": False, "mouse_app": True}]


@pytest.mark.usefixtures("_fast_polling")
async def test_monitor_logs_a_persistent_poll_failure_only_once(
    mocker: MockerFixture, caplog: pytest.LogCaptureFixture
) -> None:
    """The guard exists to survive unenumerated bugs, and those are usually
    deterministic - so they fail on every poll. At 4 Hz, logging each one buries
    the journal in identical tracebacks for as long as the session lives. One
    record per outage, with the traceback intact."""
    mgr = SessionManager()
    client = _RecordingClient()
    _seed_session(mgr, "s1", client)
    polls: list[str] = []

    async def poll(_session_name: str) -> PaneState:
        polls.append("called")
        raise IndexError("deterministic parse bug")

    mocker.patch.object(mgr, "_poll_pane_state", side_effect=poll)

    with caplog.at_level(logging.INFO, logger="lumbergh.session_manager"):
        await _run_monitor_until(mgr, "s1", polls, 5, "polls")

    errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(errors) == 1, f"{len(polls)} failing polls produced {len(errors)} records"
    assert errors[0].exc_info is not None, "the one record we keep must carry the traceback"


@pytest.mark.usefixtures("_fast_polling")
async def test_monitor_logs_again_after_a_recovery(
    mocker: MockerFixture, caplog: pytest.LogCaptureFixture
) -> None:
    """Throttling is per outage, not for the life of the monitor: a fresh failure
    after a good poll is news again, and the recovery itself is logged so an
    operator can see how long the window was."""
    mgr = SessionManager()
    client = _RecordingClient()
    _seed_session(mgr, "s1", client)
    polls: list[str] = []

    async def poll(_session_name: str) -> PaneState:
        # fail, fail, succeed, fail, fail
        polls.append("called")
        if len(polls) == 3:
            return PaneState(copy_mode=False, mouse_app=True)
        raise IndexError("flapping")

    mocker.patch.object(mgr, "_poll_pane_state", side_effect=poll)

    with caplog.at_level(logging.INFO, logger="lumbergh.session_manager"):
        await _run_monitor_until(mgr, "s1", polls, 5, "polls")

    errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(errors) == 2
    assert any("recovered" in r.message for r in caplog.records if r.levelno == logging.INFO)


async def test_unregister_closes_pty_even_if_the_monitor_died(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Awaiting a task that failed re-raises its exception. If teardown doesn't
    absorb that, pty.close() and the _sessions removal are skipped - leaking the
    PTY and leaving an entry that hands out a dead PTY forever."""
    mgr = SessionManager()
    client = AsyncMock()
    managed = _register(mgr, "s", client)

    async def boom() -> None:
        raise NotImplementedError("boom")

    managed.pane_state_task = asyncio.create_task(boom())
    # Await it here so the failure is deterministic, not timing-dependent. A Task
    # re-raises its stored exception on every await, so teardown still hits it.
    with contextlib.suppress(NotImplementedError):
        await managed.pane_state_task

    with caplog.at_level(logging.ERROR, logger="lumbergh.session_manager"):
        await mgr.unregister_client("s", client)

    cast("MagicMock", managed.pty).close.assert_called_once()
    assert "s" not in mgr._sessions
    # Absorbing the error must not mean hiding it. This fires at most once per
    # teardown, so it is the one place the traceback is both free and essential.
    assert [r for r in caplog.records if r.exc_info], "dead task logged with no traceback"


@pytest.mark.usefixtures("_fast_polling")
async def test_client_joining_pooled_session_gets_current_pane_state(
    mocker: MockerFixture,
) -> None:
    """The monitor is created once per PTY and only speaks on change, so a second
    client on a pooled session (pop-out window, second device, cloud tunnel)
    would otherwise never learn mouse_app and would lose its wheel scrolling."""
    mgr = SessionManager()
    first = _RecordingClient()
    _seed_session(mgr, "s1", first)
    mocker.patch.object(
        mgr, "_poll_pane_state", return_value=PaneState(copy_mode=False, mouse_app=True)
    )
    # Joining an existing PTY asks tmux for a native redraw; pretend it worked so
    # register_client doesn't fall back to a capture-pane snapshot.
    mocker.patch("lumbergh.session_manager.refresh_client", return_value=True)

    await _run_monitor_until(mgr, "s1", first.messages, 1, "messages")

    second = _RecordingClient()
    await mgr.register_client("s1", second)

    assert second.messages == [{"type": "copy_mode", "active": False, "mouse_app": True}]


async def test_client_joining_before_any_poll_is_not_replayed_anything(
    mocker: MockerFixture,
) -> None:
    """Before the monitor's first poll there is nothing to replay - the client
    learns the state from that first broadcast instead."""
    mgr = SessionManager()
    client = _RecordingClient()
    managed = _seed_session(mgr, "s1", client)
    mocker.patch("lumbergh.session_manager.refresh_client", return_value=True)

    assert managed.pane_state is None
    await mgr.register_client("s1", client)

    assert client.messages == []
