"""
Optional password authentication for Lumbergh.

Password can be set via:
1. LUMBERGH_PASSWORD env var (takes precedence)
2. Settings config (password field in ~/.config/lumbergh/settings.json)

If neither is set, auth is completely disabled (current behavior).
Cookie-based sessions with HMAC-signed tokens — no extra dependencies.
"""

import hashlib
import hmac
import os
import secrets
from collections.abc import MutableMapping
from http.cookies import SimpleCookie
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

# --- Configuration ---

COOKIE_NAME = "lumbergh_session"
COOKIE_MAX_AGE = 30 * 24 * 3600  # 30 days

# Random signing key — generated once at startup, so server restart = logout
_SIGNING_KEY = secrets.token_hex(32)


def _get_password() -> str:
    """Get the configured password. Env var takes precedence over config."""
    env_pw = os.environ.get("LUMBERGH_PASSWORD", "").strip()
    if env_pw:
        return env_pw
    # Lazy import to avoid circular dependency at module load time
    from lumbergh.routers.settings import get_settings

    return get_settings().get("password", "").strip()


def _is_auth_enabled() -> bool:
    return bool(_get_password())


def _make_token() -> str:
    """Create an HMAC-SHA256 session token."""
    return hmac.new(_SIGNING_KEY.encode(), b"authenticated", hashlib.sha256).hexdigest()


def _verify_token(token: str) -> bool:
    """Timing-safe comparison of a session token."""
    expected = _make_token()
    return hmac.compare_digest(token, expected)


def _is_secure(scope: dict[str, Any] | MutableMapping[str, Any]) -> bool:
    """Detect if the request came over HTTPS (direct or via reverse proxy)."""
    if scope.get("scheme") == "https":
        return True
    for key, val in scope.get("headers", []):
        if key == b"x-forwarded-proto" and val == b"https":
            return True
    return False


def _get_cookie_from_scope(scope: dict) -> str | None:
    """Extract our session cookie from raw ASGI scope headers."""
    for key, val in scope.get("headers", []):
        if key == b"cookie":
            cookie = SimpleCookie(val.decode())
            morsel = cookie.get(COOKIE_NAME)
            return morsel.value if morsel else None
    return None


# --- ASGI Middleware ---


class AuthMiddleware:
    """Raw ASGI middleware — works for both HTTP and WebSocket."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)

        if not _is_auth_enabled():
            return await self.app(scope, receive, send)

        path: str = scope.get("path", "")

        # Allow: auth endpoints, health check, non-API paths (frontend static)
        if path.startswith("/api/auth") or path == "/api/health" or not path.startswith("/api/"):
            return await self.app(scope, receive, send)

        token = _get_cookie_from_scope(scope)
        valid = token is not None and _verify_token(token)

        if not valid:
            if scope["type"] == "websocket":
                # Must accept then close — can't reject before handshake in ASGI
                await send({"type": "websocket.close", "code": 4401})
                return None
            # HTTP 401
            body = b'{"detail":"Not authenticated"}'
            await send(
                {
                    "type": "http.response.start",
                    "status": 401,
                    "headers": [
                        [b"content-type", b"application/json"],
                        [b"content-length", str(len(body)).encode()],
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return None

        return await self.app(scope, receive, send)


# --- Auth Router ---

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/status")
async def auth_status(request: Request):
    """Check whether auth is enabled and if the current request is authenticated."""
    enabled = _is_auth_enabled()
    authenticated = False
    if not enabled:
        authenticated = True
    else:
        token = request.cookies.get(COOKIE_NAME)
        if token and _verify_token(token):
            authenticated = True
    return {"enabled": enabled, "authenticated": authenticated}


class LoginBody(BaseModel):
    password: str


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response):
    """Validate password and set session cookie."""
    password = _get_password()
    if not password:
        return {"ok": True}

    if not hmac.compare_digest(body.password, password):
        response.status_code = 401
        return {"detail": "Invalid password"}

    token = _make_token()
    secure = _is_secure(request.scope)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
        max_age=COOKIE_MAX_AGE,
    )
    return {"ok": True}


@router.post("/logout")
async def logout(response: Response):
    """Clear session cookie."""
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"ok": True}
