"""First-class worktree lifecycle: config, location, linking, registry, reconcile, reap.

Git's `worktree list` is the source of truth for existence; this module keeps a
thin metadata overlay (see registry helpers) reconciled on read.
"""

from __future__ import annotations

import shutil
import subprocess
import tomllib
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Literal

from git.exc import GitCommandError
from tinydb import Query

from lumbergh.db_utils import get_worktrees_db
from lumbergh.git_utils import (
    create_worktree as _git_create_worktree,
)
from lumbergh.git_utils import (
    get_porcelain_status,
    get_repo,
    get_worktree_container_path,
    head_landed_state,
    head_sha,
    list_worktrees,
    resolve_spawn_base,
    sanitize_branch_for_path,
)
from lumbergh.git_utils import (
    remove_worktree as _git_remove_worktree,
)
from lumbergh.proc_utils import kill_processes_under, processes_under
from lumbergh.providers import DEFAULT_PROVIDER

if TYPE_CHECKING:
    from collections.abc import Iterable

# NOTE: do not import get_settings here. The core stays free of the settings/router
# layer; the caller passes `global_base_dir` in (the router reads the setting).

LinkMode = Literal["copy", "symlink"]
DEFAULT_LINKS = [".venv", "node_modules", ".env", ".env.local", ".direnv"]

# Which files declare the contents of a linked dependency directory. A change to one
# of these means the shared environment the link points at no longer matches the code,
# so anything gating against it is testing the wrong versions.
DEP_MANIFESTS: dict[str, tuple[str, ...]] = {
    ".venv": (
        "pyproject.toml",
        "uv.lock",
        "requirements.txt",
        "requirements.in",
        "poetry.lock",
        "Pipfile",
        "Pipfile.lock",
        "setup.py",
        "setup.cfg",
    ),
    "node_modules": (
        "package.json",
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "bun.lockb",
    ),
}


@dataclass(frozen=True)
class LinkSpec:
    path: str
    # `copy` (reflinked where the filesystem can, so it's free on btrfs/xfs) is the default
    # because a symlinked dependency directory is shared *mutable* state. `npm ci`/`uv sync`
    # delete a dep directory's *contents* rather than the directory, so through a symlink
    # they empty the developer's own checkout; anything that writes in place corrupts it
    # more quietly still. A worktree that runs commands has to own what they may destroy.
    # `symlink` stays available for a path a repo really does want shared.
    mode: LinkMode = "copy"


@dataclass
class WorktreeProjectConfig:
    links: list[LinkSpec] | None = None  # None => auto-detect
    post_create: list[str] = field(default_factory=list)
    base_dir: str | None = None


def _coerce_link(entry: object) -> LinkSpec:
    if isinstance(entry, str):
        return LinkSpec(path=entry)
    if isinstance(entry, dict) and "path" in entry:
        mode = entry.get("mode", "copy")
        if mode not in ("copy", "symlink"):
            raise ValueError(f"invalid link mode: {mode!r}")
        return LinkSpec(path=str(entry["path"]), mode=mode)
    raise ValueError(f"invalid link entry: {entry!r}")


def parse_worktree_config(repo: Path) -> WorktreeProjectConfig:
    dotfile = repo / ".lumbergh.toml"
    if not dotfile.is_file():
        return WorktreeProjectConfig()
    data = tomllib.loads(dotfile.read_text())
    wt = data.get("worktree", {})
    raw_links = wt.get("links")
    links = [_coerce_link(e) for e in raw_links] if raw_links is not None else None
    return WorktreeProjectConfig(
        links=links,
        post_create=list(wt.get("post_create", [])),
        base_dir=wt.get("base_dir"),
    )


DELIVERY_MODES = ("pr", "branch", "commit")


