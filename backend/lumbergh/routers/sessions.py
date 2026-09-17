"""
Sessions router - CRUD for tmux sessions and session-scoped git operations.
Stores metadata in ~/.config/lumbergh/sessions.json
"""

import asyncio
import logging
import re
import shlex
import shutil
import subprocess
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from pathlib import Path
from typing import TypeVar

import libtmux
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from tinydb import Query

from lumbergh import quick_worktree, session_attention, todo_spawn, worktrees
from lumbergh.bill_nudge import BILL_SESSION
from lumbergh.constants import IGNORE_DIRS, REPO_SEARCH_SKIP_DIRS, SCRATCH_DIR, TMUX_CMD
from lumbergh.db_utils import (
    get_project_db,
    get_session_data_db,
    get_sessions_db,
    get_single_document_items,
    get_single_document_value,
    save_single_document_items,
    save_single_document_value,
)
from lumbergh.file_utils import get_file_language, list_directory, validate_path_within_root
from lumbergh.git_identity import graph_identity
from lumbergh.git_utils import (
    amend_commit,
    checkout_branch,
    create_branch_at,
    delete_branch,
    delete_tag,
    get_branches,
    get_branches_for_worktree,
    get_commit_diff,
    get_commit_log,
    get_current_branch,
    get_full_diff_with_untracked,
    get_graph_log,
    get_porcelain_status,
    get_range_diff,
    get_reflog,
    get_remote_status,
    git_cherry_pick,
    git_fast_forward,
    git_force_push,
    git_pull_rebase,
    git_push,
    git_rebase_onto,
    git_stash,
    git_stash_drop,
    git_stash_pop,
    list_remote_tags,
    reset_to_commit,
    reset_to_head,
    revert_file,
    reword_commit,
    search_commits,
    stage_all_and_commit,
)
from lumbergh.graph_delta import build_response
from lumbergh.idle_detector import SessionState
from lumbergh.models import (
    AmendInput,
    BranchTargetInput,
    CheckoutInput,
    CherryPickInput,
    CommitInput,
    CreateBranchInput,
    CreateSessionRequest,
    DeleteBranchInput,
    DeleteTagInput,
    PromptTemplateList,
    QuickWorktreeRequest,
    ResetToInput,
    RevertFileInput,
    RewordInput,
    ScratchpadContent,
    SessionUpdate,
    StatusSummaryInput,
    TodoList,
    TodoMoveRequest,
    WorktreeConfig,
)
from lumbergh.providers import get_launch_command
from lumbergh.tmux_pty import IS_WINDOWS

logger = logging.getLogger(__name__)

T = TypeVar("T")

GIT_READ_TIMEOUT = 10  # seconds — status, diff, log, branches
GIT_WRITE_TIMEOUT = 30  # seconds — push, pull, rebase, commit

# Auto-cleanup gating: only check stale scratch sessions once per hour
_last_scratch_cleanup: float = 0.0
_last_dead_reap: float = 0.0


async def _run_git(fn: Callable[..., T], *args, timeout: float = GIT_READ_TIMEOUT, **kwargs) -> T:
    """Run a blocking git function in a thread with a timeout.

    Prevents a hung git process (bad config, credential prompt, lock file)
    from blocking the event loop and starving WebSocket connections.
    """
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(fn, *args, **kwargs),
            timeout=timeout,
        )
    except TimeoutError:
        raise HTTPException(
            status_code=504,
            detail=f"Git operation timed out after {timeout}s — is git configured correctly?",
        )


router = APIRouter(prefix="/api/sessions", tags=["sessions"])
directories_router = APIRouter(prefix="/api/directories", tags=["directories"])

# Database setup
db = get_sessions_db()
sessions_table = db.table("sessions")

# Session name pattern
SESSION_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


def find_git_repos(base_dir: Path, query: str = "", limit: int = 20) -> list[dict]:
    """Find git repositories under base_dir matching the query."""
    results: list[dict] = []
    query_lower = query.lower()

    def should_skip(name: str) -> bool:
        return name.startswith(".") or name in REPO_SEARCH_SKIP_DIRS

    def search_dir(directory: Path, depth: int = 0):
        if depth > 3 or len(results) >= limit:
            return

        try:
            for entry in directory.iterdir():
                if len(results) >= limit:
                    return
                if not entry.is_dir() or should_skip(entry.name):
                    continue

                if (entry / ".git").is_dir():
                    if query_lower in entry.name.lower():
                        results.append(
                            {
                                "path": str(entry),
                                "name": entry.name,
                            }
                        )
                else:
                    search_dir(entry, depth + 1)
        except PermissionError:
            pass

    search_dir(base_dir)
    return sorted(results, key=lambda x: x["name"].lower())


def find_venv_activate(workdir: Path) -> Path | None:
    """Find venv activate script in common locations."""
    candidates = [
        workdir / ".venv" / "bin" / "activate",
        workdir / "backend" / ".venv" / "bin" / "activate",
    ]
    for path in candidates:
        if path.exists():
            return path
    return None


def _start_agent_in_target(target: str, workdir: Path, launch_command: str) -> None:
    """Correlate a tmux target to its Lumbergh identity, activate a venv if found, and launch the agent.

    Args:
        target: tmux target to send keys to — a session name or a `session:window` pane.
        workdir: Working directory for the session/window (used to locate a venv).
        launch_command: Shell command to start the agent.
    """
    # Correlate this pane to its Lumbergh session for the SessionStart hook.
    subprocess.run(
        [
            TMUX_CMD,
            "send-keys",
            "-t",
            target,
            f"export LUMBERGH_SESSION={shlex.quote(target)}",
            "Enter",
        ],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )

    # Activate venv if found
    venv_activate = find_venv_activate(workdir)
    if venv_activate:
        subprocess.run(
            [TMUX_CMD, "send-keys", "-t", target, f"source {venv_activate}", "Enter"],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
        )

    # Start the agent
    subprocess.run(
        [TMUX_CMD, "send-keys", "-t", target, launch_command, "Enter"],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )


