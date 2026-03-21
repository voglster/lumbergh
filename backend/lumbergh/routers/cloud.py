"""
Cloud connection router — device code flow for linking to lumbergh-cloud.
"""

import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from lumbergh.routers.settings import deep_merge, get_settings, settings_table

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cloud", tags=["cloud"])


class PollRequest(BaseModel):
    device_code: str


@router.post("/connect")
async def connect():
    """Start device code flow: call cloud's /api/auth/device/start, open browser."""
    settings = get_settings()
    cloud_url = settings.get("cloudUrl", "https://lumbergh.jc.turbo.inc")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{cloud_url}/api/auth/device/start")
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach cloud: {e}")

    return {
        "device_code": data["device_code"],
        "user_code": data["user_code"],
        "verification_url": data.get("verification_url", ""),
    }


@router.post("/poll")
async def poll(body: PollRequest):
    """Poll cloud for device authorization status."""
    settings = get_settings()
    cloud_url = settings.get("cloudUrl", "https://lumbergh.jc.turbo.inc")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{cloud_url}/api/auth/device/poll",
                json={"device_code": body.device_code},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach cloud: {e}")

    if data.get("status") == "complete":
        # Save token and username to settings
        current = get_settings()
        merged = deep_merge(
            current,
            {
                "cloudToken": data["token"],
                "cloudUsername": data["username"],
            },
        )
        settings_table.truncate()
        settings_table.insert(merged)

        # Send cloud_linked telemetry event (fire-and-forget)
        _send_cloud_linked_event(cloud_url, current)

    return data


def _send_cloud_linked_event(cloud_url: str, settings: dict) -> None:
    """Fire-and-forget cloud_linked telemetry event."""
    import asyncio

    async def _send():
        try:
            install_id = settings.get("installationId", "")
            if not install_id or not settings.get("telemetryConsent"):
                return
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    f"{cloud_url}/api/telemetry/events",
                    json={
                        "install_id": install_id,
                        "events": [
                            {
                                "event": "cloud_linked",
                                "properties": {
                                    "cloud_account_id": settings.get("cloudUsername", ""),
                                },
                            }
                        ],
                    },
                )
        except Exception:
            logger.debug("cloud_linked telemetry failed", exc_info=True)

    _task = asyncio.create_task(_send())  # noqa: RUF006


@router.post("/disconnect")
async def disconnect():
    """Clear cloud token and username from settings."""
    current = get_settings()
    current.pop("cloudToken", None)
    current.pop("cloudUsername", None)
    settings_table.truncate()
    settings_table.insert(current)
    return {"status": "ok"}
