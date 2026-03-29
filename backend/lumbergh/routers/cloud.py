"""
Cloud connection router — device code flow for linking to lumbergh-cloud.
"""

import logging
import platform

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from lumbergh import cloud_client
from lumbergh.routers.settings import _is_ai_configured, deep_merge, get_settings, settings_table
from lumbergh.telemetry import get_version

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cloud", tags=["cloud"])


class PollRequest(BaseModel):
    device_code: str


@router.post("/connect")
async def connect():
    """Start device code flow: call cloud's /api/auth/device/start, open browser."""
    try:
        resp = await cloud_client.request(
            "POST", "/api/auth/device/start", require_token=False, timeout=10.0
        )
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
    try:
        resp = await cloud_client.request(
            "POST",
            "/api/auth/device/poll",
            json={"device_code": body.device_code},
            require_token=False,
            timeout=10.0,
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
        # Auto-select Lumbergh Cloud AI if no provider is configured yet
        if not _is_ai_configured(merged):
            merged["ai"] = {**merged.get("ai", {}), "provider": "lumbergh_cloud"}

        settings_table.truncate()
        settings_table.insert(merged)

        # Link this installation to the user's cloud account
        await _link_instance(merged)

    return data


@router.post("/relink")
async def relink():
    """Re-link this installation to the user's cloud account."""
    settings = get_settings()
    if not settings.get("cloudToken"):
        raise HTTPException(status_code=400, detail="Not connected to cloud")
    await _link_instance(settings)
    return {"status": "ok"}


async def _link_instance(settings: dict) -> None:
    """Register this installation with the cloud account."""
    install_id = settings.get("installationId", "")
    if not install_id:
        return
    try:
        resp = await cloud_client.request(
            "POST",
            "/api/user/dashboard/link-instance",
            json={
                "install_id": install_id,
                "version": get_version(),
                "os": platform.system(),
                "arch": platform.machine(),
                "hostname": platform.node(),
            },
            timeout=10.0,
        )
        resp.raise_for_status()
    except Exception:
        logger.debug("Failed to link instance with cloud", exc_info=True)


# --- Shared prompts proxy ---


async def _cloud_json(method: str, path: str, **kwargs):
    """Forward a request to cloud, return parsed JSON. Raises HTTPException on failure."""
    try:
        resp = await cloud_client.request(method, path, **kwargs)
        resp.raise_for_status()
        return resp.json()
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach cloud: {e}")


class SharePromptRequest(BaseModel):
    name: str
    prompt: str


@router.post("/prompts/share")
async def proxy_share_prompt(body: SharePromptRequest):
    """Forward share/update request to cloud."""
    return await _cloud_json("POST", "/api/prompts/share", json=body.model_dump())


@router.get("/prompts/shared/{code}")
async def proxy_get_shared(code: str):
    """Forward prompt lookup to cloud."""
    return await _cloud_json("GET", f"/api/prompts/shared/{code}")


@router.get("/prompts/shared/{code}/versions")
async def proxy_get_versions(code: str):
    """Forward version history lookup to cloud."""
    return await _cloud_json("GET", f"/api/prompts/shared/{code}/versions")


@router.get("/prompts/community")
async def proxy_community(q: str = ""):
    """Forward community browse to cloud."""
    params = f"?q={q}" if q else ""
    return await _cloud_json("GET", f"/api/prompts/community{params}")


@router.post("/prompts/{code}/install")
async def proxy_install(code: str):
    """Forward install tracking to cloud."""
    return await _cloud_json("POST", f"/api/prompts/{code}/install")


class LintPromptRequest(BaseModel):
    prompt: str
    name: str = ""
    mode: str = "quick"


@router.post("/prompts/lint")
async def proxy_lint_prompt(body: LintPromptRequest):
    """Forward prompt lint request to cloud."""
    return await _cloud_json("POST", "/api/prompts/lint", json=body.model_dump(), timeout=90.0)


@router.get("/plan")
async def get_plan():
    """Return cloud plan info from the tunnel's cached state."""
    from lumbergh.tunnel import cloud_tunnel

    return cloud_tunnel.get_plan_info()


@router.post("/disconnect")
async def disconnect():
    """Clear cloud token and username from settings."""
    current = get_settings()
    current.pop("cloudToken", None)
    current.pop("cloudUsername", None)
    settings_table.truncate()
    settings_table.insert(current)
    return {"status": "ok"}
