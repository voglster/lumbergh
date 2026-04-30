"""
PTY-based tmux session attachment for bidirectional terminal I/O.

On Unix this uses the standard `pty` module to fork a tmux attach.
On Windows this uses `pywinpty` to spawn `psmux` (a PowerShell-based tmux
clone, installed via `uv tool install psmux`). psmux speaks enough of the
tmux CLI that libtmux mostly works against it, with a few subprocess
fallbacks for `-F` format-flag incompatibilities.
"""

import asyncio
import os
import re
import struct
import subprocess
import sys

import libtmux
from libtmux._internal.query_list import ObjectDoesNotExist

from lumbergh.constants import TMUX_CMD

IS_WINDOWS = sys.platform == "win32"

if not IS_WINDOWS:
    import fcntl
    import pty
    import termios


def _tmux_server() -> libtmux.Server:
    return libtmux.Server(tmux_bin=TMUX_CMD)


def list_tmux_sessions() -> list[dict]:
    """List all available tmux sessions."""
    try:
        server = _tmux_server()
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
    server = _tmux_server()
    try:
        session = server.sessions.get(session_name=session_name)
        if session:
            window = session.active_window
            pane = window.active_pane
            if pane is not None and pane.id is not None:
                return pane.id
    except ObjectDoesNotExist:
        pass
    except Exception:  # noqa: S110 - falls through to psmux fallback / ValueError
        pass

    # Fallback for psmux: libtmux's -F format flags don't always work.
    if IS_WINDOWS:
        try:
            result = subprocess.run(
                [TMUX_CMD, "display-message", "-t", session_name, "-p", "#{pane_id}"],
                capture_output=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except Exception:  # noqa: S110 - fallback path, ValueError raised below
            pass

    raise ValueError(f"Session '{session_name}' not found or no active pane")


def capture_pane_content(session_name: str) -> str:
    """Capture the current visible content of the active pane.

    Returns the terminal content with ANSI escape codes preserved.
    Uses a single ``tmux capture-pane`` subprocess call instead of
    libtmux (which spawns 4+ subprocesses per call for session/window/pane
    resolution and can cause GIL contention when called concurrently).
    """
    # Capture only the visible pane (no scrollback). Then re-emit each line
    # with explicit absolute cursor positioning into a freshly cleared
    # screen. The naive ``\n``-joined dump that capture-pane returns has no
    # row anchoring — when xterm.js writes it sequentially, any extra
    # newlines (or a buffer that's already mid-scroll from a prior session)
    # offsets every row by one and the visible state never recovers until a
    # manual refit. Positioning each line absolutely makes the snapshot
    # idempotent regardless of the receiving xterm's cursor state.
    try:
        result = subprocess.run(
            [
                TMUX_CMD,
                "capture-pane",
                "-t",
                session_name,
                "-p",  # print to stdout
                "-e",  # include escape sequences (ANSI colors)
            ],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
        if result.returncode != 0:
            return ""
        lines = result.stdout.splitlines()
        # Reset attributes, clear screen, home cursor, then absolute-position each line
        parts = ["\x1b[0m\x1b[H\x1b[2J"]
        for i, line in enumerate(lines):
            parts.append(f"\x1b[{i + 1};1H{line}\x1b[0m")
        return "".join(parts)
    except Exception:
        return ""


def capture_scrollback(session_name: str, max_lines: int = 500) -> str:
    """Capture scrollback history from the active pane (plain text, no ANSI).

    Returns up to ``max_lines`` lines from the scrollback buffer.
    """
    try:
        result = subprocess.run(
            [
                TMUX_CMD,
                "capture-pane",
                "-t",
                session_name,
                "-p",  # print to stdout
                "-S",
                str(-max_lines),  # N lines before visible area
            ],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
        if result.returncode != 0:
            return ""
        return result.stdout.rstrip("\n")
    except Exception:
        return ""


def _session_exists(session_name: str) -> bool:
    """Check whether a tmux/psmux session exists.

    On Windows, libtmux's session lookup against psmux is unreliable, so
    fall back to `has-session` / `list-sessions` text parsing.
    """
    try:
        server = _tmux_server()
        if server.sessions.get(session_name=session_name) is not None:
            return True
    except Exception:  # noqa: S110 - falls through to Windows fallback / False
        pass

    if IS_WINDOWS:
        try:
            result = subprocess.run(
                [TMUX_CMD, "has-session", "-t", session_name],
                capture_output=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            if result.returncode == 0:
                return True
        except Exception:  # noqa: S110 - try list-sessions next
            pass
        try:
            result = subprocess.run(
                [TMUX_CMD, "list-sessions"],
                capture_output=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            if result.returncode == 0:
                pattern = re.compile(rf"^{re.escape(session_name)}:")
                for line in result.stdout.splitlines():
                    if pattern.match(line):
                        return True
        except Exception:  # noqa: S110 - last resort, return False below
            pass

    return False


class TmuxPtySession:
    """Manages a PTY connected to a tmux/psmux session for bidirectional I/O.

    Uses standard `pty` on Unix and `pywinpty` on Windows.
    """

    def __init__(self, session_name: str):
        self.session_name = session_name
        # Unix-only fields
        self.master_fd: int | None = None
        self.pid: int | None = None
        # Windows-only field (winpty.PTY)
        self.pty_win = None
        self.cols = 80
        self.rows = 24

    def spawn(self) -> None:
        """Spawn a PTY running tmux attach."""
        if not _session_exists(self.session_name):
            raise ValueError(f"Session '{self.session_name}' not found")

        if IS_WINDOWS:
            self._spawn_windows()
        else:
            self._spawn_unix()

    def _spawn_unix(self) -> None:
        pid, fd = pty.fork()

        if pid == 0:
            # Child process - exec tmux attach
            os.execlp(
                TMUX_CMD,
                TMUX_CMD,
                "attach-session",
                "-t",
                self.session_name,
            )
        else:
            self.pid = pid
            self.master_fd = fd
            flags = fcntl.fcntl(fd, fcntl.F_GETFL)
            fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
            self._set_winsize(self.cols, self.rows)

    def _spawn_windows(self) -> None:
        import shutil

        import winpty  # type: ignore[import-not-found]

        cmd_path = shutil.which(TMUX_CMD)
        if not cmd_path:
            raise FileNotFoundError(
                f"Could not find {TMUX_CMD} in PATH (install with: uv tool install psmux)"
            )

        pty_win = winpty.PTY(self.cols, self.rows)
        pty_win.spawn(cmd_path, f"attach-session -t {self.session_name}")
        self.pty_win = pty_win

    def _set_winsize(self, cols: int, rows: int) -> None:
        """Set the PTY window size."""
        self.cols = cols
        self.rows = rows
        if IS_WINDOWS:
            if self.pty_win is not None:
                self.pty_win.set_size(cols, rows)
            return

        if self.master_fd is None:
            return
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)

    def resize(self, cols: int, rows: int) -> None:
        """Resize the terminal."""
        self._set_winsize(cols, rows)

    def write(self, data: bytes) -> None:
        """Write data to the PTY (send keystrokes to terminal)."""
        if IS_WINDOWS:
            if self.pty_win is not None:
                self.pty_win.write(data.decode("utf-8", errors="replace"))
            return

        if self.master_fd is not None:
            os.write(self.master_fd, data)

    async def write_async(self, data: bytes) -> None:
        """Write data to the PTY with proper backpressure handling.

        On Unix, handles short writes and BlockingIOError on non-blocking
        fds, which is critical for large pastes that exceed the kernel's
        PTY input buffer (~4KB). On Windows, pywinpty handles buffering
        internally so we just delegate to the synchronous write.
        """
        if IS_WINDOWS:
            self.write(data)
            return

        if self.master_fd is None:
            return
        loop = asyncio.get_event_loop()
        offset = 0
        while offset < len(data):
            try:
                written = os.write(self.master_fd, data[offset:])
                offset += written
            except BlockingIOError:
                # PTY buffer full - wait for it to drain using epoll/kqueue
                writable = asyncio.Event()
                loop.add_writer(self.master_fd, writable.set)
                try:
                    await writable.wait()
                finally:
                    loop.remove_writer(self.master_fd)

    def read(self) -> bytes | None:
        """Read available data from the PTY (non-blocking).

        Returns:
            bytes: Data read from PTY
            b'': EOF/PTY died (session terminated)
            None: No data available yet (non-blocking)
        """
        if IS_WINDOWS:
            if self.pty_win is None:
                return b""
            try:
                data = self.pty_win.read(blocking=False)
                if not data:
                    if not self.pty_win.isalive():
                        return b""
                    return None
                return data.encode("utf-8", errors="replace")
            except Exception:
                return b""

        if self.master_fd is None:
            return b""  # Already closed
        try:
            return os.read(self.master_fd, 4096)
        except BlockingIOError:
            return None  # No data yet
        except OSError:
            return b""  # PTY died

    def is_alive(self) -> bool:
        """Check if the underlying tmux session still exists."""
        return _session_exists(self.session_name)

    def close(self) -> None:
        """Close the PTY connection."""
        if IS_WINDOWS:
            if self.pty_win is not None:
                del self.pty_win
                self.pty_win = None
            return

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
            _done, pending = await asyncio.wait(
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
                        await self.write_async(data.encode("utf-8"))

                elif message.get("type") == "resize":
                    cols = message.get("cols", 80)
                    rows = message.get("rows", 24)
                    self.resize(cols, rows)

        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: S110 - cleanup on disconnect
            pass
