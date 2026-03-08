"""
PTY-based tmux session attachment for bidirectional terminal I/O.
"""

import asyncio
import fcntl
import os
import pty
import struct
import termios

import libtmux
from libtmux._internal.query_list import ObjectDoesNotExist


def list_tmux_sessions() -> list[dict]:
    """List all available tmux sessions."""
    try:
        server = libtmux.Server()
        sessions = server.sessions
        return [
            {
                "name": s.name,
                "id": s.id,
                "windows": len(s.windows),
                "attached": bool(s.session_attached),
            }
            for s in sessions
        ]
    except Exception:
        return []


def get_session_pane_id(session_name: str) -> str:
    """Get the active pane ID for a session."""
    server = libtmux.Server()
    try:
        session = server.sessions.get(session_name=session_name)
    except ObjectDoesNotExist:
        raise ValueError(f"Session '{session_name}' not found")
    if not session:
        raise ValueError(f"Session '{session_name}' not found")
    window = session.active_window
    pane = window.active_pane
    return pane.id


def capture_pane_content(session_name: str) -> str:
    """Capture the current visible content of the active pane.

    Returns the terminal content with ANSI escape codes preserved.
    """
    server = libtmux.Server()
    try:
        session = server.sessions.get(session_name=session_name)
    except ObjectDoesNotExist:
        return ""
    if not session:
        return ""

    window = session.active_window
    pane = window.active_pane

    # capture_pane returns the pane content
    # escape_sequences=True includes ANSI escape codes (colors)
    try:
        content = pane.capture_pane(start="-", end="-", escape_sequences=True)
        if isinstance(content, list):
            return "\r\n".join(content) + "\r\n"
        return str(content) + "\r\n"
    except Exception:
        return ""


class TmuxPtySession:
    """
    Manages a PTY connected to a tmux session for bidirectional I/O.

    Uses `tmux attach-session` in a PTY to get proper terminal emulation.
    """

    def __init__(self, session_name: str):
        self.session_name = session_name
        self.master_fd: int | None = None
        self.pid: int | None = None
        self.cols = 80
        self.rows = 24

    def spawn(self) -> None:
        """Spawn a PTY running tmux attach."""
        # Verify session exists
        server = libtmux.Server()
        try:
            session = server.sessions.get(session_name=self.session_name)
        except ObjectDoesNotExist:
            raise ValueError(f"Session '{self.session_name}' not found")
        if not session:
            raise ValueError(f"Session '{self.session_name}' not found")

        # Fork a PTY
        pid, fd = pty.fork()

        if pid == 0:
            # Child process - exec tmux attach
            os.execlp(
                "tmux",
                "tmux",
                "attach-session",
                "-t",
                self.session_name,
            )
        else:
            # Parent process
            self.pid = pid
            self.master_fd = fd

            # Set non-blocking
            flags = fcntl.fcntl(fd, fcntl.F_GETFL)
            fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

            # Set initial size
            self._set_winsize(self.cols, self.rows)

    def _set_winsize(self, cols: int, rows: int) -> None:
        """Set the PTY window size."""
        if self.master_fd is None:
            return
        self.cols = cols
        self.rows = rows
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)

    def resize(self, cols: int, rows: int) -> None:
        """Resize the terminal."""
        self._set_winsize(cols, rows)

    def write(self, data: bytes) -> None:
        """Write data to the PTY (send keystrokes to terminal)."""
        if self.master_fd is not None:
            os.write(self.master_fd, data)

    def read(self) -> bytes | None:
        """Read available data from the PTY (non-blocking).

        Returns:
            bytes: Data read from PTY
            b'': EOF/PTY died (session terminated)
            None: No data available yet (non-blocking)
        """
        if self.master_fd is None:
            return b''  # Already closed
        try:
            return os.read(self.master_fd, 4096)
        except BlockingIOError:
            return None  # No data yet
        except OSError:
            return b''  # PTY died

    def is_alive(self) -> bool:
        """Check if the underlying tmux session still exists."""
        try:
            server = libtmux.Server()
            return server.sessions.get(session_name=self.session_name) is not None
        except Exception:
            return False

    def close(self) -> None:
        """Close the PTY connection."""
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None

        if self.pid is not None:
            try:
                os.kill(self.pid, 9)
                os.waitpid(self.pid, 0)
            except (OSError, ChildProcessError):
                pass
            self.pid = None

    async def run(self, websocket) -> None:
        """
        Main loop: bridge WebSocket <-> PTY.

        Reads from PTY and sends to WebSocket.
        Receives from WebSocket and writes to PTY.
        """

        self.spawn()

        read_task = asyncio.create_task(self._read_loop(websocket))
        write_task = asyncio.create_task(self._write_loop(websocket))

        try:
            # Wait for either task to complete (usually due to disconnect)
            done, pending = await asyncio.wait(
                [read_task, write_task],
                return_when=asyncio.FIRST_COMPLETED,
            )

            # Cancel pending tasks
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        finally:
            self.close()

    async def _read_loop(self, websocket) -> None:
        """Read from PTY and send to WebSocket."""
        loop = asyncio.get_event_loop()

        while True:
            # Use asyncio to wait for data on the PTY fd
            try:
                await asyncio.sleep(0.01)  # Small delay to prevent busy loop
                data = await loop.run_in_executor(None, self.read)
                if data:
                    await websocket.send_json(
                        {
                            "type": "output",
                            "data": data.decode("utf-8", errors="replace"),
                        }
                    )
            except Exception:
                break

    async def _write_loop(self, websocket) -> None:
        """Receive from WebSocket and write to PTY."""
        from fastapi import WebSocketDisconnect

        try:
            while True:
                message = await websocket.receive_json()

                if message.get("type") == "input":
                    data = message.get("data", "")
                    if data:
                        self.write(data.encode("utf-8"))

                elif message.get("type") == "resize":
                    cols = message.get("cols", 80)
                    rows = message.get("rows", 24)
                    self.resize(cols, rows)

        except WebSocketDisconnect:
            pass
        except Exception:
            pass