def read_delivery_mode(repo: Path) -> str:
    """The repo's ship-delivery policy from `[delivery] mode` in .lumbergh.toml.

    `commit` (commit locally and STOP — the overseer lands) is the DEFAULT: lb imposes
    no delivery pattern, so it never pushes or opens a PR unless a repo opts in. `pr`
    (commit+push+`gh pr create`) and `branch` (push, no PR) are the opt-ins. An
    unrecognized value falls back to the safe `commit` default rather than failing a spawn.
    """
    dotfile = repo / ".lumbergh.toml"
    if not dotfile.is_file():
        return "commit"
    data = tomllib.loads(dotfile.read_text())
    mode = data.get("delivery", {}).get("mode")
    return mode if mode in DELIVERY_MODES else "commit"


def read_dep_sync(repo: Path) -> str | None:
    """The repo's `[worktree] dep_sync` command — how to install a worktree's own
    dependencies once its link to the shared environment has been broken."""
    dotfile = repo / ".lumbergh.toml"
    if not dotfile.is_file():
        return None
    data = tomllib.loads(dotfile.read_text())
    cmd = data.get("worktree", {}).get("dep_sync")
    return cmd if isinstance(cmd, str) and cmd else None


def configured_link_paths(repo: Path) -> list[str]:
    """Every link path the repo's config asks for, whether or not it was applied.
    Unlike ``plan_links`` this doesn't skip paths that already exist in a worktree —
    the callers below are asking about links that are already in place."""
    cfg = parse_worktree_config(repo)
    specs = cfg.links if cfg.links is not None else [LinkSpec(p) for p in DEFAULT_LINKS]
    return [spec.path for spec in specs]


def manifest_drift(changed_paths: Iterable[str], link_paths: Iterable[str]) -> list[dict]:
    """Dependency directories borrowed from the shared checkout whose manifests changed.

    Each hit is a place where a gate would run green against dependencies the code no
    longer declares. A manifest counts only when it sits beside the directory it
    describes, so a sibling project's `pyproject.toml` doesn't implicate `backend/.venv`.

    Says nothing about *how* the directory was borrowed — a symlink and a copy taken from
    the shared checkout are equally stale once a manifest moves. Callers decide which of
    their paths are borrowed; ``dep_drift`` is the symlink-shaped answer.
    """
    changed = {PurePosixPath(p) for p in changed_paths}
    drift = []
    for link in link_paths:
        rel = PurePosixPath(link)
        manifests = DEP_MANIFESTS.get(rel.name)
        if not manifests:
            continue
        hits = sorted(str(c) for c in changed if c.parent == rel.parent and c.name in manifests)
        if hits:
            drift.append({"link": link, "manifests": hits})
    return drift


def borrowed_dep_paths(worktree: Path, repo: Path) -> list[str]:
    """The dependency paths this worktree took from the shared checkout rather than
    installing for itself.

    Deliberately not "is it a symlink": a clone borrowed the shared checkout's *contents*
    just as much as a symlink borrowed its directory, and is just as stale the moment a
    manifest changes — it merely can't destroy the original. The registry says what was
    materialized; a still-symlinked path counts too, so a worktree adopted from disk (or
    created before clones existed) keeps its guard. A dep directory the worker installed
    itself was never borrowed and never appears here.
    """
    entry = get_entry(worktree) or {}
    recorded = [r["path"] for r in entry.get("links_applied", []) if r.get("path")]
    legacy = [p for p in configured_link_paths(repo) if (worktree / p).is_symlink()]
    return sorted(set(recorded) | set(legacy))


def dep_drift(worktree: Path, changed_paths: Iterable[str], repo: Path) -> list[dict]:
    """Whether this worktree's borrowed dependency directories still match what its code
    declares — the question `lb worktree deps` answers before a worker gates."""
    return manifest_drift(changed_paths, borrowed_dep_paths(worktree, repo))


def read_land_smoke(repo: Path) -> str | None:
    dotfile = repo / ".lumbergh.toml"
    if not dotfile.is_file():
        return None
    data = tomllib.loads(dotfile.read_text())
    smoke = data.get("land", {}).get("smoke")
    return smoke if isinstance(smoke, str) and smoke else None


def resolve_worktree_dir(
    repo: Path, branch: str, cfg: WorktreeProjectConfig, global_base_dir: str | None
) -> Path:
    leaf = sanitize_branch_for_path(branch)
    base = cfg.base_dir or global_base_dir
    if base:
        return Path(base).expanduser() / repo.name / leaf
    return get_worktree_container_path(repo) / leaf


