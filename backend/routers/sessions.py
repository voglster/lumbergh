"""
Sessions router - CRUD for tmux sessions and session-scoped git operations.
Stores metadata in ~/.config/lumbergh/sessions.json
"""

import re
import subprocess
from pathlib import Path

import libtmux
from fastapi import APIRouter, HTTPException
from tinydb import Query

from constants import IGNORE_DIRS, REPO_SEARCH_SKIP_DIRS
from db_utils import (
    get_session_data_db,
    get_sessions_db,
    get_single_document_items,
    get_single_document_value,
    save_single_document_items,
    save_single_document_value,
)
from file_utils import get_file_language, list_project_files, validate_path_within_root
from git_utils import (
    checkout_branch,
    get_branches,
    get_commit_diff,
    get_commit_log,
    get_current_branch,
    get_full_diff_with_untracked,
    get_porcelain_status,
    get_remote_status,
    git_push,
    reset_to_head,
    stage_all_and_commit,
)
from models import CheckoutInput, CommitInput, CreateSessionRequest, ScratchpadContent, SessionUpdate, StatusSummaryInput, TodoList

router = APIRouter(prefix="/api/sessions", tags=["sessions"])
directories_router = APIRouter(prefix="/api/directories", tags=["directories"])

# Database setup
db = get_sessions_db()
sessions_table = db.table("sessions")

# Session name pattern
SESSION_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


def find_git_repos(base_dir: Path, query: str = "", limit: int = 20) -> list[dict]:
    """Find git repositories under base_dir matching the query."""
    results = []
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


@directories_router.get("/search")
async def search_directories(query: str = ""):
    """Search for git repositories in the configured search directory."""
    from routers.settings import get_settings

    settings = get_settings()
    base_dir = Path(settings.get("repoSearchDir", str(Path.home() / "src")))
    if not base_dir.exists():
        return {"directories": []}

    directories = find_git_repos(base_dir, query, limit=20)
    return {"directories": directories}


def get_tmux_server() -> libtmux.Server:
    """Get the tmux server instance."""
    return libtmux.Server()


def get_live_sessions() -> dict[str, dict]:
    """Get live tmux sessions as a dict keyed by name."""
    try:
        server = get_tmux_server()
        return {
            s.name: {
                "name": s.name,
                "id": s.id,
                "windows": len(s.windows),
                "attached": bool(s.session_attached),
                "alive": True,
            }
            for s in server.sessions
        }
    except Exception:
        return {}


def get_stored_sessions() -> dict[str, dict]:
    """Get stored session metadata as a dict keyed by name."""
    all_sessions = sessions_table.all()
    return {s["name"]: s for s in all_sessions}


def get_session_status(name: str) -> dict:
    """Get status info for a session from its data DB."""
    try:
        session_db = get_session_data_db(name)
        status_table = session_db.table("status")
        all_docs = status_table.all()
        if all_docs:
            return {
                "status": all_docs[0].get("status"),
                "statusUpdatedAt": all_docs[0].get("statusUpdatedAt"),
            }
    except Exception:
        pass
    return {"status": None, "statusUpdatedAt": None}


@router.get("")
async def list_sessions():
    """List all sessions (merge TinyDB metadata + live tmux state)."""
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
                }
            )

    return {"sessions": sessions}


@router.patch("/{name}")
async def update_session(name: str, body: SessionUpdate):
    """Update session metadata (e.g., displayName)."""
    Session = Query()
    existing = sessions_table.get(Session.name == name)

    if not existing:
        # Check if it's an orphan tmux session
        live = get_live_sessions()
        if name not in live:
            raise HTTPException(status_code=404, detail=f"Session '{name}' not found")
        # Create a new record for the orphan session
        existing = {"name": name}

    # Update fields
    if body.displayName is not None:
        existing["displayName"] = body.displayName
    if body.description is not None:
        existing["description"] = body.description

    sessions_table.upsert(existing, Session.name == name)

    return existing


