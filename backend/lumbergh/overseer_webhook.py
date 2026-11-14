"""Deliver Bill's nudges to an outside supervisor over HTTP instead of his tmux pane.

Bill is one way to supervise the fleet; a supervisor living outside Lumbergh (a chat
assistant driving ``lb`` over SSH) is another. That one has no tmux pane to type into,
so the same four taps — attention, heartbeat, broken babysit, idle babysat overseer — go
out as a JSON POST when ``LUMBERGH_OVERSEER_WEBHOOK_URL`` is set. Unset, nothing here
runs and Bill's tmux taps are untouched.

The key travels as ``Authorization: Bearer <key>`` by default, the shape most webhook
receivers accept. ``LUMBERGH_OVERSEER_WEBHOOK_HEADER`` names a different header (say
``X-Webhook-Secret``), which then carries the raw key.

``LUMBERGH_OVERSEER_PIPER=1`` routes the same taps to Piper (Jim's Grok Bot assistant)
through ``sherpa piper`` instead, which owns Piper's webhook URL and auth in sherpa's
vault, so no secret has to live in Lumbergh's environment. Piper hears about sessions
that finished, are blocked or errored, and babysits that need a hand — not the calm-fleet
heartbeat, which would wake a chat assistant every half hour to be told nothing.

A receiver that is down must not cost the event loop or the log a request every sweep,
so a failed POST holds further ones off for ``RETRY_AFTER_SECONDS``.
"""

import json
import logging
import os
import shutil
import subprocess
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

URL_ENV = "LUMBERGH_OVERSEER_WEBHOOK_URL"
KEY_ENV = "LUMBERGH_OVERSEER_WEBHOOK_KEY"
HEADER_ENV = "LUMBERGH_OVERSEER_WEBHOOK_HEADER"
DEFAULT_HEADER = "Authorization"
PIPER_ENV = "LUMBERGH_OVERSEER_PIPER"
TIMEOUT_SECONDS = 5.0
# `sherpa piper` caps its own POST at 5s; the rest is uv resolving the script's env.
PIPER_TIMEOUT_SECONDS = 20.0
RETRY_AFTER_SECONDS = 60.0

_lock = threading.Lock()
_retry_at = 0.0


def url() -> str:
    return os.environ.get(URL_ENV, "").strip()


def via_piper() -> bool:
    return os.environ.get(PIPER_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


def configured() -> bool:
    return via_piper() or bool(url())


def headers() -> dict[str, str]:
    key = os.environ.get(KEY_ENV, "").strip()
    if not key:
        return {}
    name = os.environ.get(HEADER_ENV, "").strip() or DEFAULT_HEADER
    already_has_scheme = " " in key
    if name.lower() == "authorization" and not already_has_scheme:
        return {name: f"Bearer {key}"}
    return {name: key}


def post(
    kind: str,
    reason: str,
    message: str,
    sessions: list[dict],
    send: Callable[..., httpx.Response] = httpx.post,
) -> bool:
    """POST one nudge. True only when the receiver accepted it (2xx/3xx).

    The callers latch on that result exactly as they do on a tmux send, so a nudge the
    receiver never got is retried on a later sweep instead of being marked delivered.
    """
    global _retry_at
    with _lock:
        if time.monotonic() < _retry_at:
            return False
    if via_piper():
        failure = _tell_piper(kind, reason, sessions)
    else:
        failure = _post_json(kind, reason, message, sessions, send)
    if failure is None:
        return True
    logger.warning(
        "overseer webhook rejected %s nudge (%s); holding off %ds",
        kind,
        failure,
        RETRY_AFTER_SECONDS,
    )
    with _lock:
        _retry_at = time.monotonic() + RETRY_AFTER_SECONDS
    return False


def _post_json(
    kind: str,
    reason: str,
    message: str,
    sessions: list[dict],
    send: Callable[..., httpx.Response],
) -> str | None:
    body = {
        "source": "lumbergh",
        "kind": kind,
        "reason": reason,
        "message": message,
        "sessions": sessions,
        "timestamp": datetime.now(UTC).isoformat(),
    }
    try:
        resp = send(url(), json=body, headers=headers(), timeout=TIMEOUT_SECONDS)
    except httpx.HTTPError as e:
        return type(e).__name__
    return f"HTTP {resp.status_code}" if resp.status_code >= 400 else None


def piper_kind(kind: str, sessions: list[dict]) -> str | None:
    """The ``sherpa piper --kind`` for a tap, or None when Piper should not hear it."""
    if kind == "heartbeat":
        return None
    if kind == "babysit_broken":
        return "error"
    if kind == "babysit_idle":
        return "blocked"
    states = {s.get("state") for s in sessions}
    if "error" in states:
        return "error"
    if any(s.get("why") != "finished a chunk" for s in sessions):
        return "blocked"
    return "done"


def sherpa_bin() -> str:
    """A service's PATH often lacks ~/.local/bin, where sherpa installs itself."""
    return shutil.which("sherpa") or str(Path.home() / ".local" / "bin" / "sherpa")


def piper_argv(kind: str, reason: str, sessions: list[dict]) -> list[str] | None:
    piper = piper_kind(kind, sessions)
    if piper is None:
        return None
    # Always named: left out, sherpa would report the tmux session the backend runs in.
    names = ",".join(s["name"] for s in sessions if s.get("name")) or "lumbergh"
    return [sherpa_bin(), "piper", reason, "--session", names, "--kind", piper, "--json"]


def _tell_piper(kind: str, reason: str, sessions: list[dict]) -> str | None:
    argv = piper_argv(kind, reason, sessions)
    if argv is None:
        return None
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=PIPER_TIMEOUT_SECONDS)
    except (OSError, subprocess.TimeoutExpired) as e:
        return f"sherpa piper {type(e).__name__}"
    try:
        result = json.loads(done.stdout)
    except ValueError:
        return f"sherpa piper exit {done.returncode}"
    if result.get("sent"):
        return None
    return f"sherpa piper status {result.get('status')}"


def reset_backoff() -> None:
    global _retry_at
    with _lock:
        _retry_at = 0.0