def _is_git_ignored(repo: Path, rel: str) -> bool:
    result = subprocess.run(
        ["git", "-C", str(repo), "check-ignore", "-q", rel],
        capture_output=True,
    )
    return result.returncode == 0


def plan_links(repo: Path, worktree: Path, cfg: WorktreeProjectConfig) -> list[LinkSpec]:
    specs = cfg.links if cfg.links is not None else [LinkSpec(p) for p in DEFAULT_LINKS]
    planned: list[LinkSpec] = []
    for spec in specs:
        src = repo / spec.path
        dst = worktree / spec.path
        if not src.exists():
            continue
        if dst.exists() or dst.is_symlink():
            continue
        if not _is_git_ignored(repo, spec.path):
            continue
        planned.append(spec)
    return planned


def _reflink_copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(["cp", "-a", "--reflink=auto", str(src), str(dst)], capture_output=True)
    if result.returncode != 0:
        if src.is_dir():
            shutil.copytree(src, dst, symlinks=True)
        else:
            shutil.copy2(src, dst)


def _exclude_links_in_worktree(worktree: Path, specs: list[LinkSpec]) -> None:
    """Record each linked path in the worktree's own git exclude.

    Links only ever point at gitignored deps, but a ``.venv/`` pattern matches a
    directory and not a symlink-to-directory, so a symlinked link would otherwise
    show as untracked in exactly the tree the overseer eyeballs before landing. A
    root-anchored entry in the worktree's local info/exclude ignores it regardless
    of how the repo's ``.gitignore`` is written.
    """
    if not specs:
        return
    r = subprocess.run(
        ["git", "-C", str(worktree), "rev-parse", "--git-path", "info/exclude"],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )
    if r.returncode != 0:
        return
    exclude_file = Path(r.stdout.strip())
    if not exclude_file.is_absolute():
        exclude_file = worktree / exclude_file
    existing = exclude_file.read_text().splitlines() if exclude_file.exists() else []
    additions = [f"/{spec.path}" for spec in specs if f"/{spec.path}" not in existing]
    if not additions:
        return
    exclude_file.parent.mkdir(parents=True, exist_ok=True)
    prefix = "" if not existing or existing[-1] == "" else "\n"
    with exclude_file.open("a", encoding="utf-8") as f:
        f.write(prefix + "\n".join(additions) + "\n")


def apply_links(repo: Path, worktree: Path, specs: list[LinkSpec]) -> list[dict]:
    applied: list[dict] = []
    for spec in specs:
        src = (repo / spec.path).resolve()
        dst = worktree / spec.path
        dst.parent.mkdir(parents=True, exist_ok=True)
        if spec.mode == "symlink":
            dst.symlink_to(src)
        else:
            _reflink_copy(src, dst)
        applied.append({"path": spec.path, "mode": spec.mode})
    _exclude_links_in_worktree(worktree, specs)
    return applied


def _key(path: Path) -> str:
    return str(Path(path).resolve())


def record_worktree(
    path: Path,
    parent_repo: Path,
    branch: str,
    created_at: str,
    session: str | None = None,
    links_applied: list[dict] | None = None,
    task_intent: str | None = None,
    kind: str | None = None,
    origin: str | None = None,
    target: str | None = None,
    run: str | None = None,
    base_branch: str | None = None,
    base_sha: str | None = None,
    brief_path: str | None = None,
    delivery: str | None = None,
) -> dict:
    resolved_target = target if target is not None else session
    row = {
        "path": _key(path),
        "parent_repo": str(Path(parent_repo).resolve()),
        "branch": branch,
        "created_at": created_at,
        "target": resolved_target,
        "links_applied": links_applied or [],
        "task_intent": task_intent,
        "kind": kind,
        "origin": origin,
        "run": run,
        # What this worktree branched from, so a later dependency-drift check knows
        # which base to diff against instead of guessing at the repo's default.
        "base_branch": base_branch,
        # The commit the worktree actually started at, so "has this worker done
        # anything at all?" is one `rev-parse` rather than a branch comparison
        # against a ref that has since moved.
        "base_sha": base_sha,
        # The brief this worker was handed and the mode it was handed under, so a
        # worker that never took it can be given the same one again rather than a
        # reconstruction of it.
        "brief_path": brief_path,
        "delivery": delivery,
    }
    db = get_worktrees_db()
    db.upsert(row, Query().path == row["path"])
    return row


