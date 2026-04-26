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
from lumbergh.tmux_pty import IS_WINDOWS, TmuxPtySession, capture_pane_content

logger = logging.getLogger(__name__)


@runtime_checkable
class TerminalClient(Protocol):
    """Any object that can receive JSON messages (WebSocket or CloudClient)."""

    async def send_json(self, data: dict) -> None: ...


@dataclass
class ManagedSession:
    """A PTY session with multiple connected WebSocket clients."""

    pty: TmuxPtySession
    clients: set[TerminalClient] = field(default_factory=set)
    read_task: asyncio.Task | None = None
    copy_mode_task: asyncio.Task | None = None


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

    async def register_client(self, session_name: str, websocket: TerminalClient) -> ManagedSession:
        """
        Register a WebSocket client for a tmux session.
        Creates the PTY if this is the first client.
        Auto-recreates the tmux session if it exists in TinyDB but not in tmux.
        Sends current pane content to new client for immediate display.
        """
        from lumbergh.routers.sessions import create_tmux_session, get_stored_sessions

        async with self._lock:
            if session_name not in self._sessions:
                # Create new PTY for this session
                logger.info(f"Creating new PTY for session: {session_name}")
                pty = TmuxPtySession(session_name)
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

                # Start the read loop and copy-mode monitor tasks
                managed.read_task = asyncio.create_task(self._broadcast_loop(session_name))
                managed.copy_mode_task = asyncio.create_task(self._copy_mode_monitor(session_name))
            else:
                logger.info(f"Reusing existing PTY for session: {session_name}")
                managed = self._sessions[session_name]

            managed.clients.add(websocket)
            logger.info(f"Session {session_name}: {len(managed.clients)} client(s) connected")

        # Send current pane content to the new client (outside lock to avoid blocking)
        try:
            loop = asyncio.get_event_loop()
            content = await loop.run_in_executor(None, capture_pane_content, session_name)
            if content:
                await websocket.send_json({"type": "output", "data": content})
                logger.info(f"Sent initial pane capture to client ({len(content)} chars)")
        except Exception as e:
            logger.warning(f"Failed to send initial pane capture: {e}")

        return managed

    async def unregister_client(self, session_name: str, websocket: TerminalClient) -> None:
        """
        Unregister a WebSocket client.
        Closes the PTY if this was the last client.
        """
        async with self._lock:
            if session_name not in self._sessions:
                return

            managed = self._sessions[session_name]
            managed.clients.discard(websocket)

            logger.info(f"Session {session_name}: {len(managed.clients)} client(s) remaining")

            if not managed.clients:
                # Last client disconnected, cleanup
                logger.info(f"Closing PTY for session: {session_name}")

                if managed.read_task:
                    managed.read_task.cancel()
                    try:
                        await managed.read_task
                    except asyncio.CancelledError:
                        pass

                if managed.copy_mode_task:
                    managed.copy_mode_task.cancel()
                    try:
                        await managed.copy_mode_task
                    except asyncio.CancelledError:
                        pass

                managed.pty.close()
                del self._sessions[session_name]

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

    async def _poll_copy_mode(self, session_name: str) -> bool | None:
        """Return True/False for copy-mode active, or None if the probe failed.

        On failure, kill+reap the subprocess so its stdout/stderr pipes are
        closed; otherwise the 250ms polling loop leaks two fds per failure
        until EMFILE.
        """
        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                TMUX_CMD,
                "display-message",
                "-p",
                "-t",
                session_name,
                "#{pane_mode}",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=1.0)
            return stdout.decode().strip() == "copy-mode"
        except (TimeoutError, OSError, ValueError):
            if proc is not None and proc.returncode is None:
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass
                try:
                    await proc.wait()
                except Exception:  # noqa: S110 - best-effort reap
                    pass
            return None

    async def _copy_mode_monitor(self, session_name: str) -> None:
        """Poll tmux pane_mode every 250ms and broadcast copy-mode state changes."""
        last_active = False
        try:
            while True:
                await asyncio.sleep(0.25)
                managed = self._sessions.get(session_name)
                if not managed or not managed.clients:
                    break
                active = await self._poll_copy_mode(session_name)
                if active is None or active == last_active:
                    continue
                last_active = active
                message = {"type": "copy_mode", "active": active}
                for client in list(managed.clients):
                    try:
                        await client.send_json(message)
                    except Exception:  # noqa: S110
                        pass
        except asyncio.CancelledError:
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

        if message.get("type") == "input":
            data = message.get("data", "")
            if data:
                await managed.pty.write_async(data.encode("utf-8"))

        elif message.get("type") == "resize":
            cols = message.get("cols", 80)
            rows = message.get("rows", 24)
            managed.pty.resize(cols, rows)

            # Notify all OTHER clients so they can sync their terminal dimensions
            # This prevents garbled text when multiple clients have different sizes
            if sender and len(managed.clients) > 1:
                sync_msg = {"type": "resize_sync", "cols": cols, "rows": rows}
                for client in list(managed.clients):
                    if client is not sender:
                        try:
                            await client.send_json(sync_msg)
                        except Exception:  # noqa: S110 - best-effort sync
                            pass

    def get_session(self, session_name: str) -> ManagedSession | None:
        """Get a managed session by name."""
        return self._sessions.get(session_name)


# Global singleton instance
session_manager = SessionManager()
