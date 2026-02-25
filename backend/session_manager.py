"""
Session manager for PTY pooling - ensures one PTY per tmux session.

This prevents React StrictMode double-mounts from creating multiple
tmux attach-session processes for the same session.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import WebSocket

from tmux_pty import TmuxPtySession, capture_pane_content

logger = logging.getLogger(__name__)


@dataclass
class ManagedSession:
    """A PTY session with multiple connected WebSocket clients."""

    pty: TmuxPtySession
    clients: set[WebSocket] = field(default_factory=set)
    read_task: asyncio.Task | None = None


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

    async def register_client(self, session_name: str, websocket: WebSocket) -> ManagedSession:
        """
        Register a WebSocket client for a tmux session.
        Creates the PTY if this is the first client.
        Auto-recreates the tmux session if it exists in TinyDB but not in tmux.
        Sends current pane content to new client for immediate display.
        """
        from routers.sessions import create_tmux_session, get_stored_sessions

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
                            logger.info(f"Auto-recreating tmux session: {session_name} in {workdir}")
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

                # Start the read loop task
                managed.read_task = asyncio.create_task(self._broadcast_loop(session_name))
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
                await websocket.send_json({
                    "type": "output",
                    "data": content
                })
                logger.info(f"Sent initial pane capture to client ({len(content)} chars)")
        except Exception as e:
            logger.warning(f"Failed to send initial pane capture: {e}")

        return managed

    async def unregister_client(self, session_name: str, websocket: WebSocket) -> None:
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

                managed.pty.close()
                del self._sessions[session_name]

    async def _broadcast_loop(self, session_name: str) -> None:
        """Read from PTY and broadcast to all connected clients.

        Uses loop.add_reader (epoll) for zero-latency, zero-overhead fd watching
        instead of polling with run_in_executor.
        """
        loop = asyncio.get_event_loop()
        consecutive_eof = 0

        if session_name not in self._sessions:
            return
        managed = self._sessions[session_name]
        fd = managed.pty.master_fd
        if fd is None:
            return

        data_ready = asyncio.Event()
        loop.add_reader(fd, data_ready.set)

        try:
            while True:
                await data_ready.wait()
                data_ready.clear()

                if session_name not in self._sessions:
                    break

                managed = self._sessions[session_name]

                # Drain all available data from the fd
                data = managed.pty.read()

                # Handle EOF (empty bytes) - possible session death
                if data == b'':
                    consecutive_eof += 1
                    if consecutive_eof >= 3:
                        is_alive = await loop.run_in_executor(None, managed.pty.is_alive)
                        if not is_alive:
                            logger.warning(f"Session {session_name} died, notifying clients")
                            await self._notify_session_dead(session_name)
                            break
                    continue

                consecutive_eof = 0

                if data:
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

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Broadcast loop error: {e}")
        finally:
            try:
                loop.remove_reader(fd)
            except Exception:
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
            except Exception:
                pass

    async def handle_client_message(
        self, session_name: str, message: dict, sender: WebSocket | None = None
    ) -> None:
        """Handle a message from a WebSocket client."""
        if session_name not in self._sessions:
            return

        managed = self._sessions[session_name]

        if message.get("type") == "input":
            data = message.get("data", "")
            if data:
                managed.pty.write(data.encode("utf-8"))

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
                        except Exception:
                            pass

    def get_session(self, session_name: str) -> ManagedSession | None:
        """Get a managed session by name."""
        return self._sessions.get(session_name)


# Global singleton instance
session_manager = SessionManager()
