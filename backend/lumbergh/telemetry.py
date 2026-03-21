"""
Startup telemetry — fire-and-forget POST to lumbergh-cloud.
"""

import logging
import platform
import time

import httpx

from lumbergh._version import __version__
from lumbergh.routers.settings import get_settings

logger = logging.getLogger(__name__)

_last_startup_ts: float = 0.0
_THROTTLE_SECONDS = 24 * 3600  # 24 hours


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
            "version": __version__,
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