def head_untouched(worktree: Path) -> bool:
    """Whether the worktree still sits exactly on the commit it was created at.

    Unreadable counts as untouched. This only ever qualifies a worker whose pane has
    already reported zero context consumed, and an agent that has taken no turn has
    committed nothing — so the git answer can only ever exonerate, never accuse.
    """
    base = (get_entry(worktree) or {}).get("base_sha")
    if not base:
        return True
    return head_sha(worktree) in (None, base)


def work_in_progress(worktree: Path, base_sha: str | None = None) -> dict:
    """What this worker is holding that no other checkout has: uncommitted paths, and
    commits made since it was created.

    The pair is the difference between a worker that is finished and one whose work
    exists nowhere but its own tree — the single state where reaping it destroys work,
    and the one the fleet board could not previously show. ``base_sha`` defaults to the
    commit the registry recorded at creation.

    Untracked files count: a harness a worker wrote and never added is exactly the work
    at risk. Ignored files do not — `.venv` is not work.

    Either figure is ``None`` when git could not answer. `0` is the "nothing at stake"
    reading, so a question that failed must never borrow it.
    """
    if base_sha is None:
        base_sha = (get_entry(worktree) or {}).get("base_sha")
    return {"dirty": _dirty_count(worktree), "commits": _commits_since(worktree, base_sha)}


def _dirty_count(worktree: Path) -> int | None:
    r = subprocess.run(
        ["git", "-C", str(worktree), "status", "--porcelain"],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )
    return len([ln for ln in r.stdout.splitlines() if ln.strip()]) if r.returncode == 0 else None


