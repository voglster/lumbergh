"""
Session manager for PTY pooling - ensures one PTY per tmux session.

This prevents React StrictMode double-mounts from creating multiple
tmux attach-session processes for the same session.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field

from fastapi import WebSocket

from idle_detector import IdleDetector, SessionState
from tmux_pty import TmuxPtySession, capture_pane_content

logger = logging.getLogger(__name__)


@dataclass
class ManagedSession:
    """A PTY session with multiple connected WebSocket clients."""

    pty: TmuxPtySession
    clients: set[WebSocket] = field(default_factory=set)
    read_task: asyncio.Task | None = None
    idle_detector: IdleDetector = field(default_factory=IdleDetector)
    current_state: SessionState = field(default=SessionState.UNKNOWN)
    last_state_persist_time: float = field(default=0)


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
        Sends current pane content to new client for immediate display.
        """
        async with self._lock:
            if session_name not in self._sessions:
                # Create new PTY for this session
                logger.info(f"Creating new PTY for session: {session_name}")
                pty = TmuxPtySession(session_name)
                pty.spawn()

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

                # Analyze initial content for state detection
                result = managed.idle_detector.analyze_initial_content(content)
                if result.state != managed.current_state:
                    managed.current_state = result.state
                    # Send initial state to client
                    await websocket.send_json({
                        "type": "state_change",
                        "state": result.state.value
                    })
                    # Persist initial state
                    await self._persist_state(session_name, result.state)
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
        """Read from PTY and broadcast to all connected clients."""
        loop = asyncio.get_event_loop()
        consecutive_eof = 0

        while True:
            try:
                # Check if session still exists
                if session_name not in self._sessions:
                    break

                managed = self._sessions[session_name]

                await asyncio.sleep(0.01)  # Prevent busy loop
                data = await loop.run_in_executor(None, managed.pty.read)

                # Handle EOF (empty bytes) - possible session death
                if data == b'':
                    consecutive_eof += 1
                    if consecutive_eof >= 3:
                        # Verify session is actually dead
                        is_alive = await loop.run_in_executor(None, managed.pty.is_alive)
                        if not is_alive:
                            logger.warning(f"Session {session_name} died, notifying clients")
                            await self._notify_session_dead(session_name)
                            break
                    continue

                consecutive_eof = 0  # Reset on successful read

                if data:
                    decoded_data = data.decode("utf-8", errors="replace")
                    message = {
                        "type": "output",
                        "data": decoded_data,
                    }

                    # Process through idle detector
                    result = managed.idle_detector.process_output(decoded_data)

                    # Check for state change
                    state_changed = result.state != managed.current_state
                    if state_changed:
                        managed.current_state = result.state
                        logger.info(f"Session {session_name} state changed to: {result.state.value}")

                    # Broadcast to all clients
                    disconnected = []
                    for client in list(managed.clients):
                        try:
                            await client.send_json(message)
                            # Send state change if applicable
                            if state_changed:
                                await client.send_json({
                                    "type": "state_change",
                                    "state": result.state.value
                                })
                        except Exception:
                            disconnected.append(client)

                    # Remove disconnected clients
                    for client in disconnected:
                        managed.clients.discard(client)

                    # Persist state change (debounced, max 1/sec)
                    if state_changed:
                        now = time.time()
                        if now - managed.last_state_persist_time >= 1.0:
                            managed.last_state_persist_time = now
                            asyncio.create_task(self._persist_state(session_name, result.state))

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Broadcast loop error: {e}")
                break

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

    async def _persist_state(self, session_name: str, state: SessionState) -> None:
        """Persist session state to TinyDB."""
        from datetime import datetime

        from db_utils import get_session_data_db

        try:
            loop = asyncio.get_event_loop()

            def _save():
                session_db = get_session_data_db(session_name)
                state_table = session_db.table("idle_state")
                state_table.truncate()
                state_table.insert({
                    "state": state.value,
                    "updatedAt": datetime.utcnow().isoformat(),
                })

            await loop.run_in_executor(None, _save)
            logger.debug(f"Persisted state '{state.value}' for session {session_name}")
        except Exception as e:
            logger.warning(f"Failed to persist state for {session_name}: {e}")

    async def handle_client_message(self, session_name: str, message: dict) -> None:
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

    def get_session(self, session_name: str) -> ManagedSession | None:
        """Get a managed session by name."""
        return self._sessions.get(session_name)


# Global singleton instance
session_manager = SessionManager()
