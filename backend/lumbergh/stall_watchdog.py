"""Catch the event loop while it is blocked, and say what is blocking it.

Lumbergh serves terminals, polls and clicks from one event loop, so any handler
that blocks stops everything at once: the UI does not degrade, it freezes. The
hard part was never noticing the freeze — it was naming the call responsible.

A watchdog that samples from the loop itself cannot do that. It only gets to run
once the block is over, so its stacks show a server already idle again. This one
keeps the loop's liveness in a timestamp and watches that timestamp from a plain
OS thread, which keeps running while the loop does not. The frame it catches is
the blocking call.
"""

import asyncio
import tempfile
import threading
import time
from pathlib import Path

LOG_PATH = Path(tempfile.gettempdir()) / "lumbergh-lag.log"
BEAT_INTERVAL = 0.05
STALL_THRESHOLD = 0.4
# One stack per quarter second is enough to show a long block's shape without
# writing a megabyte of near-identical traces.
REPORT_INTERVAL = 0.25

_heartbeat = [0.0]


async def _beat() -> None:
    while True:
        _heartbeat[0] = time.monotonic()
        await asyncio.sleep(BEAT_INTERVAL)


def _sample(loop_tid: int | None, stalled: float) -> None:
    import sys
    import traceback

    frames = sys._current_frames()
    with open(LOG_PATH, "a") as f:
        f.write(f"\n{'=' * 60}\nSTALL {stalled * 1000:.0f}ms at {time.strftime('%H:%M:%S')}\n")
        f.write("\n--- MAIN/LOOP THREAD (blocked here) ---\n")
        if loop_tid in frames:
            traceback.print_stack(frames[loop_tid], file=f)
        for tid, frame in frames.items():
            if tid == loop_tid:
                continue
            stack = "".join(traceback.format_stack(frame))
            # A pool thread parked on its queue is idle, and says nothing.
            if "work_queue.get" in stack or "self.queue.get" in stack:
                continue
            f.write(f"\n--- Thread {tid} (busy) ---\n{stack}")


def _watch() -> None:
    loop_tid = threading.main_thread().ident
    last_report = 0.0
    while True:
        time.sleep(0.1)
        beat = _heartbeat[0]
        if not beat:
            continue  # the loop has not started beating yet
        stalled = time.monotonic() - beat
        now = time.monotonic()
        if stalled < STALL_THRESHOLD or now - last_report < REPORT_INTERVAL:
            continue
        last_report = now
        _sample(loop_tid, stalled)


def start() -> asyncio.Task:
    """Begin watching. Returns the heartbeat task, for cancellation on shutdown."""
    threading.Thread(target=_watch, daemon=True, name="stall-watchdog").start()
    return asyncio.create_task(_beat())