def _commits_since(worktree: Path, base_sha: str | None) -> int | None:
    if not base_sha:
        return None
    r = subprocess.run(
        ["git", "-C", str(worktree), "rev-list", "--count", f"{base_sha}..HEAD"],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        return int(r.stdout.strip()) if r.returncode == 0 else None
    except ValueError:
        return None


def get_entry(path: Path) -> dict | None:
    return get_worktrees_db().get(Query().path == _key(path))


def remove_entry(path: Path) -> None:
    get_worktrees_db().remove(Query().path == _key(path))


def all_entries() -> list[dict]:
    return get_worktrees_db().all()


def _live_session_for(
    worktree: Path, live_sessions: dict[str, dict]
) -> tuple[str | None, str | None]:
    target = _key(worktree)
    for name, meta in live_sessions.items():
        wd = meta.get("workdir")
        if wd and str(Path(wd).resolve()) == target:
            return name, (meta.get("agent_provider") or DEFAULT_PROVIDER)
    return None, None


def reconcile(repo: Path, live_sessions: dict[str, dict]) -> list[dict]:
    git_worktrees = {_key(Path(wt.path)): wt for wt in list_worktrees(repo)}

    for row in all_entries():
        if row["parent_repo"] == _key(repo) and row["path"] not in git_worktrees:
            remove_entry(Path(row["path"]))

    rows: list[dict] = []
    for key, wt in git_worktrees.items():
        if _key(repo) == key:
            continue
        entry = get_entry(Path(wt.path)) or {}
        session, agent = _live_session_for(Path(wt.path), live_sessions)
        rows.append(
            {
                "path": key,
                "repo": repo.name,
                # The full path too: a leaf name is ambiguous across checkouts of the
                # same project, and an orphan's whole problem is that nothing else on
                # its row says where it came from.
                "parent_repo": _key(repo),
                "branch": wt.branch or entry.get("branch"),
                "session": session,
                "agent": agent,
                "task_intent": entry.get("task_intent"),
                "state": "active" if session else "orphan",
            }
        )
    return rows


def reconcile_all(live_sessions: dict[str, dict]) -> list[dict]:
    repos = {Path(row["parent_repo"]) for row in all_entries()}
    rows: list[dict] = []
    for repo in repos:
        rows.extend(reconcile(repo, live_sessions))
    return rows


def create(
    repo: Path,
    branch: str,
    *,
    created_at: str,
    create_branch: bool = False,
    base_branch: str | None = None,
    session: str | None = None,
    task_intent: str | None = None,
    global_base_dir: str | None = None,
    kind: str | None = None,
    origin: str | None = None,
    target: str | None = None,
    run: str | None = None,
    brief_path: str | None = None,
    delivery: str | None = None,
) -> dict:
    cfg = parse_worktree_config(repo)
    dest = resolve_worktree_dir(repo, branch, cfg, global_base_dir)
    # The name the caller gave is not a commit: a local branch left behind by a pushed
    # land points somewhere staler than what everyone means by that name. Resolve it,
    # and hand the resolution back so the caller can say what it branched from.
    base = resolve_spawn_base(repo, base_branch) if create_branch and base_branch else {}
    result = _git_create_worktree(
        repo,
        branch,
        worktree_path=dest,
        create_branch=create_branch,
        base_branch=base.get("ref") or base_branch,
    )
    if "error" in result:
        return result
    wt = Path(result["path"])
    applied = apply_links(repo, wt, plan_links(repo, wt, cfg))
    for cmd in cfg.post_create:
        subprocess.run(cmd, shell=True, cwd=wt, check=False)  # noqa: S602 - project-configured hook command
    record_worktree(
        wt,
        repo,
        branch,
        created_at,
        session=session,
        links_applied=applied,
        task_intent=task_intent,
        kind=kind,
        origin=origin,
        target=target,
        run=run,
        base_branch=base_branch,
        base_sha=head_sha(wt),
        brief_path=brief_path,
        delivery=delivery,
    )
    return {"path": str(wt), "links_applied": applied, "base": base or None}


REAP_BLOCKERS = {
    "dirty": "worktree has uncommitted changes",
    "unlanded": "worktree has commits that are in no base branch and on no remote",
    "unknown": "cannot determine whether this worktree's commits landed",
}


def reap_readiness(worktree: Path, *, caller_pid: int | None = None) -> dict:
    """What reaping this worktree would cost, computed without touching it — the whole
    verdict `lb teardown --dry-run` reports and the one `reap` decides on.

    ``blocker`` is what an un-forced reap refuses on, named so the operator can tell a
    genuinely unlanded worker from one whose landed-ness could not be established.
    ``--force`` suppresses the refusal, never the facts alongside it.
    """
    if not worktree.exists():
        # Nothing on disk left to lose; reaping only converges the registry.
        return {"landed": None, "commits": None, "blocker": None, "processes": []}
    entry = get_entry(worktree)
    state = head_landed_state(worktree, entry.get("base_branch") if entry else None)
    if get_porcelain_status(worktree):
        blocker = "dirty"
    elif state["landed"] is None:
        blocker = "unknown"
    elif not state["landed"] and state["commits"]:
        blocker = "unlanded"
    else:
        # Landed, or a scout that committed nothing — either way nothing is lost.
        blocker = None
    return {
        "landed": state["landed"],
        "commits": state["commits"],
        "blocker": blocker,
        # Reported, never a blocker: leftovers are the reaper's to clean up, not a
        # reason to leave the worktree standing.
        "processes": processes_under(worktree, protect=_protected(caller_pid)),
    }


def _protected(caller_pid: int | None) -> tuple[int, ...]:
    return (caller_pid,) if caller_pid else ()


def reap(
    worktree: Path, *, force: bool = False, rm_branch: bool = False, caller_pid: int | None = None
) -> dict:
    # Answer "did this work land?" up front and report it on every path: a forced reap
    # still owes the caller that flag, because a torn-down-but-unlanded worker is the
    # one whose tracking issue has to go back on the board (nothing here knows or
    # cares what a board is — it only exposes the fact).
    readiness = reap_readiness(worktree, caller_pid=caller_pid)
    landed, commits = readiness["landed"], readiness["commits"]
    if not force and readiness["blocker"]:
        return {
            "error": REAP_BLOCKERS[readiness["blocker"]],
            "reason": readiness["blocker"],
            "landed": landed,
            "commits": commits,
        }
    entry = get_entry(worktree)
    parent = Path(entry["parent_repo"]) if entry else parent_repo_of(worktree)
    # Ask the tree itself when the registry has nothing: an orphan adopted by hand is
    # exactly the worktree whose leftover branch nobody is tracking.
    branch = (entry.get("branch") if entry else None) or _head_branch(worktree)
    # Anything the worker left running here (a test server, most often) outlives the
    # tree otherwise: still holding its port and its shared-DB connection, running
    # code that no longer exists on disk. Kill it before the tree goes, and say so.
    processes_killed = kill_processes_under(worktree, protect=_protected(caller_pid))
    result = _git_remove_worktree(parent, worktree, force=force)
    if "error" in result:
        # The one benign failure is "nothing left to remove": the worktree — and
        # sometimes its whole parent repo — is already gone from disk (an lb teardown
        # reaped it, or it was deleted by hand). Converge to removed and drop the stale
        # registry entry rather than leaving an un-reapable ghost behind.
        if not worktree.exists():
            remove_entry(worktree)
            return {
                "status": "removed",
                "path": str(worktree),
                "landed": landed,
                "commits": commits,
                "processes_killed": processes_killed,
                "note": "already absent",
            }
        return {**result, "processes_killed": processes_killed}
    remove_entry(worktree)
    return {
        "status": "removed",
        "path": str(worktree),
        "landed": landed,
        "commits": commits,
        "processes_killed": processes_killed,
        "branch_removed": _clear_branch(parent, branch, landed=landed, force=rm_branch),
    }


def _head_branch(worktree: Path) -> str | None:
    name = subprocess.run(
        ["git", "-C", str(worktree), "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True,
        text=True,
    ).stdout.strip()
    return name if name and name != "HEAD" else None


def _clear_branch(
    parent: Path, branch: str | None, *, landed: bool | None, force: bool
) -> str | None:
    """Take the branch with the worktree when nothing is left riding on it.

    A reaped worker's branch used to outlive both its tree and its registry row, so the
    registry would call the name free while git still refused to create it — the next
    todo slugging to that name could not be launched at all.

    ``-d`` is the whole safety argument: git itself refuses to delete a branch holding
    commits that reached nothing else, so an un-landed worker keeps its only remaining
    record.  ``-D`` needs a reason beyond a caller's optimism — either an explicit
    ``rm_branch``, or a reap that *proved* the content landed (a cherry-picked or
    rebased land leaves the original commits on no ancestor path, which ``-d`` cannot
    see and would refuse over).
    """
    if not branch:
        return None
    for flag in ("-d", "-D") if (force or landed) else ("-d",):
        try:
            get_repo(parent).git.branch(flag, branch)
            return branch
        except GitCommandError:
            continue
    return None


def parent_repo_of(worktree: Path) -> Path:
    common = subprocess.run(
        ["git", "-C", str(worktree), "rev-parse", "--git-common-dir"],
        capture_output=True,
        text=True,
    ).stdout.strip()
    git_dir = Path(common)
    if not git_dir.is_absolute():
        git_dir = (worktree / git_dir).resolve()
    return git_dir.parent


def adopt(worktree: Path, created_at: str, session: str | None) -> dict:
    repo = parent_repo_of(worktree)
    branch = subprocess.run(
        ["git", "-C", str(worktree), "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True,
        text=True,
    ).stdout.strip()
    row = record_worktree(worktree, repo, branch, created_at, session=session)
    return {"status": "adopted", **row}


def unlink_path(worktree: Path, rel: str) -> dict:
    target = worktree / rel
    if not target.is_symlink():
        # Nothing to break: copied deps (the default) are already the worktree's own.
        return {"path": rel, "status": "skipped", "reason": "already owned by the worktree"}
    real = target.resolve()
    target.unlink()
    _reflink_copy(real, target)
    return {"path": rel, "status": "copied"}