def create_tmux_session(
    name: str, workdir: Path, launch_command: str = "claude --continue || claude"
) -> None:
    """Create a tmux session with optional venv activation and agent start.

    Args:
        name: Session name
        workdir: Working directory for the session
        launch_command: Shell command to start the agent

    Raises:
        RuntimeError: If tmux session creation fails
    """
    result = subprocess.run(
        [TMUX_CMD, "new-session", "-d", "-s", name, "-c", str(workdir)],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to create session: {result.stderr}")

    _start_agent_in_target(name, workdir, launch_command)


def create_tmux_window(
    session: str, window: str, workdir: Path, launch_command: str = "claude --continue || claude"
) -> str:
    """Create a worker in a tmux window, auto-creating the session if it doesn't exist yet.

    Args:
        session: tmux session name to hold the window (created if absent)
        window: window name to create within the session
        workdir: Working directory for the window
        launch_command: Shell command to start the agent

    Returns:
        The full tmux target, `session:window`.

    Raises:
        RuntimeError: If tmux session/window creation fails
    """
    from lumbergh.tmux_pty import list_tmux_sessions

    live = {s["name"] for s in list_tmux_sessions()}
    if session not in live:
        result = subprocess.run(
            [TMUX_CMD, "new-session", "-d", "-s", session, "-n", window, "-c", str(workdir)],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
        )
    else:
        result = subprocess.run(
            [TMUX_CMD, "new-window", "-t", session, "-n", window, "-c", str(workdir)],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
        )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to create window {session}:{window}: {result.stderr}")

    target = f"{session}:{window}"
    _start_agent_in_target(target, workdir, launch_command)
    return target


@directories_router.get("/validate")
async def validate_directory(path: str):
    """Check if a directory path exists."""
    p = Path(path).expanduser().resolve()
    return {"exists": p.is_dir(), "path": str(p)}


@directories_router.get("/search")
async def search_directories(query: str = ""):
    """Search for git repositories in the configured search directory."""
    from lumbergh.routers.settings import get_settings

    settings = get_settings()
    base_dir = Path(settings.get("repoSearchDir", str(Path.home() / "src")))
    if not base_dir.exists():
        return {"directories": []}

    directories = find_git_repos(base_dir, query, limit=20)
    return {"directories": directories}


def get_tmux_server() -> libtmux.Server:
    """Get the tmux server instance."""
    return libtmux.Server(tmux_bin=TMUX_CMD)


def _get_live_sessions_psmux_fallback() -> dict[str, dict]:
    """Parse `psmux list-sessions` text output (Windows path).

    libtmux's `-F` format flags don't always work against psmux, so when
    libtmux returns nothing on Windows we fall back to plain text parsing.
    """
    try:
        result = subprocess.run(
            [TMUX_CMD, "list-sessions"],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if result.returncode != 0:
            return {}
        sessions: dict[str, dict] = {}
        # Default format: "name: N windows (created ...)"
        pattern = re.compile(r"^([^:]+):\s+(\d+)\s+windows")
        for line in result.stdout.splitlines():
            match = pattern.match(line)
            if match:
                name = match.group(1)
                windows = int(match.group(2))
                sessions[name] = {
                    "name": name,
                    "id": f"${len(sessions)}",  # synthetic id
                    "windows": windows,
                    "attached": False,
                    "alive": True,
                }
        return sessions
    except Exception:
        return {}


def get_live_sessions() -> dict[str, dict]:
    """Get live tmux sessions as a dict keyed by name."""
    try:
        server = get_tmux_server()
        sessions_list = list(server.sessions)
        if not sessions_list and IS_WINDOWS:
            # libtmux can return [] under psmux even when sessions exist.
            return _get_live_sessions_psmux_fallback()
        return {
            s.name: {
                "name": s.name,
                "id": s.id,
                "windows": len(s.windows),
                "attached": bool(s.session_attached),
                "alive": True,
            }
            for s in sessions_list
            if s.name is not None
        }
    except Exception:
        if IS_WINDOWS:
            return _get_live_sessions_psmux_fallback()
        return {}


def get_stored_sessions() -> dict[str, dict]:
    """Get stored session metadata as a dict keyed by name."""
    all_sessions = sessions_table.all()
    return {s["name"]: s for s in all_sessions}


# Worst-first: a container is only as calm as its most demanding worker, and it
# stays "working" until every last window has stopped.
_WINDOW_STATE_SEVERITY = ("error", "blocked", "working", "idle")


def _window_worker_state(name: str) -> tuple[str | None, str | None]:
    """The idle state of ``name``'s registered window workers, rolled up.

    A batch container has no agent of its own, so the idle monitor only ever
    writes rows keyed ``session:window`` and the bare-name DB stays empty.  Read
    only that DB and the container reports no state at all, which the dashboard
    cannot tell apart from a healthy session.
    """
    from lumbergh import db_utils

    prefix = f"{name}:"
    rows = []
    try:
        entries = sorted(db_utils.SESSIONS_DATA_DIR.iterdir())
    except OSError:
        return None, None
    for path in entries:
        if path.suffix != ".json" or not path.stem.startswith(prefix):
            continue
        try:
            docs = get_session_data_db(path.stem).table("idle_state").all()
        except Exception:  # noqa: S112 - a corrupt worker DB must not blank the container
            continue
        if docs:
            rows.append(docs[0])

    for state in _WINDOW_STATE_SEVERITY:
        matching = [row for row in rows if row.get("state") == state]
        if matching:
            newest = max(matching, key=lambda row: row.get("updatedAt") or "")
            return state, newest.get("updatedAt")
    return None, None


def _live_monitor_state(name: str) -> tuple[str, str] | None:
    """What the monitor sees right now, for a session it is actually watching.

    The persisted row is written only on a state *transition*, so a single bad
    write pins a quiet session at whatever it last said — no later poll corrects
    it, because from the monitor's point of view nothing changed. Ask the monitor
    itself while it is watching; the row is for sessions it no longer is.
    """
    from lumbergh.idle_monitor import idle_monitor

    if name not in idle_monitor.live_targets():
        return None
    state = idle_monitor.get_state(name)
    if state is SessionState.UNKNOWN:
        # Not judged yet, which is not the same as nothing happening.
        return None
    since = idle_monitor.state_since_seconds(name) or 0.0
    started = datetime.now(tz=UTC) - timedelta(seconds=since)
    return state.value, started.isoformat()


def get_session_status(name: str) -> dict:
    """Get status info for a session from its data DB."""
    from lumbergh.idle_monitor import idle_monitor

    result = {
        "status": None,
        "statusUpdatedAt": None,
        "idleState": None,
        "idleStateUpdatedAt": None,
        "unseen": session_attention.is_unseen(name),
        "attentionState": session_attention.get(name),
        "needsAnswer": idle_monitor.needs_answer(name),
        "needsAnswerReason": idle_monitor.needs_answer_reason(name),
    }
    try:
        session_db = get_session_data_db(name)

        # Get AI-generated status summary
        status_table = session_db.table("status")
        all_docs = status_table.all()
        if all_docs:
            result["status"] = all_docs[0].get("status")
            result["statusUpdatedAt"] = all_docs[0].get("statusUpdatedAt")

        # Get idle detection state
        idle_state_table = session_db.table("idle_state")
        idle_docs = idle_state_table.all()
        if idle_docs:
            result["idleState"] = idle_docs[0].get("state")
            result["idleStateUpdatedAt"] = idle_docs[0].get("updatedAt")
    except Exception:  # noqa: S110 - idle state is optional metadata
        pass
    live = _live_monitor_state(name)
    if live is not None:
        result["idleState"], result["idleStateUpdatedAt"] = live
    if result["idleState"] is None:
        result["idleState"], result["idleStateUpdatedAt"] = _window_worker_state(name)
    return result


def _remove_scratch_session(name: str, meta: dict, live: dict) -> None:
    """Remove a single scratch session: kill tmux, delete dir, remove from DB."""
    if name in live:
        subprocess.run(
            [TMUX_CMD, "kill-session", "-t", name],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
        )
    workdir = meta.get("workdir")
    if workdir:
        scratch_path = Path(workdir)
        if scratch_path.is_relative_to(SCRATCH_DIR) and scratch_path.exists():
            shutil.rmtree(scratch_path, ignore_errors=True)
    sessions_table.remove(Query().name == name)


def _cleanup_stale_scratch() -> None:
    """Remove scratch sessions older than the configured max age."""
    global _last_scratch_cleanup
    now = time.time()
    if now - _last_scratch_cleanup < 3600:
        return
    _last_scratch_cleanup = now

    from lumbergh.routers.settings import get_settings

    max_days = get_settings().get("scratchMaxAgeDays", 7)
    if max_days <= 0:
        return

    from datetime import UTC, datetime

    cutoff_ts = datetime.now(UTC).timestamp() - max_days * 86400
    stored = get_stored_sessions()
    live = get_live_sessions()

    for name, meta in stored.items():
        if meta.get("type") != "scratch":
            continue
        last_used = meta.get("lastUsedAt")
        if last_used:
            try:
                session_ts = datetime.fromisoformat(last_used).timestamp()
            except (ValueError, TypeError):
                continue
        else:
            session_ts = 0
        if session_ts < cutoff_ts:
            _remove_scratch_session(name, meta, live)


def _is_dead_worktree_orphan(name: str, meta: dict, live_names: set[str]) -> bool:
    """True when a stored session is a spent worker/run record safe to drop.

    Teardown (and a crash, or a force-kill) leaves the stored session record behind
    even though its tmux session is gone and its worktree has been reaped — so dead
    worktree sessions accumulate in the list. One is reapable only when it is *not*
    live AND its workdir no longer exists AND it is worktree-ish (a `worktree`-type
    session, or one living under a repo's `-worktrees/` container — which is every
    worker and batch-container session). A durable direct session on a real repo is
    never touched, and a plain repo path that is merely missing is left alone in case
    the repo is only transiently unmounted.
    """
    if name in live_names:
        return False
    workdir = meta.get("workdir")
    if not workdir:
        return False
    worktreeish = meta.get("type") == "worktree" or "-worktrees/" in f"{workdir}/"
    return worktreeish and not Path(workdir).exists()


def _reap_dead_worktree_sessions() -> None:
    """Drop stored records for torn-down/crashed workers whose worktree is gone."""
    global _last_dead_reap
    now = time.time()
    if now - _last_dead_reap < 60:
        return
    _last_dead_reap = now

    live_names = set(get_live_sessions())
    for name, meta in get_stored_sessions().items():
        if _is_dead_worktree_orphan(name, meta, live_names):
            sessions_table.remove(Query().name == name)


def _resolved_path(path: str | None) -> str | None:
    if not path:
        return None
    try:
        return str(Path(path).resolve())
    except (OSError, ValueError):
        return path


def _annotate_hierarchy(sessions: list[dict]) -> None:
    """Set ``role`` and ``parent`` on each session row, in place.

    ``role`` is ``bill`` for Bill, ``worker`` for a worktree-backed sub-session, and
    ``session`` otherwise. A worker's ``parent`` is the name of the session whose working
    directory is the worker's parent repo — the same resolved-repo-path match ``fleet``
    uses to nest a worker under its overseer. Everything is derived from the rows already
    built here: no subprocess and no transcript read, so it stays cheap enough for the
    dashboard's poll (unlike ``fleet.snapshot``, which reads worker transcripts). A worker
    whose repo has no live session gets ``parent: None`` and surfaces as a top-level card.

    "Overseer" is deliberately not a role: a session is presented as one only because a
    worker points at it, which the frontend derives from ``parent``.
    """
    overseer_by_path: dict[str, str] = {}
    for s in sessions:
        # Dead sessions linger in the list with the workdir they used to run in. One of
        # those must never claim the repo: it would outrank the session actually running
        # there and hand every worker a parent that exited days ago. A row that never
        # says (the hierarchy tests, and any caller building rows by hand) counts as live.
        if s.get("type") != "worktree" and s.get("alive", True):
            resolved = _resolved_path(s.get("workdir"))
            if resolved:
                overseer_by_path[resolved] = s["name"]
    for s in sessions:
        if s["name"] == BILL_SESSION:
            s["role"] = "bill"
        elif s.get("type") == "worktree":
            s["role"] = "worker"
        else:
            s["role"] = "session"
        parent_key = _resolved_path(s.get("worktreeParentRepo")) if s["role"] == "worker" else None
        s["parent"] = overseer_by_path.get(parent_key) if parent_key else None


@router.get("")
async def list_sessions():
    """List all sessions (merge TinyDB metadata + live tmux state)."""
    _cleanup_stale_scratch()
    _reap_dead_worktree_sessions()
    live = get_live_sessions()
    stored = get_stored_sessions()
    # Sessions come and go; their attention flags used to stay behind forever.
    session_attention.forget_missing(set(live))

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
                "unseen": status_info.get("unseen", False),
                "attentionState": status_info.get("attentionState"),
                "needsAnswer": status_info.get("needsAnswer", False),
                "needsAnswerReason": status_info.get("needsAnswerReason"),
                "type": meta.get("type", "direct"),
                "worktreeParentRepo": meta.get("worktree_parent_repo"),
                "worktreeBranch": meta.get("worktree_branch"),
                "lastUsedAt": meta.get("lastUsedAt"),
                "paused": meta.get("paused", False),
                "agentProvider": meta.get("agent_provider"),
                "tabVisibility": meta.get("tab_visibility"),
                "cloudEnabled": meta.get("cloud_enabled", False),
                "theOne": meta.get("the_one", False),
                "scratch": meta.get("type") == "scratch",
            }
        )

    # Include orphan tmux sessions (created outside Lumbergh)
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
                    "unseen": status_info.get("unseen", False),
                    "attentionState": status_info.get("attentionState"),
                    "needsAnswer": status_info.get("needsAnswer", False),
                    "needsAnswerReason": status_info.get("needsAnswerReason"),
                    "type": "direct",
                    "worktreeParentRepo": None,
                    "worktreeBranch": None,
                    "lastUsedAt": None,
                    "paused": False,
                    "agentProvider": None,
                    "tabVisibility": None,
                    "theOne": False,
                }
            )

    _annotate_hierarchy(sessions)
    return {"sessions": sessions}


