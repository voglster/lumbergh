"""
Startup telemetry — fire-and-forget POST to lumbergh-cloud.

Sends a startup event on first launch, then heartbeat events every 4 hours
while the server is running.
"""

import asyncio
import logging
import platform
import subprocess
import time
from pathlib import Path

import httpx

from lumbergh._version import __version__
from lumbergh.routers.settings import get_settings

logger = logging.getLogger(__name__)

_THROTTLE_SECONDS = 4 * 3600  # 4 hours
_version_cache: str | None = None
_STAMP_FILE = Path("~/.local/state/lumbergh/last_startup_telemetry").expanduser()


def get_version() -> str:
    """Get version string. In dev mode, use git describe for full detail.

    Release builds cache permanently. Dev mode re-evaluates every call
    so version stays current after tagging new releases.
    """
    global _version_cache

    if not __version__.startswith("0.0.0"):
        # Release build — cache permanently
        if _version_cache is None:
            _version_cache = __version__
        return _version_cache

    # Dev mode — always re-evaluate from git
    try:
        repo_root = Path(__file__).parent.parent.parent
        result = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=8"],
            cwd=repo_root,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
        if result.returncode == 0:
            desc = result.stdout.strip().lstrip("v")
            if desc:
                return desc
    except Exception:
        logger.debug("git describe failed for version", exc_info=True)

    return __version__


def _was_recently_sent() -> bool:
    """Check if startup telemetry was sent within the throttle window."""
    try:
        if not _STAMP_FILE.exists():
            return False
        last_sent = float(_STAMP_FILE.read_text().strip())
        return (time.time() - last_sent) < _THROTTLE_SECONDS
    except Exception:
        return False


def _mark_sent() -> None:
    """Persist the current time as the last-sent timestamp."""
    try:
        _STAMP_FILE.parent.mkdir(parents=True, exist_ok=True)
        _STAMP_FILE.write_text(str(time.time()))
    except Exception:
        logger.debug("Failed to write telemetry stamp file", exc_info=True)


async def send_startup() -> None:
    """Send a startup telemetry event to the cloud if consent is given.

    Throttled to at most once per 24 hours. Persists timestamp to disk
    so the throttle survives process restarts.
    """
    try:
        settings = get_settings()

        if not settings.get("telemetryConsent"):
            return

        if _was_recently_sent():
            return

        cloud_url = settings.get("cloudUrl", "https://app.lumbergh.dev")
        install_id = settings.get("installationId", "")
        if not install_id:
            return

        properties = {
            "version": get_version(),
            "os": platform.system(),
            "arch": platform.machine(),
            "hostname": platform.node(),
            "default_agent": settings.get("defaultAgent", ""),
        }

        # Include cloud_account_id if linked
        cloud_username = settings.get("cloudUsername")
        if cloud_username:
            properties["cloud_account_id"] = cloud_username

        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{cloud_url}/api/telemetry/events",
                json={
                    "install_id": install_id,
                    "version": get_version(),
                    "events": [{"event": "startup", "properties": properties}],
                },
            )

        _mark_sent()
        logger.debug("Startup telemetry sent")
    except Exception:
        logger.debug("Startup telemetry failed", exc_info=True)


async def _send_event(event: str, extra_props: dict | None = None) -> None:
    """Send a single telemetry event to lumbergh-cloud."""
    settings = get_settings()

    if not settings.get("telemetryConsent"):
        return

    cloud_url = settings.get("cloudUrl", "https://app.lumbergh.dev")
    install_id = settings.get("installationId", "")
    if not install_id:
        return

    properties: dict = {
        "version": get_version(),
        "os": platform.system(),
        "arch": platform.machine(),
    }
    if extra_props:
        properties.update(extra_props)

    async with httpx.AsyncClient(timeout=5.0) as client:
        await client.post(
            f"{cloud_url}/api/telemetry/events",
            json={
                "install_id": install_id,
                "version": get_version(),
                "events": [{"event": event, "properties": properties}],
            },
        )


async def heartbeat_loop() -> None:
    """Send heartbeat events every 4 hours while the server is running."""
    while True:
        await asyncio.sleep(_THROTTLE_SECONDS)
        try:
            await _send_event("heartbeat")
            logger.debug("Heartbeat telemetry sent")
        except Exception:
            logger.debug("Heartbeat telemetry failed", exc_info=True)
