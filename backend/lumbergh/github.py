"""Pull requests, borrowed from whatever `gh` is already logged in as.

Lumbergh asks no one for a token: if the `gh` CLI is installed and
authenticated, PRs show up; if it is missing, logged out, or the remote is not
GitHub, the feature is simply absent. Never an error banner for something the
user did not ask to configure.
"""

import json
import logging
import subprocess
import time
from pathlib import Path

logger = logging.getLogger(__name__)

PR_CACHE_TTL = 60  # seconds — a PR list is decoration, not state to poll hard
GH_TIMEOUT = 10  # seconds — gh talks to the network; never block on it

PR_FIELDS = "number,title,state,url,headRefName,isDraft"
# `gh pr list` pages at 30 by default, and a busy monorepo runs well past that;
# a PR missing from the list is indistinguishable from a branch with no PR.
PR_LIMIT = 500

_cache: dict[Path, tuple[float, list[dict]]] = {}


def clear_pr_cache() -> None:
    _cache.clear()


def list_open_prs(cwd: Path) -> list[dict]:
    """Open PRs for the repo at ``cwd``. Empty for anything that is not a
    GitHub repo reachable by an authenticated ``gh``."""
    cached = _cache.get(cwd)
    now = time.monotonic()
    if cached and now - cached[0] < PR_CACHE_TTL:
        return cached[1]

    prs = _ask_gh(cwd)
    _cache[cwd] = (now, prs)
    return prs


def _ask_gh(cwd: Path) -> list[dict]:
    try:
        result = subprocess.run(
            [
                "gh",
                "pr",
                "list",
                "--state",
                "open",
                "--limit",
                str(PR_LIMIT),
                "--json",
                PR_FIELDS,
            ],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=GH_TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError) as e:
        logger.debug("gh unavailable in %s: %s", cwd, e)
        return []

    if result.returncode != 0:
        logger.debug("gh pr list failed in %s: %s", cwd, result.stderr.strip()[:200])
        return []

    try:
        prs = json.loads(result.stdout)
    except json.JSONDecodeError:
        logger.debug("gh pr list returned no JSON in %s", cwd)
        return []

    return prs if isinstance(prs, list) else []
