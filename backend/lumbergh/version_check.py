"""Version check against PyPI with in-memory caching."""

import logging
import subprocess
import time
from pathlib import Path

import httpx

from lumbergh._version import __version__

logger = logging.getLogger(__name__)

PYPI_URL = "https://pypi.org/pypi/pylumbergh/json"
CACHE_TTL = 900  # 15 minutes

_cached_latest: str | None = None
_cached_at: float = 0.0
_effective_version: str | None = None


def _parse_version(v: str) -> tuple[int, ...]:
    """Parse version string to tuple of ints, stripping pre-release suffixes."""
    clean = v.split("-")[0].split("+")[0]
    parts = []
    for p in clean.split("."):
        try:
            parts.append(int(p))
        except ValueError:
            break
    return tuple(parts) if parts else (0,)


def _get_effective_version() -> str:
    """Get the version to compare against.

    In dev mode (0.0.0-dev), use git describe to find the base version
    from tags so we can detect new releases beyond what we're building on.
    """
    global _effective_version
    if _effective_version is not None:
        return _effective_version

    if _parse_version(__version__) != (0, 0, 0):
        _effective_version = __version__
        return _effective_version

    # Dev mode — try git describe to find the latest version tag
    try:
        repo_root = Path(__file__).parent.parent.parent
        result = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0"],
            cwd=repo_root,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
        if result.returncode == 0:
            tag = result.stdout.strip().lstrip("v")
            if tag and _parse_version(tag) > (0, 0, 0):
                _effective_version = tag
                logger.debug("Dev mode: using base version %s from git tag", tag)
                return _effective_version
    except Exception:
        logger.debug("Failed to get version from git tags", exc_info=True)

    _effective_version = __version__
    return _effective_version


def _is_newer(latest: str, current: str) -> bool:
    """Return True if latest is strictly newer than current."""
    return _parse_version(latest) > _parse_version(current)


def _build_response(effective: str, latest: str | None) -> dict:
    update = latest is not None and _is_newer(latest, effective)
    return {
        "current": effective,
        "latest": latest,
        "update_available": update,
    }


async def get_version_info() -> dict:
    """Check PyPI for the latest version, with 15-min caching."""
    global _cached_latest, _cached_at

    effective = _get_effective_version()
    now = time.monotonic()

    if _cached_latest and (now - _cached_at) < CACHE_TTL:
        return _build_response(effective, _cached_latest)

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(PYPI_URL, timeout=5.0)
            resp.raise_for_status()
            latest = resp.json()["info"]["version"]
            _cached_latest = latest
            _cached_at = now
    except Exception:
        logger.debug("Failed to check PyPI for latest version", exc_info=True)
        return _build_response(effective, _cached_latest)

    return _build_response(effective, _cached_latest)