@router.post("/{name}/touch")
async def touch_session(name: str):
    """Update lastUsedAt timestamp for a session."""
    from datetime import UTC, datetime

    session_q = Query()
    doc = sessions_table.get(session_q.name == name)
    record: dict = dict(doc) if isinstance(doc, dict) else {}

    if not record:
        # Check if it's an orphan tmux session
        live = get_live_sessions()
        if name not in live:
            raise HTTPException(status_code=404, detail=f"Session '{name}' not found")
        record = {"name": name}

    record["lastUsedAt"] = datetime.now(UTC).isoformat()
    sessions_table.upsert(record, session_q.name == name)

    # Opening a session is seeing it. The terminal socket says the same thing for
    # a live session, but a dead one has no socket — and its "done while you were
    # away" would otherwise stand forever.
    session_attention.clear_session(name)

    return {"ok": True}


def _apply_session_updates(record: dict, body: SessionUpdate) -> None:
    """Apply non-None fields from the update body to the record."""
    field_map = {
        "displayName": "displayName",
        "description": "description",
        "paused": "paused",
        "agentProvider": "agent_provider",
        "tabVisibility": "tab_visibility",
        "cloudEnabled": "cloud_enabled",
        "theOne": "the_one",
    }
    for attr, key in field_map.items():
        value = getattr(body, attr)
        if value is not None:
            record[key] = value

    # Promotion: update workdir and clear scratch type
    if body.workdir is not None:
        workdir = Path(body.workdir).expanduser().resolve()
        if not workdir.is_dir():
            raise HTTPException(status_code=400, detail=f"Directory does not exist: {body.workdir}")
        record["workdir"] = str(workdir)
    if body.scratch is False:
        record["type"] = "direct"


@router.patch("/{name}")
async def update_session(name: str, body: SessionUpdate):
    """Update session metadata (e.g., displayName)."""
    session_q = Query()
    doc = sessions_table.get(session_q.name == name)
    record: dict = dict(doc) if isinstance(doc, dict) else {}

    if not record:
        # Check if it's an orphan tmux session
        live = get_live_sessions()
        if name not in live:
            raise HTTPException(status_code=404, detail=f"Session '{name}' not found")
        # Create a new record for the orphan session
        record = {"name": name}

    _apply_session_updates(record, body)

    sessions_table.upsert(record, session_q.name == name)

    # Notify cloud tunnel if cloud state changed
    if body.cloudEnabled is not None:
        from lumbergh.tunnel import cloud_tunnel

        cloud_tunnel.notify_session_change()

    return record


def _resolve_worktree_workdir(body: CreateSessionRequest) -> tuple[Path, str, str]:
    """Validate worktree config and create the worktree.

    Returns (workdir, parent_repo_str, branch).
    Raises HTTPException on validation failure.
    """
    if not body.worktree:
        raise HTTPException(status_code=400, detail="Worktree config required for worktree mode")

    parent_repo = Path(body.worktree.parent_repo).expanduser().resolve()
    if not parent_repo.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Parent repository does not exist: {body.worktree.parent_repo}",
        )
    if not (parent_repo / ".git").exists() and not (parent_repo / ".git").is_file():
        raise HTTPException(
            status_code=400, detail=f"Not a git repository: {body.worktree.parent_repo}"
        )

    from lumbergh.routers.settings import get_settings

    base_dir = get_settings().get("worktree", {}).get("base_dir") or None
    result = worktrees.create(
        parent_repo,
        body.worktree.branch,
        created_at=datetime.now(UTC).isoformat(),
        create_branch=body.worktree.create_branch,
        base_branch=body.worktree.base_branch,
        session=body.name or None,
        global_base_dir=base_dir,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return Path(result["path"]), str(parent_repo), body.worktree.branch


def _init_repo(workdir: Path) -> None:
    """Create directory, git init, and make an initial commit."""
    workdir.mkdir(parents=True, exist_ok=True)
    (workdir / "README.md").write_text("")
    subprocess.run(["git", "init"], cwd=workdir, capture_output=True, check=True)
    subprocess.run(["git", "add", "README.md"], cwd=workdir, capture_output=True, check=True)
    # Try with user's git config first, fall back to defaults if not configured
    result = subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=workdir,
        capture_output=True,
    )
    if result.returncode != 0:
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=Lumbergh",
                "-c",
                "user.email=lumbergh@localhost",
                "commit",
                "-m",
                "Initial commit",
            ],
            cwd=workdir,
            capture_output=True,
            check=True,
        )


