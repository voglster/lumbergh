"""
Session manager for per-client PTY pooling.

Each WebSocket client gets its own `tmux attach-session` PTY process.
tmux window-size is set to 'largest' so the biggest client (typically desktop)
determines the window size, preventing desktop from shrinking when mobile connects.
"""

import asyncio
import logging
import subprocess
from dataclasses import dataclass

from fastapi import WebSocket

from tmux_pty import TmuxPtySession, capture_pane_content

logger = logging.getLogger(__name__)


@dataclass
class ClientConnection:
    """A single client's PTY connection to a tmux session."""

    websocket: WebSocket
    pty: TmuxPtySession
    read_task: asyncio.Task | None = None


@dataclass
class ManagedSession:
    """A tmux session with multiple connected clients, each with their own PTY."""

    clients: dict  # WebSocket -> ClientConnection


class SessionManager:
    """
    Singleton manager for PTY sessions.

    - One PTY per WebSocket client (each gets its own tmux attach-session)
    - tmux handles multi-client sizing natively
    - PTY closes when its client disconnects
    - Session entry removed when last client leaves
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

    async def register_client(self, session_name: str, websocket: WebSocket) -> None:
        """
        Register a WebSocket client for a tmux session.
        Creates a dedicated PTY for this client.
        Sends current pane content to client for immediate display.
        """
        # Create a new PTY for this client
        logger.info(f"Creating new PTY for client on session: {session_name}")
        pty = TmuxPtySession(session_name)
        pty.spawn()

        conn = ClientConnection(websocket=websocket, pty=pty)

        async with self._lock:
            if session_name not in self._sessions:
                self._sessions[session_name] = ManagedSession(clients={})
                # Set window-size to 'largest' so the biggest client (desktop)
                # determines the window size. Mobile sees wider content but that's
                # acceptable; prevents desktop from shrinking when mobile connects.
                subprocess.run(
                    ["tmux", "set-option", "-t", session_name, "window-size", "largest"],
                    capture_output=True,
                )

            managed = self._sessions[session_name]
            managed.clients[websocket] = conn

            client_count = len(managed.clients)
            logger.info(f"Session {session_name}: {client_count} client(s) connected")

        # Start the per-client read loop
        conn.read_task = asyncio.create_task(
            self._client_read_loop(session_name, websocket)
        )

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

    async def unregister_client(self, session_name: str, websocket: WebSocket) -> None:
        """
        Unregister a WebSocket client.
        Closes only this client's PTY.
        Removes the session entry when the last client leaves.
        """
        async with self._lock:
            if session_name not in self._sessions:
                return

            managed = self._sessions[session_name]
            conn = managed.clients.pop(websocket, None)

            if conn:
                # Cancel this client's read loop
                if conn.read_task:
                    conn.read_task.cancel()
                    try:
                        await conn.read_task
                    except asyncio.CancelledError:
                        pass

                # Close this client's PTY
                conn.pty.close()
                logger.info(f"Closed PTY for client on session: {session_name}")

            remaining = len(managed.clients)
            logger.info(f"Session {session_name}: {remaining} client(s) remaining")

            if not managed.clients:
                del self._sessions[session_name]
                logger.info(f"Removed session entry: {session_name}")

    async def _client_read_loop(self, session_name: str, websocket: WebSocket) -> None:
        """Read from one client's PTY and send to that client's websocket."""
        loop = asyncio.get_event_loop()
        consecutive_eof = 0

        # Get the connection for this client
        async with self._lock:
            managed = self._sessions.get(session_name)
            if not managed:
                return
            conn = managed.clients.get(websocket)
            if not conn:
                return

        while True:
            try:
                await asyncio.sleep(0.01)  # Prevent busy loop
                data = await loop.run_in_executor(None, conn.pty.read)

                # Handle EOF (empty bytes) - possible session death
                if data == b'':
                    consecutive_eof += 1
                    if consecutive_eof >= 3:
                        is_alive = await loop.run_in_executor(None, conn.pty.is_alive)
                        if not is_alive:
                            logger.warning(
                                f"Session {session_name} died, notifying client"
                            )
                            try:
                                await websocket.send_json({
                                    "type": "session_dead",
                                    "message": f"Session '{session_name}' has terminated",
                                })
                            except Exception:
                                pass
                            break
                    continue

                consecutive_eof = 0  # Reset on successful read

                if data:
                    message = {
                        "type": "output",
                        "data": data.decode("utf-8", errors="replace"),
                    }
                    try:
                        await websocket.send_json(message)
                    except Exception:
                        break

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Client read loop error: {e}")
                break

    async def handle_client_message(
        self, session_name: str, message: dict, sender: WebSocket | None = None
    ) -> None:
        """Handle a message from a WebSocket client, routing to that client's PTY."""
        if not sender:
            return

        async with self._lock:
            managed = self._sessions.get(session_name)
            if not managed:
                return
            conn = managed.clients.get(sender)
            if not conn:
                return

        if message.get("type") == "input":
            data = message.get("data", "")
            if data:
                conn.pty.write(data.encode("utf-8"))

        elif message.get("type") == "resize":
            cols = message.get("cols", 80)
            rows = message.get("rows", 24)
            conn.pty.resize(cols, rows)


# Global singleton instance
session_manager = SessionManager()
