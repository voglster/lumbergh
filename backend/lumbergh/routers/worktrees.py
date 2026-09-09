from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from lumbergh import git_utils, land, worktrees
from lumbergh.routers.sessions import get_session_workdir, get_stored_sessions
from lumbergh.routers.settings import get_settings
from lumbergh.targets import parse_target
from lumbergh.tmux_pty import kill_tmux_session, kill_tmux_window, list_tmux_sessions

router = APIRouter(prefix="/api/worktrees", tags=["worktrees"])


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _live_sessions() -> dict[str, dict]:
    alive = {s["name"] for s in list_tmux_sessions()}
    return {n: m for n, m in get_stored_sessions().items() if n in alive}


def _global_base_dir() -> str | None:
    return get_settings().get("worktree", {}).get("base_dir") or None


class CreateBody(BaseModel):
    repo: str
    branch: str
    create_branch: bool = False
    base_branch: str | None = None
    session: str | None = None
    task_intent: str | None = None


class ReapBody(BaseModel):
    path: str
    force: bool = False
    rm_branch: bool = False
    # The client's pid, so the sweep for leftover processes spares the shell that
    # asked for the reap — `lb worktree reap .` is run from inside the worktree.
    caller_pid: int | None = None


class AdoptBody(BaseModel):
    path: str
    session: str | None = None


class PathBody(BaseModel):
    path: str


@router.post("")
def create(body: CreateBody):
    return worktrees.create(
        Path(body.repo).expanduser(),
        body.branch,
        created_at=_now(),
        create_branch=body.create_branch,
        base_branch=body.base_branch,
        session=body.session,
        task_intent=body.task_intent,
        global_base_dir=_global_base_dir(),
    )


@router.get("")
def ls(repo: str | None = None):
    if repo is None:
        return {"worktrees": worktrees.reconcile_all(_live_sessions())}
    return {"worktrees": worktrees.reconcile(Path(repo).expanduser(), _live_sessions())}


@router.get("/for-session/{name}")
def for_session(name: str):
    """The worktrees sharing this session's repo.

    The Git tab knows a session name and has no way to learn a filesystem path,
    and when the session is itself a worktree the interesting set belongs to its
    parent repo — ``parent_repo_of`` resolves both cases through
    ``--git-common-dir``, returning the main checkout either way.
    """
    workdir = get_session_workdir(name)
    repo = worktrees.parent_repo_of(workdir)
    return {"repo": str(repo), "worktrees": worktrees.reconcile(repo, _live_sessions())}


@router.get("/readiness")
def readiness(path: str):
    """What reaping this worktree would cost, without touching it.

    ``reap_readiness`` already decides this for `reap` itself, but it reports
    dirtiness only as the blocker string — the caller deciding whether to force
    needs the number of files, so ``work_in_progress`` is merged in alongside.
    The live session is named because a reap takes the worker's tmux window down
    with the tree, and that is not visible from the git state alone.
    """
    wt = Path(path).expanduser()
    facts = worktrees.reap_readiness(wt)
    session, _ = worktrees._live_session_for(wt, _live_sessions())
    return {**facts, **worktrees.work_in_progress(wt), "session": session}


@router.post("/reap")
def reap(body: ReapBody):
    path = Path(body.path).expanduser()
    # Capture the worker before reap drops the registry entry. Only kill it on a
    # real removal: a refused reap (dirty/unlanded/unknown) is a stop-and-report, and its
    # worker must be left running so nothing is lost.
    entry = worktrees.get_entry(path) or {}
    worker = entry.get("target")
    result = worktrees.reap(
        path, force=body.force, rm_branch=body.rm_branch, caller_pid=body.caller_pid
    )
    if result.get("status") == "removed" and worker:
        if parse_target(worker)[1] is not None:
            kill_tmux_window(worker)
        else:
            kill_tmux_session(worker)
    return result


@router.post("/adopt")
def adopt(body: AdoptBody):
    return worktrees.adopt(Path(body.path).expanduser(), _now(), body.session)


@router.post("/link")
def link(body: PathBody):
    wt = Path(body.path).expanduser()
    repo = worktrees.parent_repo_of(wt)
    cfg = worktrees.parse_worktree_config(repo)
    return {"linked": worktrees.apply_links(repo, wt, worktrees.plan_links(repo, wt, cfg))}


class DepsBody(BaseModel):
    path: str
    base: str | None = None


@router.post("/deps")
def deps(body: DepsBody):
    """Whether this worktree's linked dependency dirs still match what its code declares.

    The base defaults to the branch the worktree was created from, falling back to the
    remote's default branch — the same comparison `lb land` makes before it smokes.
    """
    wt = Path(body.path).expanduser()
    repo = worktrees.parent_repo_of(wt)
    entry = worktrees.get_entry(wt) or {}
    base = (
        body.base
        or git_utils.resolve_base_ref(wt, entry.get("base_branch"))
        or git_utils.default_base_ref(wt)
    )
    drift = worktrees.dep_drift(wt, land.changed_paths(wt, base), repo)
    return {
        "path": str(wt),
        "base": base,
        "drift": drift,
        "dep_sync": worktrees.read_dep_sync(repo),
    }


@router.post("/unlink")
def unlink(body: PathBody):
    wt = Path(body.path).expanduser()
    entry = worktrees.get_entry(wt) or {}
    results = [worktrees.unlink_path(wt, r["path"]) for r in entry.get("links_applied", [])]
    return {"unlinked": results}