def _resolve_direct_workdir(body: CreateSessionRequest) -> Path:
    """Validate and resolve the working directory for direct mode.

    Raises HTTPException on validation failure.
    """
    if not body.workdir:
        raise HTTPException(status_code=400, detail="Working directory required for direct mode")

    workdir = Path(body.workdir).expanduser().resolve()
    if not workdir.exists():
        if body.init_repo:
            _init_repo(workdir)
        else:
            raise HTTPException(status_code=400, detail=f"Directory does not exist: {body.workdir}")
    if not workdir.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {body.workdir}")
    return workdir


def _fork_launch_command(body: CreateSessionRequest) -> str:
    """The launch command for a session forked off another one's conversation."""
    from lumbergh.fork import claude_session_id, fork_launch_command

    source = body.fork_from or ""
    stored = get_stored_sessions().get(source)
    if stored is None:
        raise HTTPException(status_code=404, detail=f"No session named '{source}' to fork")

    provider = body.agent_provider or stored.get("agent_provider")
    source_cwd = Path(stored["workdir"]) if stored.get("workdir") else None
    session_id = claude_session_id(source, source_cwd)
    command = fork_launch_command(provider, session_id)
    if command is None:
        raise HTTPException(
            status_code=400,
            detail=f"'{source}' has no conversation to fork yet, or its agent cannot fork one.",
        )
    return command


def _spawn_tmux_or_raise(body: CreateSessionRequest, workdir: Path) -> None:
    """Spawn the tmux session, mapping exceptions to meaningful HTTP errors."""
    launch_cmd = (
        _fork_launch_command(body)
        if body.fork_from
        else _resolve_launch_command(body.agent_provider)
    )
    try:
        create_tmux_session(body.name, workdir, launch_command=launch_cmd)
    except RuntimeError as e:
        raise HTTPException(status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail=str(e))
    except OSError as e:
        # e.g. EMFILE "Too many open files" when the backend has leaked fds
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE,
            detail=f"Failed to spawn tmux ({e.__class__.__name__}: {e}). "
            "The backend may have hit its file-descriptor limit; restart it and retry.",
        )


def _resolve_launch_command(agent_provider: str | None) -> str:
    """Resolve the agent launch command from provider + global settings."""
    from lumbergh.routers.settings import get_settings

    settings = get_settings()
    default_agent = settings.get("defaultAgent")
    return get_launch_command(agent_provider, default_agent)


@router.post("")
async def create_session(body: CreateSessionRequest):
    """Create a new tmux session."""

    # Auto-derive name from directory if not provided
    if not body.name and body.workdir:
        leaf = Path(body.workdir).expanduser().resolve().name
        body.name = re.sub(r"[^a-zA-Z0-9_-]", "-", leaf).strip("-") or "session"

    if not body.name or not SESSION_NAME_PATTERN.match(body.name):
        raise HTTPException(
            status_code=400,
            detail="Invalid session name. Use only letters, numbers, underscores, and hyphens.",
        )

    live = get_live_sessions()
    stored = get_stored_sessions()

    if body.name in live:
        raise HTTPException(status_code=409, detail=f"Session '{body.name}' already exists")

    session_type = body.mode
    worktree_parent_repo = None
    worktree_branch = None

    if body.mode == "worktree":
        workdir, worktree_parent_repo, worktree_branch = _resolve_worktree_workdir(body)
    else:
        workdir = _resolve_direct_workdir(body)

    # Check for existing session with same workdir
    workdir_str = str(workdir)

    for session_name, meta in stored.items():
        if meta.get("workdir") == workdir_str and session_name in live:
            # Session already exists for this workdir - return existing session info
            return {
                "existing": True,
                "name": session_name,
                "workdir": workdir_str,
                "description": meta.get("description", ""),
                "alive": True,
                "attached": live[session_name].get("attached", False),
                "windows": live[session_name].get("windows", 1),
                "type": meta.get("type", "direct"),
                "worktreeParentRepo": meta.get("worktree_parent_repo"),
                "worktreeBranch": meta.get("worktree_branch"),
            }

    _spawn_tmux_or_raise(body, workdir)

    session_q = Query()
    session_data: dict[str, object] = {
        "name": body.name,
        "workdir": str(workdir),
        "description": body.description,
        "type": session_type,
        "agent_provider": body.agent_provider,
        "tab_visibility": body.tab_visibility,
    }
    if worktree_parent_repo:
        session_data["worktree_parent_repo"] = worktree_parent_repo
    if worktree_branch:
        session_data["worktree_branch"] = worktree_branch

    sessions_table.upsert(session_data, session_q.name == body.name)

    live = get_live_sessions()
    live_info = live.get(body.name, {})

    # Notify cloud tunnel of session change
    from lumbergh.tunnel import cloud_tunnel

    cloud_tunnel.notify_session_change()

    return {
        "name": body.name,
        "workdir": str(workdir),
        "description": body.description,
        "alive": live_info.get("alive", True),
        "attached": live_info.get("attached", False),
        "windows": live_info.get("windows", 1),
        "type": session_type,
        "worktreeParentRepo": worktree_parent_repo,
        "worktreeBranch": worktree_branch,
    }


@router.post("/quick-worktree")
async def create_quick_worktree(body: QuickWorktreeRequest):
    """A worktree off this repo with the agent already running in it.

    The full create flow wants a branch, a session name and a description. This is
    the same worktree session with all three decided for you — for when you have a
    second thing to work on and no wish to interrupt the agent you are talking to.
    """
    repo = Path(body.parent_repo).expanduser().resolve()
    if not repo.is_dir():
        raise HTTPException(status_code=400, detail=f"Directory does not exist: {repo}")
    if not (repo / ".git").exists():
        raise HTTPException(status_code=400, detail=f"Not a git repository: {repo}")

    branch, name = quick_worktree.next_quick_name(
        quick_worktree.branch_names(repo),
        set(get_live_sessions()) | set(get_stored_sessions()),
    )
    return await create_session(
        CreateSessionRequest(
            name=name,
            mode="worktree",
            worktree=WorktreeConfig(parent_repo=str(repo), branch=branch, create_branch=True),
        )
    )


@router.post("/scratch")
async def create_scratch_session():
    """Create a one-click scratch session with no project directory."""
    name = f"scratch-{uuid.uuid4().hex[:8]}"
    workdir = SCRATCH_DIR / name
    _init_repo(workdir)

    launch_cmd = _resolve_launch_command(None)

    try:
        create_tmux_session(name, workdir, launch_command=launch_cmd)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    session_q = Query()
    sessions_table.upsert(
        {
            "name": name,
            "workdir": str(workdir),
            "description": "",
            "type": "scratch",
            "agent_provider": None,
            "tab_visibility": {
                "git": False,
                "files": False,
                "todos": False,
                "prompts": True,
                "shared": True,
            },
        },
        session_q.name == name,
    )

    from lumbergh.tunnel import cloud_tunnel

    cloud_tunnel.notify_session_change()

    live = get_live_sessions()
    live_info = live.get(name, {})

    return {
        "name": name,
        "workdir": str(workdir),
        "description": "",
        "alive": live_info.get("alive", True),
        "attached": live_info.get("attached", False),
        "windows": live_info.get("windows", 1),
        "type": "scratch",
    }


