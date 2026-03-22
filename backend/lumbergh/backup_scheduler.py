"""
Background scheduler for automatic cloud backups.

Follows the idle_monitor.py pattern: singleton class with start/stop and
an async loop that runs periodically.
"""

import asyncio
import logging
from datetime import UTC, datetime

from lumbergh import cloud_client
from lumbergh.backup import collect_backup_data, compute_data_hash, encrypt_data, get_backup_meta

logger = logging.getLogger(__name__)


class BackupScheduler:
    """Background service that periodically backs up local data to the cloud."""

    INTERVAL_SECONDS = 300  # 5 minutes

    def __init__(self):
        self._task: asyncio.Task | None = None
        self._running = False

    def start(self) -> None:
        """Start the background backup loop."""
        if self._task is None or self._task.done():
            self._running = True
            self._task = asyncio.create_task(self._loop())
            logger.info("Backup scheduler started")

    def stop(self) -> None:
        """Stop the background backup loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None
            logger.info("Backup scheduler stopped")

    async def _loop(self) -> None:
        """Main loop: check and push backups periodically."""
        while self._running:
            try:
                await self._maybe_backup()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.debug("Backup scheduler error", exc_info=True)

            await asyncio.sleep(self.INTERVAL_SECONDS)

    async def _maybe_backup(self) -> None:
        """Check if backup is needed and push if data changed."""
        from lumbergh.routers.settings import deep_merge, get_settings, settings_table

        settings = get_settings()

        # Check prerequisites
        if not settings.get("backupEnabled"):
            return
        cloud_token = settings.get("cloudToken")
        cloud_url = settings.get("cloudUrl")
        install_id = settings.get("installationId")
        if not cloud_token or not cloud_url or not install_id:
            return

        # Collect data and check for changes
        include_api_keys = settings.get("backupIncludeApiKeys", False)
        data = await asyncio.get_event_loop().run_in_executor(
            None, collect_backup_data, include_api_keys
        )
        data_hash = compute_data_hash(data)

        if data_hash == settings.get("lastBackupHash"):
            return  # No changes

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

        # Push to cloud
        resp = await cloud_client.request(
            "PUT",
            f"/api/backup/{install_id}",
            json={"data": upload_data, "encrypted": encrypted, "meta": meta, "version": 1},
            timeout=30.0,
        )
        resp.raise_for_status()

        # Update settings with backup status
        now = datetime.now(UTC).isoformat()
        current = get_settings()
        merged = deep_merge(current, {"lastBackupTime": now, "lastBackupHash": data_hash})
        settings_table.truncate()
        settings_table.insert(merged)
        logger.info("Cloud backup completed")


# Global singleton
backup_scheduler = BackupScheduler()
