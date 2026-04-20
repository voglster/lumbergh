"""Tests for SessionManager — specifically the copy-mode poll cleanup.

Regression: the 250ms copy-mode polling loop used to swallow subprocess
failures without killing the child, leaking stdout/stderr pipes until the
backend hit EMFILE. These tests lock down the kill+reap contract.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from pytest_mock import MockerFixture

from lumbergh.session_manager import SessionManager


def _make_proc(stdout: bytes = b"", returncode: int | None = None) -> MagicMock:
    """Build a mock asyncio subprocess. returncode=None means 'still running'."""
    proc = MagicMock()
    proc.communicate = AsyncMock(return_value=(stdout, b""))
    proc.wait = AsyncMock(return_value=0)
    proc.kill = MagicMock()
    proc.returncode = returncode
    return proc


async def test_poll_copy_mode_returns_true_when_pane_in_copy_mode(mocker: MockerFixture) -> None:
    proc = _make_proc(stdout=b"copy-mode\n")
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)

    result = await SessionManager()._poll_copy_mode("s1")

    assert result is True
    proc.kill.assert_not_called()


async def test_poll_copy_mode_returns_false_for_normal_pane(mocker: MockerFixture) -> None:
    proc = _make_proc(stdout=b"\n")
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)

    result = await SessionManager()._poll_copy_mode("s1")

    assert result is False
    proc.kill.assert_not_called()


def _fail_wait_for(exc: BaseException):
    """wait_for side_effect that closes the awaited coroutine before raising,
    so AsyncMock-produced coroutines don't linger as un-awaited warnings."""

    async def _raise(coro, timeout):  # noqa: ARG001 — signature must match asyncio.wait_for
        coro.close()
        raise exc

    return _raise


async def test_poll_copy_mode_reaps_proc_on_timeout(mocker: MockerFixture) -> None:
    """TimeoutError during communicate() must kill and await the proc so pipes close."""
    proc = _make_proc(returncode=None)
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)
    mocker.patch("asyncio.wait_for", side_effect=_fail_wait_for(TimeoutError()))

    result = await SessionManager()._poll_copy_mode("s1")

    assert result is None
    proc.kill.assert_called_once()
    proc.wait.assert_called_once()


async def test_poll_copy_mode_reaps_proc_on_oserror(mocker: MockerFixture) -> None:
    """OSError (e.g. EMFILE) during communicate() must also reap the proc."""
    proc = _make_proc(returncode=None)
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)
    mocker.patch(
        "asyncio.wait_for",
        side_effect=_fail_wait_for(OSError(24, "Too many open files")),
    )

    result = await SessionManager()._poll_copy_mode("s1")

    assert result is None
    proc.kill.assert_called_once()
    proc.wait.assert_called_once()


async def test_poll_copy_mode_skips_kill_if_proc_already_exited(mocker: MockerFixture) -> None:
    """If returncode is set, proc has exited — don't try to kill it again."""
    proc = _make_proc(returncode=0)
    mocker.patch("asyncio.create_subprocess_exec", return_value=proc)
    mocker.patch("asyncio.wait_for", side_effect=_fail_wait_for(TimeoutError()))

    result = await SessionManager()._poll_copy_mode("s1")

    assert result is None
    proc.kill.assert_not_called()


async def test_poll_copy_mode_returns_none_when_spawn_itself_fails(
    mocker: MockerFixture,
) -> None:
    """If subprocess spawn raises OSError (EMFILE), there's no proc to reap — just bail."""
    mocker.patch(
        "asyncio.create_subprocess_exec",
        side_effect=OSError(24, "Too many open files"),
    )

    result = await SessionManager()._poll_copy_mode("s1")

    assert result is None


@pytest.fixture(autouse=True)
def _reset_singleton() -> None:
    """SessionManager is a singleton — clear _sessions between tests."""
    mgr = SessionManager()
    mgr._sessions.clear()