@router.post("/{name}/reset")
async def reset_session(name: str):
    """Reset a session: kill all windows and start fresh with venv + agent."""
    live = get_live_sessions()
    stored = get_stored_sessions()

    if name not in live:
        raise HTTPException(status_code=404, detail=f"Session '{name}' is not running")

    session_meta = stored.get(name, {})
    workdir_str = session_meta.get("workdir")

    if not workdir_str:
        raise HTTPException(status_code=400, detail=f"Session '{name}' has no workdir configured")

    workdir = Path(workdir_str)

    # Kill all windows in the session
    subprocess.run(
        [TMUX_CMD, "kill-window", "-t", f"{name}:", "-a"],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )
    # -a kills all windows except current, so also kill the remaining one
    # by respawning it instead
    subprocess.run(
        [TMUX_CMD, "respawn-window", "-t", f"{name}:", "-k", "-c", str(workdir)],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )

    launch_cmd = _resolve_launch_command(session_meta.get("agent_provider"))

    # Activate venv if found
    venv_activate = find_venv_activate(workdir)
    if venv_activate:
        subprocess.run(
            [TMUX_CMD, "send-keys", "-t", name, f"source {venv_activate}", "Enter"],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
        )

    # Start the agent
    subprocess.run(
        [TMUX_CMD, "send-keys", "-t", name, launch_cmd, "Enter"],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )

    return {
        "status": "reset",
        "name": name,
        "workdir": workdir_str,
        "venvActivated": venv_activate is not None,
    }


def _get_pane_pid(name: str) -> str:
    result = subprocess.run(
        [TMUX_CMD, "display-message", "-t", name, "-p", "#{pane_pid}"],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )
    return result.stdout.strip()


def _list_pane_children(pane_pid: str) -> list[dict]:
    """Return [{pid, command}] for direct children of the pane shell."""
    if not pane_pid:
        return []

    try:
        pid_int = int(pane_pid)
    except (ValueError, TypeError):
        return []

    if IS_WINDOWS:
        try:
            # Use PowerShell to find children of the shell process.
            # We validate pid_int above to prevent command injection.
            cmd = [
                "powershell",
                "-Command",
                f"Get-CimInstance Win32_Process -Filter 'ParentProcessId = {pid_int}' | "
                "Select-Object ProcessId, Caption | ConvertTo-Json",
            ]
            result = subprocess.run(
                cmd,
                capture_output=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            if result.returncode != 0 or not result.stdout.strip():
                return []

            import json

            try:
                data = json.loads(result.stdout)
            except json.JSONDecodeError:
                return []

            # PowerShell's ConvertTo-Json returns a dict for 1 item, list for 2+
            if isinstance(data, dict):
                data = [data]

            return [{"pid": item["ProcessId"], "command": item["Caption"]} for item in data]
        except Exception:
            return []

    result = subprocess.run(
        ["ps", "-o", "pid=,comm=", "--ppid", str(pid_int)],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )
    children: list[dict] = []
    for line in result.stdout.strip().splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[0].isdigit():
            children.append({"pid": int(parts[0]), "command": parts[1]})
    return children


_SHELL_COMMANDS = {"sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh"}


def _is_idle_shell(child: dict) -> bool:
    """True for an interactive shell sitting at its prompt with nothing running.

    Some shell startups fork a second login shell that parks in the pane for the
    life of the session, so every pane holds one of these next to the agent.
    Killing it costs the user nothing, and counting it would make the pause
    confirmation fire on every session.
    """
    command = child["command"].lstrip("-").removesuffix(".exe")
    if command not in _SHELL_COMMANDS:
        return False
    return not _list_pane_children(str(child["pid"]))


def _kill_pane_children(pane_pid: str) -> None:
    if not pane_pid:
        return

    try:
        pid_int = int(pane_pid)
    except (ValueError, TypeError):
        return

    if IS_WINDOWS:
        # On Windows, taskkill /T kills the entire process tree rooted at pid_int.
        # This is more efficient than manually walking the tree with Get-CimInstance.
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(pid_int)],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    else:
        subprocess.run(
            ["pkill", "-TERM", "-P", str(pid_int)],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )


@router.post("/{name}/pause")
async def pause_session(name: str, force: bool = False):
    """Pause a session by killing the agent process (and its MCP children).

    If the pane has more than one child process (e.g. extra shells the user
    started), responds 409 with the list of extras so the UI can confirm.
    Pass `?force=true` to skip the check.
    """
    live = get_live_sessions()

    if name not in live:
        raise HTTPException(status_code=404, detail=f"Session '{name}' is not running")

    shell_pid = _get_pane_pid(name)
    children = [c for c in _list_pane_children(shell_pid) if not _is_idle_shell(c)]

    if not force and len(children) > 1:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "extra_children",
                "message": "Pane has extra processes that will also be killed.",
                "children": children,
            },
        )

    _kill_pane_children(shell_pid)
    await asyncio.sleep(0.5)

    # Mark as paused in TinyDB
    session_q = Query()
    doc = sessions_table.get(session_q.name == name)
    record: dict = dict(doc) if isinstance(doc, dict) else {"name": name}
    record["paused"] = True
    sessions_table.upsert(record, session_q.name == name)

    return {"status": "paused", "name": name}


@router.post("/{name}/resume")
async def resume_session(name: str):
    """Resume a paused session by restarting the agent using its provider launch command.

    Any lingering child processes from the previous run are killed before the
    agent is relaunched — the user has already chosen to resume, so there's
    nothing to confirm.
    """
    live = get_live_sessions()
    stored = get_stored_sessions()

    session_meta = stored.get(name, {})
    if not session_meta:
        raise HTTPException(status_code=404, detail=f"Session '{name}' not found")

    workdir_str = session_meta.get("workdir")
    if not workdir_str:
        raise HTTPException(status_code=400, detail=f"Session '{name}' has no workdir configured")
    workdir = Path(workdir_str)

    launch_cmd = _resolve_launch_command(session_meta.get("agent_provider"))

    if name in live:
        shell_pid = _get_pane_pid(name)

        if shell_pid:
            _kill_pane_children(shell_pid)
            await asyncio.sleep(0.5)

        # Activate venv if found
        venv_activate = find_venv_activate(workdir)
        if venv_activate:
            subprocess.run(
                [TMUX_CMD, "send-keys", "-t", name, f"source {venv_activate}", "Enter"],
                capture_output=True,
                encoding="utf-8",
                errors="replace",
            )

        # Start the agent
        subprocess.run(
            [TMUX_CMD, "send-keys", "-t", name, launch_cmd, "Enter"],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
        )
    else:
        # Tmux session is dead — drop any cached PTY tied to the old tmux
        # instance, then recreate. Without the eviction, the next websocket
        # attach would reuse the stale PTY (closed master_fd) and silently
        # drop all keyboard input.
        from lumbergh.session_manager import session_manager

        await session_manager.evict(name)
        create_tmux_session(name, workdir, launch_cmd)

    # Mark as resumed in TinyDB
    session_q = Query()
    doc = sessions_table.get(session_q.name == name)
    record: dict = dict(doc) if isinstance(doc, dict) else {"name": name}
    record["paused"] = False
    sessions_table.upsert(record, session_q.name == name)

    return {"status": "resumed", "name": name}


