"""
Shared HTTP client for all lumbergh-cloud API calls.

Centralises auth header injection, token refresh handling, and error mapping.
Every module that talks to lumbergh-cloud should use this instead of raw httpx.
"""

import logging

import httpx

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 15.0


def _get_cloud_config() -> tuple[str, str]:
    """Return (cloud_url, cloud_token) from settings. Raises ValueError if not configured."""
    from lumbergh.routers.settings import get_settings

    settings = get_settings()
    cloud_url = settings.get("cloudUrl", "https://lumbergh.jc.turbo.inc")
    cloud_token = settings.get("cloudToken", "")
    return cloud_url, cloud_token


def _save_refreshed_token(token: str) -> None:
    """Persist a refreshed cloud token to settings."""
    from lumbergh.routers.settings import deep_merge, get_settings, settings_table

    current = get_settings()
    merged = deep_merge(current, {"cloudToken": token})
    settings_table.truncate()
    settings_table.insert(merged)
    logger.info("Cloud token auto-refreshed")


def _check_token_refresh(response: httpx.Response) -> None:
    """If the server sent a refreshed token, save it."""
    new_token = response.headers.get("X-Refreshed-Token")
    if new_token:
        _save_refreshed_token(new_token)


async def request(
    method: str,
    path: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    require_token: bool = True,
    **kwargs,
) -> httpx.Response:
    """Make an authenticated request to lumbergh-cloud.

    Args:
        method: HTTP method (GET, POST, PUT, DELETE, etc.)
        path: API path (e.g. "/api/prompts/community")
        timeout: Request timeout in seconds.
        require_token: If True (default), raises ValueError when no token is configured.
        **kwargs: Passed through to httpx (json, params, content, etc.)

    Returns:
        The httpx.Response (caller decides whether to .json(), check status, etc.)
    """
    cloud_url, cloud_token = _get_cloud_config()

    if require_token and not cloud_token:
        raise ValueError("Not connected to cloud")

    headers = kwargs.pop("headers", {})
    if cloud_token:
        headers["Authorization"] = f"Bearer {cloud_token}"
        headers.setdefault("Content-Type", "application/json")

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.request(
            method,
            f"{cloud_url}{path}",
            headers=headers,
            **kwargs,
        )
        _check_token_refresh(resp)
        return resp
