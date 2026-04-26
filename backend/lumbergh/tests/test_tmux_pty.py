"""Tests for tmux PTY I/O — short-write handling on large pastes."""

from fastapi import WebSocketDisconnect

from lumbergh import tmux_pty
from lumbergh.tmux_pty import TmuxPtySession


async def test_write_loop_handles_short_writes(monkeypatch):
    """Regression for issue #14: pastes larger than the PTY input buffer
    cause os.write to do a short write. The WS input handler must retry
    until all bytes are written, otherwise xterm.js's bracketed-paste end
    marker (ESC[201~) is silently dropped and Claude Code submits early.
    """
    client = TmuxPtySession.__new__(TmuxPtySession)
    client.master_fd = 999  # fake fd; never actually written to

    payload = "X" * 8192
    written = bytearray()
    call_count = [0]

    def fake_os_write(_fd, data):
        call_count[0] += 1
        # First call accepts only half — simulates a full PTY input buffer
        n = len(data) // 2 if call_count[0] == 1 else len(data)
        written.extend(data[:n])
        return n

    monkeypatch.setattr(tmux_pty.os, "write", fake_os_write)

    class FakeWS:
        def __init__(self):
            self.calls = 0

        async def receive_json(self):
            self.calls += 1
            if self.calls == 1:
                return {"type": "input", "data": payload}
            raise WebSocketDisconnect()

    await client._write_loop(FakeWS())

    assert bytes(written) == payload.encode("utf-8")
    assert call_count[0] >= 2, "expected retry after short write"
