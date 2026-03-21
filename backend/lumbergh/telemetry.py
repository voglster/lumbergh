"""
Startup telemetry — fire-and-forget POST to lumbergh-cloud.
"""

import logging
import platform
import subprocess
import time
from pathlib import Path

import httpx

from lumbergh._version import __version__
from lumbergh.routers.settings import get_settings

logger = logging.getLogger(__name__)

_last_startup_ts: float = 0.0
_THROTTLE_SECONDS = 24 * 3600  # 24 hours
_version_cache: str | None = None


def _get_version() -> str:
    """Get version string. In dev mode, use git describe for full detail."""
    global _version_cache
    if _version_cache is not None:
        return _version_cache

    if not __version__.startswith("0.0.0"):
        _version_cache = __version__
        return _version_cache

    # Dev mode — try git describe for base tag + commit count
    try:
        repo_root = Path(__file__).parent.parent.parent
        result = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=8"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            desc = result.stdout.strip().lstrip("v")
            if desc:
                _version_cache = desc
                return _version_cache
    except Exception:
        logger.debug("git describe failed for version", exc_info=True)

    _version_cache = __version__
    return _version_cache


async def send_startup() -> None:
    """Send a startup telemetry event to the cloud if consent is given.

    Throttled to at most once per 24 hours. Silently swallows all errors.
    """
    global _last_startup_ts

    try:
        settings = get_settings()

        if not settings.get("telemetryConsent"):
            return

        now = time.monotonic()
        if now - _last_startup_ts < _THROTTLE_SECONDS and _last_startup_ts > 0:
            return

        cloud_url = settings.get("cloudUrl", "https://lumbergh.jc.turbo.inc")
        install_id = settings.get("installationId", "")
        if not install_id:
            return

        properties = {
            "version": _get_version(),
            "os": platform.system(),
            "arch": platform.machine(),
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
                    "events": [{"event": "startup", "properties": properties}],
                },
            )

        _last_startup_ts = now
        logger.debug("Startup telemetry sent")
    except Exception:
        logger.debug("Startup telemetry failed", exc_info=True)
