"""Launch a todo as a worker: the todo is the brief, the brief is the spawn.

The dashboard already has everything a spawn needs sitting in a todo row — a title, a
description, and the session whose repo it belongs to. This turns that into the same
request `lb spawn` makes, so a todo launched from the UI is indistinguishable from one
Bill handed out: tracked worktree, recorded brief, `lb fleet` row, redeliverable.
"""

import re
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import HTTPException

from lumbergh import bill as bill_bundle
from lumbergh.git_utils import get_branches

if TYPE_CHECKING:
    from lumbergh.routers.bill import SpawnBody

MAX_BRANCH_LEN = 40


def _fail(stage: str, error: str, help_text: str) -> HTTPException:
    """Bill's spawn-failure shape, so the UI renders both kinds of refusal the same way."""
    return HTTPException(
        status_code=400, detail={"stage": stage, "error": error, "help": help_text}
    )


def launch_repo(meta: dict) -> Path:
    """The repo a launch from this session branches from.

    A worker's own workdir is a worktree, and a worktree cannot be branched from — so a
    launch fired inside a worker branches from the repo that worker came from. That is
    also the only tier there is: every worker is a sibling under the same overseer,
    never a worker of a worker.
    """
    origin = meta.get("worktree_parent_repo") or meta.get("workdir")
    if not origin:
        raise _fail(
            "repo",
            "this session has no repository to branch from",
            "open the session in a git repo, or spawn the worker by hand",
        )
    return Path(origin).expanduser().resolve()


def existing_branches(repo: Path) -> set[str]:
    """Branch names the repo itself already carries.

    A landed worker's branch outlives its worktree and its registry row, so the registry
    alone cannot say which names are free — the name it calls unused is the one git
    refuses to create.  Best-effort: a repo git cannot read yields nothing rather than
    blocking the launch.
    """
    try:
        return {str(b["name"]) for b in get_branches(repo).get("local", []) if b.get("name")}
    except Exception:
        return set()


def branch_for(text: str, taken: set[str]) -> str:
    """A branch name a person would recognise as the todo they clicked."""
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    base = slug[:MAX_BRANCH_LEN].strip("-") or "todo"
    if base not in taken:
        return base
    n = 2
    while f"{base}-{n}" in taken:
        n += 1
    return f"{base}-{n}"


def write_brief(text: str, description: str, slug: str) -> Path:
    """Record the todo where every other brief lives, so redeliver and `lb fleet` find it."""
    briefs = bill_bundle.home() / "briefs"
    briefs.mkdir(parents=True, exist_ok=True)
    brief = briefs / f"{slug}.md"
    body = f"# {text}\n"
    if description.strip():
        body += f"\n{description.strip()}\n"
    brief.write_text(body)
    return brief


def launch(
    meta: dict,
    todo: dict,
    *,
    taken: set[str],
    spawn: Callable[["SpawnBody"], dict],
) -> dict:
    from lumbergh.routers.bill import SpawnBody

    repo = launch_repo(meta)
    text = (todo.get("text") or "").strip()
    branch = branch_for(text, taken | existing_branches(repo))
    brief = write_brief(text, todo.get("description") or "", branch)
    return spawn(
        SpawnBody(
            repo=str(repo),
            branch=branch,
            kind="ship",
            brief_path=str(brief),
            name=branch,
            create_branch=True,
            task_intent=text,
        )
    )
