"""
Cloud tunnel - persistent outbound WebSocket to Lumbergh Cloud for remote session access.

Sends session metadata and relays terminal I/O through the cloud so users can
access their sessions from a phone or any browser.
"""

import asyncio
import base64
import json
import logging

import websockets

logger = logging.getLogger(__name__)

# Reconnect backoff: 1s, 2s, 4s, 8s, ... capped at 60s
INITIAL_BACKOFF = 1
MAX_BACKOFF = 60
SYNC_INTERVAL = 30  # seconds between full session syncs


class CloudClient:
    """Adapter that looks like a WebSocket to SessionManager but relays output over the tunnel.

    SessionManager calls client.send_json({"type": "output", "data": "..."}) to broadcast
    terminal output. This adapter intercepts those calls and forwards them over the cloud
    tunnel as session_output messages.
    """

    def __init__(self, session_name: str, tunnel: "CloudTunnel"):
        self._session_name = session_name
        self._tunnel = tunnel

    async def send_json(self, message: dict) -> None:
        msg_type = message.get("type")
        if msg_type == "output":
            data = message.get("data", "")
            # Base64 encode for safe JSON transport of terminal escape sequences
            encoded = base64.b64encode(data.encode("utf-8", errors="replace")).decode("ascii")
            await self._tunnel.send(
                {"type": "session_output", "session": self._session_name, "data": encoded}
            )
        elif msg_type == "session_dead":
            await self._tunnel.send({"type": "session_dead", "session": self._session_name})
        elif msg_type == "copy_mode":
            # Skip copy_mode for remote clients - not useful on mobile
            pass
        elif msg_type == "resize_sync":
            # Skip resize_sync for cloud clients
            pass

    def __hash__(self):
        return id(self)

    def __eq__(self, other):
        return self is other


