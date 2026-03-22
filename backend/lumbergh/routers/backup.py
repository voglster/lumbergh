"""
Backup proxy router — local endpoints that orchestrate cloud backup operations.
"""

import asyncio
import json
import logging

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from lumbergh import cloud_client
from lumbergh.backup import (
    apply_backup_data,
    collect_backup_data,
    compute_data_hash,
    decrypt_data,
    encrypt_data,
    get_backup_meta,
)
from lumbergh.routers.settings import deep_merge, get_settings, settings_table

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/backup", tags=["backup"])


def _require_install_id() -> str:
    """Return the installation ID from settings. Raises 400 if missing."""
    settings = get_settings()
    install_id = settings.get("installationId")
    if not install_id:
        raise HTTPException(status_code=400, detail="No installation ID")
    return install_id


@router.post("/push")
async def push_backup():
    """Collect local data and push to cloud."""
    install_id = _require_install_id()
    settings = get_settings()

    include_api_keys = settings.get("backupIncludeApiKeys", False)
    data = await asyncio.get_event_loop().run_in_executor(
        None, collect_backup_data, include_api_keys
    )

    # Encrypt if passphrase is set
    passphrase = settings.get("backupPassphrase")
    encrypted = False
    upload_data: dict | str = data
    if passphrase:
        upload_data = await asyncio.get_event_loop().run_in_executor(
            None, encrypt_data, data, passphrase
        )
        encrypted = True

    meta = get_backup_meta(data)

    try:
        resp = await cloud_client.request(
            "PUT",
            f"/api/backup/{install_id}",
            json={"data": upload_data, "encrypted": encrypted, "meta": meta, "version": 1},
            timeout=30.0,
        )
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cloud backup failed: {e}")

    # Update local backup status
    data_hash = compute_data_hash(data)
    from datetime import UTC, datetime

    now = datetime.now(UTC).isoformat()
    current = get_settings()
    merged = deep_merge(current, {"lastBackupTime": now, "lastBackupHash": data_hash})
    settings_table.truncate()
    settings_table.insert(merged)

    return {"status": "ok", "lastBackupTime": now, "lastBackupHash": data_hash}


class RestoreRequest(BaseModel):
    passphrase: str | None = None


@router.post("/restore")
async def restore_backup(body: RestoreRequest | None = None):
    """Pull backup from cloud and overwrite local files."""
    install_id = _require_install_id()

    try:
        resp = await cloud_client.request("GET", f"/api/backup/{install_id}", timeout=30.0)
        resp.raise_for_status()
        backup = resp.json()
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(status_code=404, detail="No backup found")
        raise HTTPException(status_code=502, detail=f"Cloud request failed: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cloud request failed: {e}")

    data = backup.get("data")
    if backup.get("encrypted"):
        passphrase = body.passphrase if body else None
        if not passphrase:
            raise HTTPException(status_code=400, detail="Backup is encrypted — passphrase required")
        try:
            data = decrypt_data(data, passphrase)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    await asyncio.get_event_loop().run_in_executor(None, apply_backup_data, data)

    return {"status": "ok"}


@router.get("/status")
async def backup_status():
    """Return current backup status."""
    settings = get_settings()
    return {
        "enabled": settings.get("backupEnabled", False),
        "includeApiKeys": settings.get("backupIncludeApiKeys", False),
        "lastBackupTime": settings.get("lastBackupTime"),
        "lastBackupHash": settings.get("lastBackupHash"),
        "hasPassphrase": bool(settings.get("backupPassphrase")),
    }


class ToggleRequest(BaseModel):
    enabled: bool


@router.post("/toggle")
async def toggle_backup(body: ToggleRequest):
    """Enable or disable auto-backup."""
    current = get_settings()
    merged = deep_merge(current, {"backupEnabled": body.enabled})
    settings_table.truncate()
    settings_table.insert(merged)
    return {"status": "ok", "enabled": body.enabled}


@router.delete("")
async def delete_backup():
    """Delete the cloud backup for this installation."""
    install_id = _require_install_id()

    try:
        resp = await cloud_client.request("DELETE", f"/api/backup/{install_id}", timeout=10.0)
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(status_code=404, detail="No backup found")
        raise HTTPException(status_code=502, detail=f"Cloud request failed: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cloud request failed: {e}")

    # Clear local backup status
    current = get_settings()
    current.pop("lastBackupTime", None)
    current.pop("lastBackupHash", None)
    settings_table.truncate()
    settings_table.insert(current)

    return {"status": "ok"}


@router.get("/download-local")
async def download_local_backup():
    """Download a fresh snapshot of all local data as a JSON file (no cloud required)."""
    settings = get_settings()
    include_api_keys = settings.get("backupIncludeApiKeys", False)
    data = await asyncio.get_event_loop().run_in_executor(
        None, collect_backup_data, include_api_keys
    )
    content = json.dumps(data, indent=2, default=str)
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=lumbergh-backup-local.json"},
    )


@router.get("/download")
async def download_backup():
    """Download the last cloud backup as a JSON file."""
    install_id = _require_install_id()

    try:
        resp = await cloud_client.request("GET", f"/api/backup/{install_id}", timeout=30.0)
        resp.raise_for_status()
        backup = resp.json()
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(status_code=404, detail="No backup found")
        raise HTTPException(status_code=502, detail=f"Cloud request failed: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cloud request failed: {e}")

    content = json.dumps(backup, indent=2, default=str)
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=lumbergh-backup.json"},
    )