@router.post("")
async def create_session(body: CreateSessionRequest):
    """Create a new tmux session."""

    if not SESSION_NAME_PATTERN.match(body.name):
        raise HTTPException(
            status_code=400,
            detail="Invalid session name. Use only letters, numbers, underscores, and hyphens.",
        )

    workdir = Path(body.workdir).expanduser().resolve()
    if not workdir.exists():
        raise HTTPException(status_code=400, detail=f"Directory does not exist: {body.workdir}")
    if not workdir.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {body.workdir}")

    # Check for existing session with same workdir
    workdir_str = str(workdir)
    stored = get_stored_sessions()
    live = get_live_sessions()

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
            }

    if body.name in live:
        raise HTTPException(status_code=409, detail=f"Session '{body.name}' already exists")

    result = subprocess.run(
        ["tmux", "new-session", "-d", "-s", body.name, "-c", str(workdir)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Failed to create session: {result.stderr}")

    subprocess.run(
        ["tmux", "send-keys", "-t", body.name, "claude", "Enter"],
        capture_output=True,
        text=True,
    )

    Session = Query()
    sessions_table.upsert(
        {
            "name": body.name,
            "workdir": str(workdir),
            "description": body.description,
        },
        Session.name == body.name,
    )

    live = get_live_sessions()
    live_info = live.get(body.name, {})

    return {
        "name": body.name,
        "workdir": str(workdir),
        "description": body.description,
        "alive": live_info.get("alive", True),
        "attached": live_info.get("attached", False),
        "windows": live_info.get("windows", 1),
    }


@router.delete("/{name}")
async def delete_session(name: str):
    """Kill a tmux session and remove metadata."""
    live = get_live_sessions()
    if name in live:
        result = subprocess.run(
            ["tmux", "kill-session", "-t", name],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Failed to kill session: {result.stderr}")

    Session = Query()
    sessions_table.remove(Session.name == name)

    return {"status": "deleted", "name": name}


# --- Session-scoped Git Endpoints ---


def get_session_workdir(name: str) -> Path:
    """Get the workdir for a session, raising 404 if not found."""
    stored = get_stored_sessions()
    if name in stored and stored[name].get("workdir"):
        return Path(stored[name]["workdir"])

    try:
        result = subprocess.run(
            ["tmux", "display-message", "-t", name, "-p", "#{pane_current_path}"],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and result.stdout.strip():
            return Path(result.stdout.strip())
    except Exception:
        pass

    raise HTTPException(status_code=404, detail=f"Session '{name}' not found or has no workdir")


@router.get("/{name}/git/status")
async def session_git_status(name: str):
    """Get git status for a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        branch = get_current_branch(workdir)
        files = get_porcelain_status(workdir)
        return {"branch": branch, "files": files, "clean": len(files) == 0}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/git/diff")
async def session_git_diff(name: str):
    """Get git diff for a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        return get_full_diff_with_untracked(workdir)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/git/log")
async def session_git_log(name: str, limit: int = 20):
    """Get recent commit history for a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        commits = get_commit_log(workdir, limit)
        return {"commits": commits}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/git/commit/{commit_hash}")
async def session_git_commit_diff(name: str, commit_hash: str):
    """Get diff for a specific commit in a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        result = get_commit_diff(workdir, commit_hash)
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
        result = stage_all_and_commit(workdir, body.message)
        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
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
        return get_branches(workdir)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/checkout")
async def session_git_checkout(name: str, body: CheckoutInput):
    """Checkout a branch in a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        result = checkout_branch(workdir, body.branch)
        if "error" in result:
            status_code = 409 if "pending changes" in result["error"] else 400
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
        result = reset_to_head(workdir)
        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
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
        result = git_push(workdir)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
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
        result = get_remote_status(workdir, fetch=fetch)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Session-scoped Todos and Scratchpad ---


@router.get("/{name}/todos")
async def get_session_todos(name: str):
    """Get todos for a specific session."""
    try:
        session_db = get_session_data_db(name)
        todos_table = session_db.table("todos")
        todos = get_single_document_items(todos_table)
        return {"todos": todos}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/todos")
async def save_session_todos(name: str, todo_list: TodoList):
    """Save todos for a specific session."""
    try:
        session_db = get_session_data_db(name)
        todos_table = session_db.table("todos")
        todos = [{"text": t.text, "done": t.done} for t in todo_list.todos]
        save_single_document_items(todos_table, todos)
        return {"todos": todos}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/scratchpad")
async def get_session_scratchpad(name: str):
    """Get scratchpad content for a specific session."""
    try:
        session_db = get_session_data_db(name)
        scratchpad_table = session_db.table("scratchpad")
        content = get_single_document_value(scratchpad_table, "content", default="")
        return {"content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/scratchpad")
async def save_session_scratchpad(name: str, data: ScratchpadContent):
    """Save scratchpad content for a specific session."""
    try:
        session_db = get_session_data_db(name)
        scratchpad_table = session_db.table("scratchpad")
        save_single_document_value(scratchpad_table, "content", data.content)
        return {"content": data.content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Session-scoped File Endpoints ---


@router.get("/{name}/files")
async def session_list_files(name: str):
    """List files in the session's working directory."""
    workdir = get_session_workdir(name)

    try:
        files = list_project_files(workdir, IGNORE_DIRS)
        return {"files": files, "root": str(workdir)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/files/{file_path:path}")
async def session_get_file(name: str, file_path: str):
    """Get contents of a file in the session's working directory."""
    workdir = get_session_workdir(name)

    try:
        full_path = workdir / file_path

        if not validate_path_within_root(full_path, workdir):
            raise HTTPException(status_code=403, detail="Access denied")

        if not full_path.exists():
            raise HTTPException(status_code=404, detail="File not found")

        if not full_path.is_file():
            raise HTTPException(status_code=400, detail="Path is not a file")

        language = get_file_language(full_path)
        content = full_path.read_text(errors="replace")
        return {"content": content, "language": language, "path": file_path}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Session-scoped AI Endpoints ---


@router.post("/{name}/ai/generate-commit-message")
async def session_generate_commit_message(name: str):
    """Generate a commit message using AI for the session's current changes."""
    from ai.prompts import get_ai_prompt, render_prompt
    from ai.providers import get_provider
    from routers.settings import get_settings

    workdir = get_session_workdir(name)

    try:
        # Get the diff and file list
        diff_data = get_full_diff_with_untracked(workdir)
        files = diff_data.get("files", [])

        if not files:
            raise HTTPException(status_code=400, detail="No changes to commit")

        # Build file summary
        file_summary = "\n".join(
            f"- {f['path']} ({f.get('additions', 0)}+/{f.get('deletions', 0)}-)"
            for f in files
        )

        # Combine all diffs (truncate if too long)
        all_diffs = "\n\n".join(f["diff"] for f in files if f.get("diff"))
        max_diff_length = 8000  # Limit to avoid token limits
        if len(all_diffs) > max_diff_length:
            all_diffs = all_diffs[:max_diff_length] + "\n\n... (truncated)"

        # Get the prompt template
        template = get_ai_prompt("commit_message", workdir)
        if not template:
            raise HTTPException(status_code=500, detail="No commit message prompt template found")

        # Render the prompt
        prompt = render_prompt(
            template,
            {
                "git_diff": all_diffs,
                "file_summary": file_summary,
            },
        )

        # Get AI provider and generate
        settings = get_settings()
        ai_settings = settings.get("ai", {})
        provider = get_provider(ai_settings)

        message = await provider.complete(prompt)

        # Clean up response
        message = message.strip()
        if message.startswith("```"):
            lines = message.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            message = "\n".join(lines).strip()

        return {"message": message}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI generation failed: {e}")


@router.post("/{name}/status-summary")
async def session_status_summary(name: str, body: StatusSummaryInput):
    """Generate a short status summary for a session based on the current task."""
    from datetime import datetime

    from ai.prompts import STATUS_SUMMARY_PROMPT
    from ai.providers import get_provider
    from routers.settings import get_settings

    try:
        # Get AI provider and generate summary
        settings = get_settings()
        ai_settings = settings.get("ai", {})
        provider = get_provider(ai_settings)

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
        status_table.insert({
            "status": summary,
            "statusUpdatedAt": datetime.utcnow().isoformat(),
        })

        return {"status": summary}

    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI summary generation failed: {e}")
