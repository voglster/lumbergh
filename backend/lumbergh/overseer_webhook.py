"""Deliver Bill's nudges to an outside supervisor over HTTP instead of his tmux pane.

Bill is one way to supervise the fleet; a supervisor living outside Lumbergh (a chat
assistant driving ``lb`` over SSH) is another. That one has no tmux pane to type into,
so the same four taps — attention, heartbeat, broken babysit, idle babysat overseer — go
out as a JSON POST when ``LUMBERGH_OVERSEER_WEBHOOK_URL`` is set. Unset, nothing here
runs and Bill's tmux taps are untouched.

The key travels as ``Authorization: Bearer <key>`` by default, the shape most webhook
receivers accept. ``LUMBERGH_OVERSEER_WEBHOOK_HEADER`` names a different header (say
``X-Webhook-Secret``), which then carries the raw key.

A receiver that is down must not cost the event loop or the log a request every sweep,
so a failed POST holds further ones off for ``RETRY_AFTER_SECONDS``.
"""

import logging
import os
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime

import httpx

logger = logging.getLogger(__name__)

URL_ENV = "LUMBERGH_OVERSEER_WEBHOOK_URL"
KEY_ENV = "LUMBERGH_OVERSEER_WEBHOOK_KEY"
HEADER_ENV = "LUMBERGH_OVERSEER_WEBHOOK_HEADER"
DEFAULT_HEADER = "Authorization"
TIMEOUT_SECONDS = 5.0
RETRY_AFTER_SECONDS = 60.0

_lock = threading.Lock()
_retry_at = 0.0


def url() -> str:
    return os.environ.get(URL_ENV, "").strip()


def configured() -> bool:
    return bool(url())


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
        failure = f"HTTP {resp.status_code}" if resp.status_code >= 400 else None
    except httpx.HTTPError as e:
        failure = type(e).__name__
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


def reset_backoff() -> None:
    global _retry_at
    with _lock:
        _retry_at = 0.0
