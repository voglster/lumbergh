"""
Session manager for PTY pooling - ensures one PTY per tmux session.

This prevents React StrictMode double-mounts from creating multiple
tmux attach-session processes for the same session.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

from lumbergh.constants import TMUX_CMD
from lumbergh.tmux_pty import (
    IS_WINDOWS,
    TmuxPtySession,
    capture_pane_content,
    refresh_client,
)

logger = logging.getLogger(__name__)


@runtime_checkable
class TerminalClient(Protocol):
    """Any object that can receive JSON messages (WebSocket or CloudClient)."""

    async def send_json(self, data: dict) -> None: ...


# tmux tells us what the pane's foreground app is doing. The three mouse flags
# mean "this app asked for mouse reporting" - exactly when tmux forwards wheel
# reports to the app instead of scrolling its own history. `|` separates the
# mode from the flags because pane_mode can be empty.
_PANE_STATE_FORMAT = "#{pane_mode}|#{mouse_any_flag}#{mouse_button_flag}#{mouse_standard_flag}"

# How often the monitor samples pane state. Quick enough that entering copy mode
# or launching a fullscreen TUI feels instant, slow enough that the tmux probe
# stays cheap. Tests shorten it rather than faking asyncio.sleep.
_PANE_POLL_INTERVAL = 0.25


@dataclass(frozen=True)
class PaneState:
    """Pane state sampled from tmux, broadcast to terminal WebSocket clients."""

    copy_mode: bool
    # True for fullscreen mouse-mode TUIs (Claude Code). Such panes need
    # PageUp/PageDown to scroll; every other pane must keep native wheel ->
    # xterm mouse report -> tmux copy-mode scrolling.
    mouse_app: bool


def _pane_state_message(state: PaneState) -> dict:
    """Build the wire message for a pane state.

    The type stays ``copy_mode`` and the copy-mode field stays ``active`` so a
    stale service-worker-cached frontend ignores the extra key instead of
    breaking. Kept in one place so that wart can't spread.
    """
    return {"type": "copy_mode", "active": state.copy_mode, "mouse_app": state.mouse_app}


def _parse_pane_state(raw: str) -> PaneState:
    """Parse ``_PANE_STATE_FORMAT`` output.

    A tmux that does not know a format variable emits nothing for it, so an
    unparseable line degrades to "not a mouse app" - the safe native path.
    """
    mode, _, mouse_flags = raw.strip().partition("|")
    return PaneState(copy_mode=mode == "copy-mode", mouse_app="1" in mouse_flags)


async def _cancel_task(task: asyncio.Task, label: str, session_name: str) -> None:
    """Cancel a background task and absorb however it ended.

    A task that already died with a real exception re-raises it here on await.
    Letting that escape would skip the caller's remaining teardown - the PTY
    close and the ``_sessions`` removal - leaving a leaked PTY cached under the
    session name and handed out to every later client.
    """
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:
        # Full traceback: this fires at most once per teardown, and a task that
        # died on its own is the one thing worth diagnosing here.
        logger.exception(f"{label} for {session_name} ended in error")


async def _kill_and_reap(proc: asyncio.subprocess.Process | None) -> None:
    """Kill a still-running probe subprocess and await it so its pipes close.

    A no-op once the child has exited - a completed ``communicate()`` has
    already reaped it, which is why callers can run this unconditionally.

    Best-effort, and that is load-bearing: callers run this while an exception is
    already propagating, so anything raising here would replace it and kill the
    monitor task. Hence both steps swallow errors, and a kill that fails still
    falls through to the wait.
    """
    if proc is None or proc.returncode is not None:
        return
    try:
        proc.kill()
    except OSError:
        # Broad on purpose - see above. ProcessLookupError (child already gone)
        # is the expected one; a kill we simply can't perform must not become
        # the monitor's problem either, and wait() below still runs regardless.
        pass
    try:
        await proc.wait()
    except Exception:  # noqa: S110 - best-effort reap
        pass


@dataclass
class ManagedSession:
    """A PTY session with multiple connected WebSocket clients."""

    pty: TmuxPtySession
    clients: set[TerminalClient] = field(default_factory=set)
    read_task: asyncio.Task | None = None
    pane_state_task: asyncio.Task | None = None
    # Last pane state broadcast by the monitor. Lives on the session (not in the
    # monitor coroutine) because the monitor is created once per PTY: a client
    # joining a pooled session needs the current state replayed to it, since the
    # monitor's change-detection has nothing new to announce.
    pane_state: PaneState | None = None
    # "Latest active device wins" sizing. A tmux window has one size for every
    # client, so when the same session is open on e.g. a phone and a desktop we
    # can't show both at their native size at once. Instead the most recently
    # activated (focused/foregrounded) client drives the shared size; the others
    # reflow to match via resize_sync. Backgrounded clients drop out of
    # ``active_clients`` so the remaining device reclaims the window.
    client_sizes: dict[TerminalClient, tuple[int, int]] = field(default_factory=dict)
    active_clients: set[TerminalClient] = field(default_factory=set)
    activity_seq: dict[TerminalClient, int] = field(default_factory=dict)
    seq_counter: int = 0
    applied_size: tuple[int, int] | None = None


class SessionManager:
    """
    Singleton manager for PTY sessions.

    - One PTY per tmux session name (no duplicates)
    - Multiple WebSocket clients can share a PTY
    - PTY closes only when last client disconnects
    """

    _instance: "SessionManager | None" = None

    def __new__(cls) -> "SessionManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._sessions = {}
            cls._instance._lock = asyncio.Lock()
        return cls._instance

    def __init__(self):
        # Only initialize once
        if not hasattr(self, "_initialized"):
            self._sessions: dict[str, ManagedSession] = {}
            self._lock: asyncio.Lock = asyncio.Lock()
            self._initialized = True

    async def register_client(
        self,
        session_name: str,
        websocket: TerminalClient,
        initial_cols: int | None = None,
        initial_rows: int | None = None,
    ) -> ManagedSession:
        """
        Register a WebSocket client for a tmux session.
        Creates the PTY if this is the first client.
        Auto-recreates the tmux session if it exists in TinyDB but not in tmux.
        Sends current pane content to new client for immediate display.

        ``initial_cols`` / ``initial_rows`` let the client tell us its viewport
        size up front so the PTY (and therefore tmux's window-size-latest reflow)
        starts at the right dimensions. Without this, every fresh attach lands
        at the hardcoded 80x24, tmux reflows the window for the agent, we
        capture-pane at that size, and the client renders a mangled snapshot
        until it sends a delayed resize message.
        """
        from lumbergh.routers.sessions import create_tmux_session, get_stored_sessions

        is_new_pty = False
        async with self._lock:
            if session_name not in self._sessions:
                # Create new PTY for this session
                logger.info(f"Creating new PTY for session: {session_name}")
                pty = TmuxPtySession(session_name)
                if initial_cols and initial_rows:
                    pty.cols = initial_cols
                    pty.rows = initial_rows
                is_new_pty = True
                try:
                    pty.spawn()
                except ValueError:
                    # Session missing from tmux - try auto-recreate from TinyDB
                    logger.info(f"Session '{session_name}' not in tmux, checking TinyDB...")
                    session_meta = get_stored_sessions().get(session_name)
                    if session_meta and session_meta.get("workdir"):
                        workdir = Path(session_meta["workdir"])
                        if workdir.exists():
                            logger.info(
                                f"Auto-recreating tmux session: {session_name} in {workdir}"
                            )
                            try:
                                create_tmux_session(session_name, workdir)
                            except RuntimeError as create_err:
                                logger.error(f"Failed to create tmux session: {create_err}")
                                raise ValueError(f"Failed to recreate session: {create_err}")
                            pty.spawn()  # Retry
                            logger.info(f"Successfully recreated session: {session_name}")
                        else:
                            logger.warning(f"Workdir no longer exists: {workdir}")
                            raise ValueError(f"Workdir no longer exists: {workdir}")
                    else:
                        logger.warning(f"Session '{session_name}' not found in TinyDB")
                        raise  # Re-raise if not in TinyDB

                managed = ManagedSession(pty=pty)
                self._sessions[session_name] = managed

                # Start the read loop and pane-state monitor tasks
                managed.read_task = asyncio.create_task(self._broadcast_loop(session_name))
                managed.pane_state_task = asyncio.create_task(
                    self._pane_state_monitor(session_name)
                )
            else:
                logger.info(f"Reusing existing PTY for session: {session_name}")
                managed = self._sessions[session_name]

            managed.clients.add(websocket)
            logger.info(f"Session {session_name}: {len(managed.clients)} client(s) connected")

        # For a fresh PTY, ``tmux attach-session`` will stream a full redraw
        # to the new client — nothing else to do. When joining an existing
        # pooled PTY there's no fresh attach, so we ask tmux to redraw the
        # client with ``refresh-client``: that streams a genuine full repaint
        # (pane + status bar + borders) through the PTY, which the broadcast
        # loop forwards to this new client. Only if that fails do we fall back
        # to the reconstructed capture-pane snapshot (which can't reproduce the
        # status bar/borders — the source of the "missing decorations" repaint).
        if not is_new_pty:
            await self._send_initial_repaint(session_name, websocket)
            # The monitor only speaks up when the state *changes*, and it has
            # already announced the current one to the clients that were here
            # first. Replay it so this client also knows whether the pane is a
            # mouse-mode app (wheel scrolling depends on it).
            if managed.pane_state is not None:
                # Built outside the try so a bug in here surfaces instead of
                # being mistaken for a send failure, and so it is evident that
                # nothing awaits between reading the state and sending it.
                message = _pane_state_message(managed.pane_state)
                try:
                    await websocket.send_json(message)
                except Exception as e:
                    logger.warning(f"Failed to replay pane state for {session_name}: {e}")

        return managed

    async def _send_initial_repaint(self, session_name: str, websocket: TerminalClient) -> None:
        """Repaint a client joining an already-attached (pooled) PTY.

        Prefers a native ``tmux refresh-client`` redraw (pane + status bar +
        borders); falls back to the reconstructed capture-pane snapshot (which
        can't reproduce the status bar/borders) only when no client is attached
        for tmux to redraw.
        """
        loop = asyncio.get_event_loop()
        try:
            refreshed = await loop.run_in_executor(None, refresh_client, session_name)
        except Exception as e:
            logger.warning(f"refresh-client failed for {session_name}: {e}")
            refreshed = False
        if refreshed:
            return
        try:
            content = await loop.run_in_executor(None, capture_pane_content, session_name)
            if content:
                await websocket.send_json({"type": "output", "data": content})
                logger.info(f"Sent initial pane capture to client ({len(content)} chars)")
        except Exception as e:
            logger.warning(f"Failed to send initial pane capture: {e}")

    async def unregister_client(self, session_name: str, websocket: TerminalClient) -> None:
        """
        Unregister a WebSocket client.
        Closes the PTY if this was the last client.
        """
        still_connected = False
        async with self._lock:
            if session_name not in self._sessions:
                return

            managed = self._sessions[session_name]
            managed.clients.discard(websocket)
            managed.client_sizes.pop(websocket, None)
            managed.active_clients.discard(websocket)
            managed.activity_seq.pop(websocket, None)

            logger.info(f"Session {session_name}: {len(managed.clients)} client(s) remaining")

            if not managed.clients:
                # Last client disconnected, cleanup
                logger.info(f"Closing PTY for session: {session_name}")

                if managed.read_task:
                    await _cancel_task(managed.read_task, "Read loop", session_name)

                if managed.pane_state_task:
                    await _cancel_task(managed.pane_state_task, "Pane state monitor", session_name)

                managed.pty.close()
                del self._sessions[session_name]
            else:
                still_connected = True

        # A device left — let the most-recently-active remaining device reclaim
        # the window size (done outside the lock so the resize_sync sends don't
        # block other register/unregister calls).
        if still_connected:
            await self._apply_active_size(session_name)

    async def _check_eof(
        self, session_name: str, managed: ManagedSession, consecutive_eof: int
    ) -> tuple[int, bool]:
        """Handle EOF from PTY read. Returns (new_eof_count, should_break)."""
        consecutive_eof += 1
        if consecutive_eof < 3:
            return consecutive_eof, False
        loop = asyncio.get_event_loop()
        is_alive = await loop.run_in_executor(None, managed.pty.is_alive)
        if not is_alive:
            logger.warning(f"Session {session_name} died, notifying clients")
            await self._notify_session_dead(session_name)
            await self.evict(session_name)
            return consecutive_eof, True
        return consecutive_eof, False

    async def _broadcast_data(self, managed: ManagedSession, data: bytes) -> None:
        """Broadcast data to all connected clients, pruning disconnected ones."""
        message = {
            "type": "output",
            "data": data.decode("utf-8", errors="replace"),
        }
        disconnected = []
        for client in list(managed.clients):
            try:
                await client.send_json(message)
            except Exception:
                disconnected.append(client)
        for client in disconnected:
            managed.clients.discard(client)

    async def _batch_drain(
        self,
        initial_data: bytes,
        managed: ManagedSession,
        data_ready: asyncio.Event,
    ) -> bytes:
        """Accumulate PTY output for up to ~16ms to reduce WebSocket message frequency."""
        batch_interval = 0.016  # ~16ms (one frame at 60fps)
        max_batch_size = 32768

        buffer = bytearray(initial_data)
        try:
            await asyncio.wait_for(data_ready.wait(), timeout=batch_interval)
            data_ready.clear()
            while len(buffer) < max_batch_size:
                chunk = managed.pty.read()
                if not chunk:  # None (not ready) or b"" (EOF)
                    break
                buffer.extend(chunk)
                if not data_ready.is_set():
                    break
                data_ready.clear()
        except TimeoutError:
            pass  # Batch window expired, send what we have
        return bytes(buffer)

    async def _broadcast_loop(self, session_name: str) -> None:
        """Read from PTY and broadcast to all connected clients.

        On Unix, uses loop.add_reader (epoll) for fd watching with output
        batching. Accumulates data for up to ~16ms before sending to reduce
        WebSocket message frequency during rapid terminal output.

        On Windows, winpty handles aren't selectable, so we fall back to a
        polling loop that runs the blocking-ish read in a thread executor.
        """
        managed = self._sessions.get(session_name)
        if not managed:
            return

        if IS_WINDOWS:
            await self._broadcast_loop_windows(session_name)
            return

        if managed.pty.master_fd is None:
            return

        fd = managed.pty.master_fd
        loop = asyncio.get_event_loop()
        data_ready = asyncio.Event()
        loop.add_reader(fd, data_ready.set)

        try:
            await self._broadcast_loop_unix(session_name, data_ready)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Broadcast loop error: {e}")
        finally:
            try:
                loop.remove_reader(fd)
            except Exception:  # noqa: S110 - cleanup is best-effort
                pass

    async def _broadcast_loop_unix(self, session_name: str, data_ready: asyncio.Event) -> None:
        consecutive_eof = 0
        while True:
            await data_ready.wait()
            data_ready.clear()

            managed = self._sessions.get(session_name)
            if not managed:
                break

            data = managed.pty.read()
            if data == b"":
                consecutive_eof, should_break = await self._check_eof(
                    session_name, managed, consecutive_eof
                )
                if should_break:
                    break
                continue

            consecutive_eof = 0
            if not data:
                continue

            batched = await self._batch_drain(data, managed, data_ready)
            await self._broadcast_data(managed, batched)

    async def _broadcast_loop_windows(self, session_name: str) -> None:
        """Polling-based broadcast loop for Windows winpty PTYs."""
        loop = asyncio.get_event_loop()
        consecutive_eof = 0
        try:
            while True:
                managed = self._sessions.get(session_name)
                if not managed:
                    break

                data = await loop.run_in_executor(None, managed.pty.read)

                if data == b"":
                    consecutive_eof, should_break = await self._check_eof(
                        session_name, managed, consecutive_eof
                    )
                    if should_break:
                        break
                    continue

                if not data:
                    # No data available — wait briefly to prevent busy loop.
                    await asyncio.sleep(0.01)
                    continue

                consecutive_eof = 0
                await self._broadcast_data(managed, data)
                await asyncio.sleep(0.005)  # yield
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Windows broadcast loop error: {e}")

    async def _poll_pane_state(self, session_name: str) -> PaneState | None:
        """Return the pane's copy-mode + mouse-app state, or None if the probe failed.

        The reap runs in a ``finally`` rather than per-exception: any escape
        route - timeout, cancellation on session teardown, an unenumerated bug,
        even KeyboardInterrupt - otherwise leaks the child's stdout/stderr pipes,
        and at one poll per 250ms that reaches EMFILE. It costs nothing on the
        success path because a completed ``communicate()`` has already reaped.

        Every statement that can raise stays inside the try - notably the decode,
        whose UnicodeDecodeError is a ValueError, so undecodable output degrades
        to None instead of escaping.
        """
        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                TMUX_CMD,
                "display-message",
                "-p",
                "-t",
                session_name,
                _PANE_STATE_FORMAT,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=1.0)
            return _parse_pane_state(stdout.decode())
        except (TimeoutError, OSError, ValueError):
            return None
        finally:
            await _kill_and_reap(proc)

    async def _pane_state_monitor(self, session_name: str) -> None:
        """Poll tmux pane state every 250ms and broadcast changes.

        ``managed.pane_state`` starts as None so the first successful poll is
        always sent: a client that connects while a fullscreen mouse-mode app is
        already running has to learn ``mouse_app`` even though nothing changes
        after it connects. Later joiners get the same state replayed by
        register_client, because from here nothing has changed.

        A failed poll (None) is not a state change - it leaves the last known
        state in place rather than forcing a re-broadcast on every tmux hiccup.

        Unexpected errors are logged and the loop keeps going. Letting one kill
        the task would stop every future update and, worse, poison teardown:
        awaiting a failed task re-raises, so unregister_client would skip
        pty.close() and leave a dead PTY cached under this name.
        """
        consecutive_failures = 0
        try:
            while True:
                await asyncio.sleep(_PANE_POLL_INTERVAL)
                managed = self._sessions.get(session_name)
                if not managed or not managed.clients:
                    break
                try:
                    await self._poll_and_broadcast_pane_state(session_name, managed)
                except Exception:
                    # Once per outage, not once per poll. The errors this guard
                    # exists for are typically deterministic - a parse bug, a
                    # format variable some tmux build renders differently - so
                    # they recur every interval, and an unthrottled traceback at
                    # 4 Hz would bury the journal for the life of the session.
                    consecutive_failures += 1
                    if consecutive_failures == 1:
                        logger.exception(f"Pane state poll failed for {session_name}")
                else:
                    if consecutive_failures:
                        logger.info(
                            f"Pane state poll recovered for {session_name} after "
                            f"{consecutive_failures} consecutive failure(s)"
                        )
                    consecutive_failures = 0
        except asyncio.CancelledError:
            pass

    async def _poll_and_broadcast_pane_state(
        self, session_name: str, managed: ManagedSession
    ) -> None:
        """Sample the pane once and, if the state changed, tell every client."""
        state = await self._poll_pane_state(session_name)
        if state is None or state == managed.pane_state:
            return
        managed.pane_state = state
        message = _pane_state_message(state)
        for client in list(managed.clients):
            try:
                await client.send_json(message)
            except Exception:  # noqa: S110 - best-effort broadcast
                pass

    async def _notify_session_dead(self, session_name: str) -> None:
        """Send session_dead message to all connected clients."""
        if session_name not in self._sessions:
            return
        managed = self._sessions[session_name]
        message = {
            "type": "session_dead",
            "message": f"Session '{session_name}' has terminated",
        }
        for client in list(managed.clients):
            try:
                await client.send_json(message)
            except Exception:  # noqa: S110 - best-effort notification
                pass

    async def handle_client_message(
        self, session_name: str, message: dict, sender: TerminalClient | None = None
    ) -> None:
        """Handle a message from a WebSocket client."""
        if session_name not in self._sessions:
            return

        managed = self._sessions[session_name]

        mtype = message.get("type")
        if mtype == "input":
            data = message.get("data", "")
            if data:
                await managed.pty.write_async(data.encode("utf-8"))

        elif mtype == "refresh":
            # Client asked for a repaint (session switch/activate, Fit button).
            # Force a native tmux redraw so decorations come back — see
            # refresh_client for why this beats a reconstructed snapshot.
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, refresh_client, session_name)

        elif mtype in ("resize", "activate", "deactivate"):
            await self._handle_sizing_message(session_name, managed, mtype, message, sender)

    async def _handle_sizing_message(
        self,
        session_name: str,
        managed: ManagedSession,
        mtype: str,
        message: dict,
        sender: TerminalClient | None,
    ) -> None:
        """Update per-client sizing state, then re-apply "latest active wins".

        - ``resize``: record this device's viewport; only bump its activity
          while it's active so a background tab's stale layout can't yank the
          focused device.
        - ``activate``: device came to the foreground / gained focus — it wins.
        - ``deactivate``: device backgrounded — stop it voting so a remaining
          device reclaims the window.
        """
        if sender is not None:
            if mtype == "resize":
                managed.client_sizes[sender] = (message.get("cols", 80), message.get("rows", 24))
                if sender in managed.active_clients:
                    managed.seq_counter += 1
                    managed.activity_seq[sender] = managed.seq_counter
            elif mtype == "activate":
                cols, rows = message.get("cols"), message.get("rows")
                if cols and rows:
                    managed.client_sizes[sender] = (cols, rows)
                managed.active_clients.add(sender)
                managed.seq_counter += 1
                managed.activity_seq[sender] = managed.seq_counter
            elif mtype == "deactivate":
                managed.active_clients.discard(sender)
        await self._apply_active_size(session_name)

    async def _apply_active_size(self, session_name: str) -> None:
        """Resize the shared PTY to the most-recently-active client's size.

        Implements "latest active device wins": the winner is the active client
        with the highest activity sequence; if every client is backgrounded we
        keep the last known winner (highest sequence overall) so the window
        doesn't collapse to nothing. When the winning size changes, resize the
        PTY and tell every client (including the winner, whose grid may have
        been shrunk by a previous winner) to match.
        """
        managed = self._sessions.get(session_name)
        if managed is None:
            return

        candidates = [c for c in managed.active_clients if c in managed.client_sizes]
        if not candidates:
            candidates = list(managed.client_sizes)
        if not candidates:
            return

        winner = max(candidates, key=lambda c: managed.activity_seq.get(c, 0))
        size = managed.client_sizes[winner]
        if size == managed.applied_size:
            return

        managed.applied_size = size
        cols, rows = size
        try:
            managed.pty.resize(cols, rows)
        except Exception as e:
            logger.warning(f"PTY resize failed for {session_name}: {e}")

        sync_msg = {"type": "resize_sync", "cols": cols, "rows": rows}
        for client in list(managed.clients):
            try:
                await client.send_json(sync_msg)
            except Exception:  # noqa: S110 - best-effort sync
                pass

    def get_session(self, session_name: str) -> ManagedSession | None:
        """Get a managed session by name."""
        return self._sessions.get(session_name)

    async def evict(self, session_name: str) -> None:
        """Drop a cached PTY without disturbing connected clients.

        Used when the underlying tmux session is gone (died, killed, or about
        to be recreated by /resume). Clients keep their websockets — they'll
        receive ``session_dead`` separately and reload — but subsequent
        register_client() calls will create a fresh PTY for the new tmux
        session instead of reusing the dead one.
        """
        async with self._lock:
            managed = self._sessions.pop(session_name, None)
            if managed is None:
                return
            # Cancel without awaiting, unlike unregister_client: this is the
            # "tmux session already died" path, so a task that errored on the way
            # down is expected noise rather than something to report. Not
            # awaiting also means a dead task can't re-raise into this teardown.
            if managed.read_task:
                managed.read_task.cancel()
            if managed.pane_state_task:
                managed.pane_state_task.cancel()
            try:
                managed.pty.close()
            except Exception as e:
                logger.warning(f"Error closing PTY for {session_name}: {e}")


# Global singleton instance
session_manager = SessionManager()