@router.delete("/{name}")
async def delete_session(name: str, cleanup_worktree: bool = False):
    """Kill a tmux session and remove metadata.

    Args:
        name: Session name
        cleanup_worktree: If true and session is a worktree, also remove the worktree directory
    """
    live = get_live_sessions()
    stored = get_stored_sessions()

    # Get session metadata for worktree cleanup
    session_meta = stored.get(name, {})
    session_type = session_meta.get("type", "direct")
    worktree_parent_repo = session_meta.get("worktree_parent_repo")
    workdir = session_meta.get("workdir")

    # Kill the tmux session first
    if name in live:
        result = subprocess.run(
            [TMUX_CMD, "kill-session", "-t", name],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Failed to kill session: {result.stderr}")

    # Clean up worktree if requested. This is best-effort: removing the session
    # record is the primary job, so a failed reap must never leave the session
    # un-killable (the exact way lb-teardown orphans got stuck in the list).
    worktree_removed = False
    if cleanup_worktree and session_type == "worktree" and worktree_parent_repo and workdir:
        try:
            wt_result = worktrees.reap(Path(workdir), force=True)
            worktree_removed = wt_result.get("status") == "removed"
        except Exception:
            logger.exception(
                "Worktree cleanup failed for session %s; removing session record anyway", name
            )

    # Clean up scratch directory
    if session_type == "scratch" and workdir:
        scratch_path = Path(workdir)
        if scratch_path.is_relative_to(SCRATCH_DIR) and scratch_path.exists():
            shutil.rmtree(scratch_path, ignore_errors=True)

    session_q = Query()
    sessions_table.remove(session_q.name == name)

    # Notify cloud tunnel of session change
    from lumbergh.tunnel import cloud_tunnel

    cloud_tunnel.notify_session_change()

    return {
        "status": "deleted",
        "name": name,
        "worktreeRemoved": worktree_removed,
    }


# --- Session-scoped Git Endpoints ---


def get_session_workdir(name: str) -> Path:
    """Get the workdir for a session, raising 404 if not found.

    A recorded workdir that has since been deleted — a reaped worktree, a
    renamed checkout — is its own 404 with its own message. Letting it through
    turns every git call into a 500 whose only detail is a bare path, which the
    UI cannot turn into anything a person can act on.
    """
    stored = get_stored_sessions()
    if name in stored and stored[name].get("workdir"):
        workdir = Path(stored[name]["workdir"])
        if not workdir.is_dir():
            raise HTTPException(
                status_code=404,
                detail=f"This session's directory no longer exists: {workdir}",
            )
        return workdir

    try:
        result = subprocess.run(
            [TMUX_CMD, "display-message", "-t", name, "-p", "#{pane_current_path}"],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode == 0 and result.stdout.strip():
            path = Path(result.stdout.strip())
            # Persist so future calls skip the tmux subprocess
            session_q = Query()
            sessions_table.upsert({"name": name, "workdir": str(path)}, session_q.name == name)
            return path
    except Exception:  # noqa: S110 - fallthrough to 404
        pass

    raise HTTPException(status_code=404, detail=f"Session '{name}' not found or has no workdir")


def get_session_path_map() -> dict[str, str]:
    """Map each session's resolved workdir path to its name.

    Used to annotate git-graph worktrees with the owning session. Only the slow-moving
    path→name mapping lives here; live agent state is overlaid client-side.
    """
    result: dict[str, str] = {}
    for name, meta in get_stored_sessions().items():
        workdir = meta.get("workdir")
        if not workdir:
            continue
        try:
            result[str(Path(workdir).resolve())] = name
        except (OSError, ValueError):
            continue
    return result


@router.get("/{name}/git/status")
async def session_git_status(name: str):
    """Get git status for a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        branch = await _run_git(get_current_branch, workdir)
        files = await _run_git(get_porcelain_status, workdir)
        return {"branch": branch, "files": files, "clean": len(files) == 0}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/git/diff")
async def session_git_diff(name: str):
    """Get git diff for a session's workdir (served from background cache)."""
    from lumbergh.diff_cache import diff_cache

    diff_cache.mark_active(name)
    cached = diff_cache.get_diff(name)
    if cached is not None:
        return cached

    # Cache miss (first request before background loop runs) — compute inline
    workdir = get_session_workdir(name)
    try:
        return await _run_git(get_full_diff_with_untracked, workdir)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/invalidate")
async def session_git_invalidate(name: str):
    """Force-invalidate cached diff/graph data so the next GET gets fresh data."""
    from lumbergh.diff_cache import diff_cache

    diff_cache.invalidate(name)
    return {"ok": True}


@router.get("/{name}/git/diff-stats")
async def session_git_diff_stats(name: str):
    """Get lightweight diff stats (file count + additions/deletions) from cache."""
    from lumbergh.diff_cache import diff_cache

    diff_cache.mark_active(name)
    stats = diff_cache.get_stats(name)

    if stats is not None:
        return stats

    return {"files": 0, "additions": 0, "deletions": 0}


@router.get("/{name}/git/graph")
async def session_git_graph(
    name: str, limit: int = 100, mine: bool = False, since: str | None = None
):
    """Get commit graph data for metro-style visualization (served from background cache).

    ``since`` is a version token from an earlier response.  When the server
    still remembers it, only the commits the client is missing come back.
    """
    from lumbergh.diff_cache import diff_cache

    diff_cache.mark_active(name)
    diff_cache.set_graph_params(name, limit, mine)
    payload = diff_cache.get_graph(name)

    if payload is None:
        # Cache miss (first request before background loop runs) — compute inline
        workdir = get_session_workdir(name)
        try:
            identity = graph_identity(workdir)
            payload = await _run_git(
                get_graph_log, workdir, limit, get_session_path_map(), identity, mine
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return build_response(payload, since, diff_cache.graph_history, name)


@router.get("/{name}/git/log")
async def session_git_log(name: str, limit: int = 20):
    """Get recent commit history for a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        commits = await _run_git(get_commit_log, workdir, limit)
        return {"commits": commits}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/git/search")
async def session_git_search(
    name: str,
    q: str = "",
    author: str | None = None,
    file: str | None = None,
    limit: int = 100,
):
    """Search all of history, for queries the loaded graph window cannot answer."""
    workdir = get_session_workdir(name)

    try:
        commits = await _run_git(search_commits, workdir, q, author, file, limit)
        return {"commits": commits}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/git/commit/{commit_hash}")
async def session_git_commit_diff(name: str, commit_hash: str):
    """Get diff for a specific commit in a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(get_commit_diff, workdir, commit_hash)
        if result is None:
            raise HTTPException(status_code=404, detail="Commit not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/git/compare")
async def session_git_compare(name: str, base: str, head: str):
    """Get the cumulative diff between two commits in a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(get_range_diff, workdir, base, head)
        if result is None:
            raise HTTPException(status_code=404, detail="Commit not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/commit")
async def session_git_commit(name: str, body: CommitInput):
    """Stage all changes and create a commit in a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(
            stage_all_and_commit, workdir, body.message, timeout=GIT_WRITE_TIMEOUT
        )
        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        from lumbergh.message_buffer import message_buffer

        message_buffer.clear(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/git/branches")
async def session_git_branches(name: str):
    """Get list of local and remote branches for a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        return await _run_git(get_branches, workdir)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/branches")
async def get_worktree_branches(repo_path: str):
    """Get branches available for creating a worktree."""
    path = Path(repo_path).expanduser().resolve()
    if not path.exists():
        raise HTTPException(status_code=400, detail=f"Repository path does not exist: {repo_path}")

    try:
        result = await _run_git(get_branches_for_worktree, path)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/checkout")
async def session_git_checkout(name: str, body: CheckoutInput):
    """Checkout a branch in a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(
            checkout_branch, workdir, body.branch, body.reset_to, timeout=GIT_WRITE_TIMEOUT
        )
        if "error" in result:
            held_by = result.get("worktree_path")
            if held_by:
                # The branch exists but another worktree has it checked out. 409,
                # and the path travels as a field so the UI can point at it rather
                # than making the user parse it out of the sentence.
                raise HTTPException(
                    status_code=409,
                    detail={
                        "error": result["error"],
                        "branch": body.branch,
                        "worktree_path": held_by,
                    },
                )
            status_code = 409 if "pending changes" in result["error"] else 400
            raise HTTPException(status_code=status_code, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/delete-branch")
async def session_git_delete_branch(name: str, body: DeleteBranchInput):
    """Delete a local (and optionally remote) branch in a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(
            delete_branch,
            workdir,
            body.branch,
            body.delete_remote,
            body.remote_only,
            timeout=GIT_WRITE_TIMEOUT,
        )
        if "error" in result:
            status_code = 409 if "current branch" in result["error"].lower() else 400
            raise HTTPException(status_code=status_code, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/reset")
async def session_git_reset(name: str):
    """Reset all changes to HEAD in a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(reset_to_head, workdir, timeout=GIT_WRITE_TIMEOUT)
        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/revert-file")
async def session_git_revert_file(name: str, body: RevertFileInput):
    """Revert a single file in a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(revert_file, workdir, body.path, timeout=GIT_WRITE_TIMEOUT)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/push")
async def session_git_push(name: str):
    """Push commits to remote in a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(git_push, workdir, timeout=GIT_WRITE_TIMEOUT)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/amend")
async def session_git_amend(name: str, body: AmendInput):
    """Amend the last commit, optionally with a new message."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(amend_commit, workdir, body.message, timeout=GIT_WRITE_TIMEOUT)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/force-push")
async def session_git_force_push(name: str):
    """Force push with lease to remote."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(git_force_push, workdir, timeout=GIT_WRITE_TIMEOUT)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/stash")
async def session_git_stash(name: str):
    """Stash all changes."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(git_stash, workdir, timeout=GIT_WRITE_TIMEOUT)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/stash-pop")
async def session_git_stash_pop(name: str, ref: str | None = None):
    """Pop a stash entry. Optionally specify ref (e.g. stash@{2})."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(git_stash_pop, workdir, ref=ref, timeout=GIT_WRITE_TIMEOUT)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/stash-drop")
async def session_git_stash_drop(name: str, ref: str | None = None):
    """Drop (delete) a stash entry. Optionally specify ref (e.g. stash@{2})."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(git_stash_drop, workdir, ref=ref, timeout=GIT_WRITE_TIMEOUT)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/pull")
async def session_git_pull(name: str):
    """Pull latest changes with rebase."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(git_pull_rebase, workdir, timeout=GIT_WRITE_TIMEOUT)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/fast-forward")
async def session_git_fast_forward(name: str, body: BranchTargetInput):
    """Fast-forward current branch to another branch (--ff-only)."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(git_fast_forward, workdir, body.branch, timeout=GIT_WRITE_TIMEOUT)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/rebase")
async def session_git_rebase(name: str, body: BranchTargetInput):
    """Rebase current branch onto another branch."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(git_rebase_onto, workdir, body.branch, timeout=GIT_WRITE_TIMEOUT)
        if "error" in result:
            status_code = 409 if "conflict" in result["error"].lower() else 400
            raise HTTPException(status_code=status_code, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/create-branch")
async def session_git_create_branch(name: str, body: CreateBranchInput):
    """Create a new branch at a specific commit."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(
            create_branch_at, workdir, body.name, body.start_point, timeout=GIT_WRITE_TIMEOUT
        )
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/git/pull-requests")
async def session_git_pull_requests(name: str):
    """Open PRs for this repo, if `gh` can see any.

    Absent rather than failing: no gh, no auth, or a non-GitHub remote all
    return an empty list, and the UI just shows no badges.
    """
    from lumbergh.github import GH_TIMEOUT, list_open_prs

    workdir = get_session_workdir(name)

    try:
        prs = await _run_git(list_open_prs, workdir, timeout=GH_TIMEOUT + 2)
        return {"prs": prs}
    except Exception:
        logger.debug("pull request lookup failed for %s", name, exc_info=True)
        return {"prs": []}


@router.get("/{name}/git/reflog")
async def session_git_reflog(name: str, limit: int = 50):
    """Recent HEAD movements — the undo history behind the graph."""
    workdir = get_session_workdir(name)

    try:
        entries = await _run_git(get_reflog, workdir, limit)
        return {"entries": entries}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/git/remote-tags")
async def session_git_remote_tags(name: str):
    """Which tags origin has — the ones whose deletion would affect other people.

    A network round trip, so it is fetched on demand (when a tag menu opens)
    rather than folded into every graph poll.
    """
    workdir = get_session_workdir(name)

    try:
        tags = await _run_git(list_remote_tags, workdir, timeout=GIT_WRITE_TIMEOUT)
        return {"tags": tags}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/delete-tag")
async def session_git_delete_tag(name: str, body: DeleteTagInput):
    """Delete a tag locally, and on origin when asked."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(
            delete_tag, workdir, body.tag, body.delete_remote, timeout=GIT_WRITE_TIMEOUT
        )
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/reset-to")
async def session_git_reset_to(name: str, body: ResetToInput):
    """Reset HEAD to a specific commit (hard or soft)."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(
            reset_to_commit, workdir, body.hash, body.mode, timeout=GIT_WRITE_TIMEOUT
        )
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/reword")
async def session_git_reword(name: str, body: RewordInput):
    """Reword a commit message (amend for HEAD, rebase for older commits)."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(
            reword_commit, workdir, body.hash, body.message, timeout=GIT_WRITE_TIMEOUT
        )
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/cherry-pick")
async def session_git_cherry_pick(name: str, body: CherryPickInput):
    """Cherry-pick a commit onto the current branch."""
    workdir = get_session_workdir(name)

    try:
        result = await _run_git(git_cherry_pick, workdir, body.hash, timeout=GIT_WRITE_TIMEOUT)
        if "error" in result:
            status_code = 409 if "conflict" in result["error"].lower() else 400
            raise HTTPException(status_code=status_code, detail=result["error"])
        from lumbergh.diff_cache import diff_cache

        diff_cache.invalidate(name)
        _invalidate_files_cache(name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/git/remote-status")
async def session_git_remote_status(name: str, fetch: bool = True):
    """Get ahead/behind status relative to remote tracking branch."""
    workdir = get_session_workdir(name)

    try:
        return await _run_git(get_remote_status, workdir, fetch=fetch, timeout=GIT_WRITE_TIMEOUT)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Session-scoped Todos and Scratchpad ---


@router.get("/{name}/todos")
async def get_session_todos(name: str):
    """Get todos for a project (shared across sessions with the same repo)."""
    workdir = get_session_workdir(name)
    try:
        db = get_project_db(workdir)
        todos_table = db.table("todos")
        todos = get_single_document_items(todos_table)
        return {"todos": todos}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/todos")
async def save_session_todos(name: str, todo_list: TodoList):
    """Save todos for a project (shared across sessions with the same repo)."""
    workdir = get_session_workdir(name)
    try:
        db = get_project_db(workdir)
        todos_table = db.table("todos")
        todos = [
            {"text": t.text, "done": t.done, "description": t.description} for t in todo_list.todos
        ]
        save_single_document_items(todos_table, todos)
        return {"todos": todos}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/todos/{index}/spawn")
def launch_session_todo(name: str, index: int):
    """Hand one todo to a fresh worker in its own worktree.

    Sync on purpose: the spawn waits for the new agent's input prompt before typing the
    brief into it (see ``spawn_delivery``), which is seconds of blocking that must not
    happen on the event loop. FastAPI gives a sync endpoint its own thread.
    """
    from lumbergh.routers.bill import spawn as bill_spawn

    workdir = get_session_workdir(name)
    todos = get_single_document_items(get_project_db(workdir).table("todos"))
    if index < 0 or index >= len(todos):
        raise HTTPException(status_code=400, detail="Invalid todo index")

    meta = get_stored_sessions().get(name) or {"workdir": str(workdir)}
    taken = set(get_live_sessions()) | {
        str(e["branch"]) for e in worktrees.all_entries() if e.get("branch")
    }
    return todo_spawn.launch(meta, todos[index], taken=taken, spawn=bill_spawn)


@router.post("/{name}/todos/move")
async def move_session_todo(name: str, req: TodoMoveRequest):
    """Move a todo from one project to another."""
    try:
        source_workdir = get_session_workdir(name)
        source_db = get_project_db(source_workdir)
        source_table = source_db.table("todos")
        source_todos = get_single_document_items(source_table)

        if req.todo_index < 0 or req.todo_index >= len(source_todos):
            raise HTTPException(status_code=400, detail="Invalid todo index")

        # Pop the todo from source
        todo = source_todos.pop(req.todo_index)
        todo["done"] = False  # Reset to unchecked in target

        # Load target todos and prepend
        target_workdir = get_session_workdir(req.target_session)
        target_db = get_project_db(target_workdir)
        target_table = target_db.table("todos")
        target_todos = get_single_document_items(target_table)
        target_todos.insert(0, todo)

        # Save both
        save_single_document_items(source_table, source_todos)
        save_single_document_items(target_table, target_todos)

        return {"source_todos": source_todos}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/scratchpad")
async def get_session_scratchpad(name: str):
    """Get scratchpad content for a project (shared across sessions with the same repo)."""
    workdir = get_session_workdir(name)
    try:
        db = get_project_db(workdir)
        scratchpad_table = db.table("scratchpad")
        content = get_single_document_value(scratchpad_table, "content", default="")
        return {"content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/scratchpad")
async def save_session_scratchpad(name: str, data: ScratchpadContent):
    """Save scratchpad content for a project (shared across sessions with the same repo)."""
    workdir = get_session_workdir(name)
    try:
        db = get_project_db(workdir)
        scratchpad_table = db.table("scratchpad")
        save_single_document_value(scratchpad_table, "content", data.content)
        return {"content": data.content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Session-scoped Prompt Templates ---


@router.get("/{name}/prompts")
async def get_session_prompts(name: str):
    """Get project-specific prompt templates for a session."""
    workdir = get_session_workdir(name)
    db = get_project_db(workdir)
    prompts_table = db.table("prompts")
    templates = get_single_document_items(prompts_table)
    return {"templates": templates}


@router.post("/{name}/prompts")
async def save_session_prompts(name: str, template_list: PromptTemplateList):
    """Save project-specific prompt templates for a session."""
    workdir = get_session_workdir(name)
    db = get_project_db(workdir)
    prompts_table = db.table("prompts")
    templates = [t.model_dump(exclude_none=True) for t in template_list.templates]
    save_single_document_items(prompts_table, templates)
    return {"templates": templates}


@router.post("/{name}/prompts/{template_id}/copy-to-global")
async def copy_session_prompt_to_global(name: str, template_id: str):
    """Copy a project template to global, remove from project."""
    from lumbergh.db_utils import get_global_db

    workdir = get_session_workdir(name)
    db = get_project_db(workdir)
    prompts_table = db.table("prompts")
    global_db = get_global_db()
    global_prompts_table = global_db.table("prompts")

    project_templates = get_single_document_items(prompts_table)

    template_to_copy = None
    remaining_templates = []
    for t in project_templates:
        if t["id"] == template_id:
            template_to_copy = t
        else:
            remaining_templates.append(t)

    if not template_to_copy:
        raise HTTPException(status_code=404, detail="Template not found")

    global_templates = get_single_document_items(global_prompts_table)
    new_template = {k: v for k, v in template_to_copy.items() if k != "id" and v is not None}
    new_template["id"] = str(uuid.uuid4())
    global_templates.append(new_template)

    save_single_document_items(global_prompts_table, global_templates)
    save_single_document_items(prompts_table, remaining_templates)

    return {"success": True, "template": new_template}


@router.post("/{name}/global/prompts/{template_id}/copy-to-project")
async def copy_global_prompt_to_session(name: str, template_id: str):
    """Copy a global template to this session's project (keeps both)."""
    from lumbergh.db_utils import get_global_db

    workdir = get_session_workdir(name)
    db = get_project_db(workdir)
    prompts_table = db.table("prompts")
    global_db = get_global_db()
    global_prompts_table = global_db.table("prompts")

    global_templates = get_single_document_items(global_prompts_table)

    template_to_copy = None
    for t in global_templates:
        if t["id"] == template_id:
            template_to_copy = t
            break

    if not template_to_copy:
        raise HTTPException(status_code=404, detail="Template not found")

    project_templates = get_single_document_items(prompts_table)
    new_template = {k: v for k, v in template_to_copy.items() if k != "id" and v is not None}
    new_template["id"] = str(uuid.uuid4())
    project_templates.append(new_template)

    save_single_document_items(prompts_table, project_templates)

    return {"success": True, "template": new_template}


# --- Session-scoped File Endpoints ---


# (name, path) -> (timestamp, files, root)
_files_cache: dict[tuple[str, str], tuple[float, list, str]] = {}
_FILES_CACHE_TTL = 10.0  # seconds


def _invalidate_files_cache(name: str) -> None:
    """Drop every cached listing for a session (cache is keyed by (name, path))."""
    for key in [k for k in _files_cache if k[0] == name]:
        del _files_cache[key]


@router.get("/{name}/files")
async def session_list_files(name: str, path: str = ""):
    """List one directory level in the session's workdir (cached, 10s TTL)."""
    import asyncio
    import time

    now = time.monotonic()
    cached = _files_cache.get((name, path))
    if cached and (now - cached[0]) < _FILES_CACHE_TTL:
        return {"files": cached[1], "root": cached[2]}

    workdir = get_session_workdir(name)

    try:
        files = await asyncio.to_thread(list_directory, workdir, path, IGNORE_DIRS)
        _files_cache[(name, path)] = (now, files, str(workdir))
        return {"files": files, "root": str(workdir)}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Access denied")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Directory not found")
    except NotADirectoryError:
        raise HTTPException(status_code=400, detail="Path is not a directory")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/files/{file_path:path}")
async def session_get_file(name: str, file_path: str, raw: bool = False):
    """Get contents of a file in the session's working directory.

    Pass ?raw=1 to serve the raw file bytes (for images, etc.).
    """
    workdir = get_session_workdir(name)

    try:
        full_path = workdir / file_path

        if not validate_path_within_root(full_path, workdir):
            raise HTTPException(status_code=403, detail="Access denied")

        if not full_path.exists():
            raise HTTPException(status_code=404, detail="File not found")

        if not full_path.is_file():
            raise HTTPException(status_code=400, detail="Path is not a file")

        if raw:
            return FileResponse(full_path)

        language = get_file_language(full_path)
        content = full_path.read_text(errors="replace")
        return {"content": content, "language": language, "path": file_path}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Message Buffer Endpoints ---


@router.get("/{name}/message-buffer")
async def session_get_message_buffer(name: str):
    """Get buffered user messages for a session."""
    from lumbergh.message_buffer import message_buffer

    return {"messages": message_buffer.get_messages(name)}


@router.delete("/{name}/message-buffer")
async def session_clear_message_buffer(name: str):
    """Clear buffered user messages for a session."""
    from lumbergh.message_buffer import message_buffer

    message_buffer.clear(name)
    return {"status": "cleared"}


# --- Session-scoped AI Endpoints ---


@router.post("/{name}/ai/generate-commit-message")
async def session_generate_commit_message(name: str):
    """Generate a commit message using AI for the session's current changes."""
    from lumbergh.ai.commit_message import build_commit_prompt, parse_commit_response
    from lumbergh.ai.providers import get_provider
    from lumbergh.routers.settings import get_settings

    workdir = get_session_workdir(name)

    try:
        # Get the diff and file list
        diff_data = get_full_diff_with_untracked(workdir)
        files = diff_data.get("files", [])

        if not files:
            raise HTTPException(status_code=400, detail="No changes to commit")

        # Build file summary
        file_summary = "\n".join(
            f"- {f['path']} ({f.get('additions', 0)}+/{f.get('deletions', 0)}-)" for f in files
        )

        # Combine all diffs (preprocessing + truncation handled by build_commit_prompt)
        all_diffs = "\n\n".join(f["diff"] for f in files if f.get("diff"))

        # Get user instruction context
        from lumbergh.message_buffer import message_buffer

        user_messages = message_buffer.get_formatted(name)

        # Build adaptive prompt (handles preprocessing, truncation, prompt selection)
        prompt = build_commit_prompt(
            all_diffs,
            file_summary=file_summary,
            user_messages=user_messages,
        )

        # Get AI provider and generate
        settings = get_settings()
        ai_settings = settings.get("ai", {})
        provider = get_provider(ai_settings, settings)

        message = await provider.complete(prompt)
        message = parse_commit_response(message)

        return {"message": message}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI generation failed: {e}")


@router.post("/{name}/status-summary")
async def session_status_summary(name: str, body: StatusSummaryInput):
    """Generate a short status summary for a session based on the current task."""
    from datetime import UTC, datetime

    from lumbergh.ai.prompts import STATUS_SUMMARY_PROMPT
    from lumbergh.ai.providers import get_provider
    from lumbergh.routers.settings import get_settings

    try:
        # Get AI provider and generate summary
        settings = get_settings()
        ai_settings = settings.get("ai", {})
        provider = get_provider(ai_settings, settings)

        prompt = STATUS_SUMMARY_PROMPT.format(text=body.text)
        summary = await provider.complete(prompt)

        # Clean up response
        summary = summary.strip().strip('"').strip("'")
        # Limit to 30 chars just in case
        if len(summary) > 30:
            summary = summary[:27] + "..."

        # Store in session data DB
        session_db = get_session_data_db(name)
        status_table = session_db.table("status")
        status_table.truncate()
        status_table.insert(
            {
                "status": summary,
                "statusUpdatedAt": datetime.now(tz=UTC).isoformat(),
            }
        )

        return {"status": summary}

    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI summary generation failed: {e}")