class CloudTunnel:
    """Manages the persistent WebSocket connection to Lumbergh Cloud."""

    def __init__(self):
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._task: asyncio.Task | None = None
        self._sync_task: asyncio.Task | None = None
        self._cloud_clients: dict[str, CloudClient] = {}  # session_name -> CloudClient
        self._running = False
        self._sync_event = asyncio.Event()
        self._plan_info: dict = {"plan": "free", "limit": 3}

    def start(self) -> None:
        if self._task is not None:
            return
        self._running = True
        self._task = asyncio.create_task(self._connect_loop())
        logger.info("Cloud tunnel started")

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None
        if self._sync_task:
            self._sync_task.cancel()
            self._sync_task = None
        logger.info("Cloud tunnel stopped")

    def notify_session_change(self) -> None:
        """Trigger an immediate session re-sync."""
        self._sync_event.set()

    def get_plan_info(self) -> dict:
        """Return cached plan info from the cloud."""
        from lumbergh.routers.sessions import get_stored_sessions

        stored = get_stored_sessions()
        used = sum(1 for s in stored.values() if s.get("cloud_enabled"))
        return {**self._plan_info, "used": used}

    async def send(self, message: dict) -> None:
        if self._ws is None:
            return
        try:
            await self._ws.send(json.dumps(message))
        except Exception:
            logger.warning("Failed to send message over tunnel")

    async def _connect_loop(self) -> None:
        backoff = INITIAL_BACKOFF

        while self._running:
            try:
                cloud_url, cloud_token, install_id = self._get_config()
                if not cloud_token or not install_id:
                    logger.debug("Cloud not configured, tunnel sleeping")
                    await asyncio.sleep(30)
                    continue

                # Convert http(s) URL to ws(s) URL
                ws_url = cloud_url.replace("https://", "wss://").replace("http://", "ws://")
                uri = f"{ws_url}/api/tunnel/connect?token={cloud_token}&install_id={install_id}"

                logger.info(f"Connecting tunnel to {cloud_url}")
                async with websockets.connect(
                    uri,
                    ping_interval=None,  # Cloud handles pinging
                    close_timeout=5,
                ) as ws:
                    self._ws = ws
                    backoff = INITIAL_BACKOFF  # Reset on successful connect
                    logger.info("Tunnel connected")

                    # Send initial session sync
                    await self._sync_sessions()

                    # Start periodic sync task
                    self._sync_task = asyncio.create_task(self._periodic_sync())

                    try:
                        async for raw_message in ws:
                            try:
                                data = json.loads(raw_message)
                                await self._handle_message(data)
                            except json.JSONDecodeError:
                                logger.warning("Invalid JSON from cloud tunnel")
                    finally:
                        if self._sync_task:
                            self._sync_task.cancel()
                            self._sync_task = None
                        self._ws = None
                        # Clean up all cloud clients
                        await self._cleanup_cloud_clients()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"Tunnel connection error: {e}")

            if self._running:
                logger.info(f"Tunnel reconnecting in {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF)

    async def _handle_message(self, data: dict) -> None:
        msg_type = data.get("type")
        session_name = data.get("session")

        if msg_type == "ping":
            await self.send({"type": "pong"})
        elif msg_type == "plan_info":
            self._plan_info = {"plan": data.get("plan", "free"), "limit": data.get("limit", 3)}
            logger.info(f"Plan info: {self._plan_info}")
        elif msg_type == "api_request" and data.get("id"):
            await self._handle_api_request(data["id"], data)
        elif session_name:
            await self._handle_session_message(msg_type, session_name, data)

    async def _handle_session_message(
        self, msg_type: str | None, session_name: str, data: dict
    ) -> None:
        if msg_type == "subscribe":
            await self._subscribe(session_name)
        elif msg_type == "unsubscribe":
            await self._unsubscribe(session_name)
        elif msg_type == "input":
            input_data = data.get("data", "")
            if input_data:
                await self._handle_input(session_name, input_data)
        elif msg_type == "resize":
            await self._handle_resize(session_name, data.get("cols", 80), data.get("rows", 24))
        elif msg_type == "set_cloud_enabled":
            await self._set_cloud_enabled(session_name, data.get("enabled", False))

    async def _subscribe(self, session_name: str) -> None:
        """Cloud requests terminal output for a session (browser viewer connected)."""
        from lumbergh.session_manager import session_manager

        if session_name in self._cloud_clients:
            return  # Already subscribed

        client = CloudClient(session_name, self)
        self._cloud_clients[session_name] = client

        try:
            await session_manager.register_client(session_name, client)
            logger.info(f"Cloud subscribed to session: {session_name}")
        except (ValueError, Exception) as e:
            logger.warning(f"Failed to subscribe to session {session_name}: {e}")
            del self._cloud_clients[session_name]

    async def _unsubscribe(self, session_name: str) -> None:
        """Cloud no longer needs terminal output (last browser viewer left)."""
        from lumbergh.session_manager import session_manager

        client = self._cloud_clients.pop(session_name, None)
        if client:
            await session_manager.unregister_client(session_name, client)
            logger.info(f"Cloud unsubscribed from session: {session_name}")

    async def _handle_input(self, session_name: str, data: str) -> None:
        from lumbergh.session_manager import session_manager

        await session_manager.handle_client_message(session_name, {"type": "input", "data": data})

    async def _handle_resize(self, session_name: str, cols: int, rows: int) -> None:
        from lumbergh.session_manager import session_manager

        await session_manager.handle_client_message(
            session_name, {"type": "resize", "cols": cols, "rows": rows}
        )

    async def _handle_api_request(self, request_id: str, data: dict) -> None:
        """Handle a proxied API request from the cloud by calling the local ASGI app directly."""
        import httpx

        from lumbergh.auth import CLOUD_PROXY_KEY
        from lumbergh.main import app

        method = data.get("method", "GET")
        path = data.get("path", "")
        body = data.get("body")

        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://localhost"
            ) as client:
                kwargs: dict = {"headers": {"X-Cloud-Proxy-Key": CLOUD_PROXY_KEY}}
                if body:
                    kwargs["headers"]["Content-Type"] = "application/json"
                    kwargs["content"] = body

                resp = await client.request(method, path, **kwargs)
                await self.send(
                    {
                        "type": "api_response",
                        "id": request_id,
                        "status": resp.status_code,
                        "body": resp.text,
                        "content_type": resp.headers.get("content-type", "application/json"),
                    }
                )
        except Exception as e:
            logger.warning(f"API proxy error for {method} {path}: {e}")
            await self.send(
                {
                    "type": "api_response",
                    "id": request_id,
                    "status": 502,
                    "body": json.dumps({"detail": f"Local API error: {e}"}),
                }
            )

    async def _set_cloud_enabled(self, session_name: str, enabled: bool) -> None:
        """Handle remote toggle of cloudEnabled from the cloud UI."""
        from tinydb import Query

        from lumbergh.routers.sessions import sessions_table

        session_q = Query()
        doc = sessions_table.get(session_q.name == session_name)
        if doc and isinstance(doc, dict):
            record = {**doc}
            record["cloud_enabled"] = enabled
            sessions_table.upsert(record, session_q.name == session_name)
            self.notify_session_change()
            logger.info(f"Remote toggle cloud_enabled={enabled} for session: {session_name}")

    async def _cleanup_cloud_clients(self) -> None:
        """Unregister all cloud clients when tunnel disconnects."""
        from lumbergh.session_manager import session_manager

        for session_name, client in list(self._cloud_clients.items()):
            try:
                await session_manager.unregister_client(session_name, client)
            except Exception:  # noqa: S110 - cleanup is best-effort
                pass
        self._cloud_clients.clear()

    async def _sync_sessions(self) -> None:
        """Build and send the full session list to the cloud."""
        from lumbergh.routers.sessions import (
            get_live_sessions,
            get_session_status,
            get_stored_sessions,
        )

        live = get_live_sessions()
        stored = get_stored_sessions()
        sessions = []
        seen_names = set()

        for name, meta in stored.items():
            seen_names.add(name)
            live_info = live.get(name, {})
            status_info = get_session_status(name)
            sessions.append(
                {
                    "name": name,
                    "workdir": meta.get("workdir", ""),
                    "description": meta.get("description", ""),
                    "displayName": meta.get("displayName", ""),
                    "alive": live_info.get("alive", False),
                    "attached": live_info.get("attached", False),
                    "windows": live_info.get("windows", 0),
                    "status": status_info.get("status"),
                    "statusUpdatedAt": status_info.get("statusUpdatedAt"),
                    "idleState": status_info.get("idleState"),
                    "idleStateUpdatedAt": status_info.get("idleStateUpdatedAt"),
                    "type": meta.get("type", "direct"),
                    "worktreeParentRepo": meta.get("worktree_parent_repo"),
                    "worktreeBranch": meta.get("worktree_branch"),
                    "lastUsedAt": meta.get("lastUsedAt"),
                    "paused": meta.get("paused", False),
                    "agentProvider": meta.get("agent_provider"),
                    "cloudEnabled": meta.get("cloud_enabled", False),
                }
            )

        # Include orphan tmux sessions
        for name, live_info in live.items():
            if name not in seen_names:
                status_info = get_session_status(name)
                sessions.append(
                    {
                        "name": name,
                        "workdir": None,
                        "description": None,
                        "displayName": "",
                        "alive": True,
                        "attached": live_info.get("attached", False),
                        "windows": live_info.get("windows", 0),
                        "status": status_info.get("status"),
                        "statusUpdatedAt": status_info.get("statusUpdatedAt"),
                        "idleState": status_info.get("idleState"),
                        "idleStateUpdatedAt": status_info.get("idleStateUpdatedAt"),
                        "type": "direct",
                        "lastUsedAt": None,
                        "paused": False,
                    }
                )

        await self.send({"type": "sessions_sync", "sessions": sessions})

    async def _periodic_sync(self) -> None:
        """Periodically re-sync sessions, or immediately on notification."""
        try:
            while True:
                try:
                    await asyncio.wait_for(self._sync_event.wait(), timeout=SYNC_INTERVAL)
                    self._sync_event.clear()
                except TimeoutError:
                    pass  # Periodic sync
                await self._sync_sessions()
        except asyncio.CancelledError:
            pass

    @staticmethod
    def _get_config() -> tuple[str, str, str]:
        """Return (cloud_url, cloud_token, install_id)."""
        from lumbergh.routers.settings import get_settings

        settings = get_settings()
        cloud_url = settings.get("cloudUrl", "https://app.lumbergh.dev")
        cloud_token = settings.get("cloudToken", "")
        install_id = settings.get("installationId", "")
        return cloud_url, cloud_token, install_id


# Global singleton
cloud_tunnel = CloudTunnel()
