"""
Sessions router - CRUD for tmux sessions and session-scoped git operations.
Stores metadata in ~/.config/lumbergh/sessions.json
"""

import re
import subprocess
from pathlib import Path

import libtmux
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from tinydb import TinyDB, Query

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

# Database setup
CONFIG_DIR = Path.home() / ".config" / "lumbergh"
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
db = TinyDB(CONFIG_DIR / "sessions.json")
sessions_table = db.table("sessions")

# Session name pattern
SESSION_NAME_PATTERN = re.compile(r'^[a-zA-Z0-9_-]+$')


class CreateSessionRequest(BaseModel):
    name: str
    workdir: str
    description: str = ""


class CommitInput(BaseModel):
    message: str


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
    Session = Query()
    all_sessions = sessions_table.all()
    return {s["name"]: s for s in all_sessions}


@router.get("")
async def list_sessions():
    """List all sessions (merge TinyDB metadata + live tmux state)."""
    live = get_live_sessions()
    stored = get_stored_sessions()

    # Merge: start with stored metadata, augment with live state
    sessions = []
    seen_names = set()

    for name, meta in stored.items():
        seen_names.add(name)
        live_info = live.get(name, {})
        sessions.append({
            "name": name,
            "workdir": meta.get("workdir", ""),
            "description": meta.get("description", ""),
            "alive": live_info.get("alive", False),
            "attached": live_info.get("attached", False),
            "windows": live_info.get("windows", 0),
        })

    # Include orphan tmux sessions (created outside Lumbergh)
    for name, live_info in live.items():
        if name not in seen_names:
            sessions.append({
                "name": name,
                "workdir": None,  # Unknown workdir
                "description": None,
                "alive": True,
                "attached": live_info.get("attached", False),
                "windows": live_info.get("windows", 0),
            })

    return {"sessions": sessions}


@router.post("")
async def create_session(body: CreateSessionRequest):
    """Create a new tmux session."""
    # Validate session name
    if not SESSION_NAME_PATTERN.match(body.name):
        raise HTTPException(
            status_code=400,
            detail="Invalid session name. Use only letters, numbers, underscores, and hyphens."
        )

    # Validate workdir exists
    workdir = Path(body.workdir).expanduser().resolve()
    if not workdir.exists():
        raise HTTPException(status_code=400, detail=f"Directory does not exist: {body.workdir}")
    if not workdir.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {body.workdir}")

    # Check if session already exists
    live = get_live_sessions()
    if body.name in live:
        raise HTTPException(status_code=409, detail=f"Session '{body.name}' already exists")

    # Create tmux session
    result = subprocess.run(
        ["tmux", "new-session", "-d", "-s", body.name, "-c", str(workdir)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Failed to create session: {result.stderr}")

    # Store metadata
    Session = Query()
    sessions_table.upsert(
        {
            "name": body.name,
            "workdir": str(workdir),
            "description": body.description,
        },
        Session.name == body.name
    )

    # Return session info
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
    # Kill tmux session if it exists
    live = get_live_sessions()
    if name in live:
        result = subprocess.run(
            ["tmux", "kill-session", "-t", name],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Failed to kill session: {result.stderr}")

    # Remove metadata
    Session = Query()
    sessions_table.remove(Session.name == name)

    return {"status": "deleted", "name": name}


# --- Session-scoped Git Endpoints ---

def get_session_workdir(name: str) -> Path:
    """Get the workdir for a session, raising 404 if not found."""
    stored = get_stored_sessions()
    if name in stored and stored[name].get("workdir"):
        return Path(stored[name]["workdir"])

    # For orphan sessions, try to get the working directory from tmux
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
        # Get current branch
        branch_result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=workdir,
            capture_output=True,
            text=True,
        )
        branch = branch_result.stdout.strip() if branch_result.returncode == 0 else "unknown"

        # Get status
        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=workdir,
            capture_output=True,
            text=True,
        )

        files = []
        if status_result.returncode == 0 and status_result.stdout.strip():
            status_map = {
                "M": "modified",
                "A": "added",
                "D": "deleted",
                "R": "renamed",
                "C": "copied",
                "U": "unmerged",
                "?": "untracked",
            }
            for line in status_result.stdout.strip().split("\n"):
                if line:
                    status_code = line[:2].strip()
                    path = line[3:]
                    status = status_map.get(status_code[0] if status_code else "?", "unknown")
                    files.append({"path": path, "status": status})

        return {"branch": branch, "files": files, "clean": len(files) == 0}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/git/diff")
async def session_git_diff(name: str):
    """Get git diff for a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        # Get diff for staged and unstaged changes
        diff_result = subprocess.run(
            ["git", "diff", "HEAD"],
            cwd=workdir,
            capture_output=True,
            text=True,
        )

        files = []
        stats = {"additions": 0, "deletions": 0}

        if diff_result.returncode == 0 and diff_result.stdout.strip():
            current_file = None
            current_diff_lines = []

            for line in diff_result.stdout.split("\n"):
                if line.startswith("diff --git"):
                    if current_file:
                        files.append({"path": current_file, "diff": "\n".join(current_diff_lines)})
                    parts = line.split(" b/")
                    current_file = parts[-1] if len(parts) > 1 else "unknown"
                    current_diff_lines = [line]
                elif current_file:
                    current_diff_lines.append(line)
                    if line.startswith("+") and not line.startswith("+++"):
                        stats["additions"] += 1
                    elif line.startswith("-") and not line.startswith("---"):
                        stats["deletions"] += 1

            if current_file:
                files.append({"path": current_file, "diff": "\n".join(current_diff_lines)})

        # Include untracked files
        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=workdir,
            capture_output=True,
            text=True,
        )
        if status_result.returncode == 0:
            for line in status_result.stdout.split("\n"):
                if line.startswith("??"):
                    untracked_path = line[3:]
                    full_path = workdir / untracked_path
                    if full_path.is_file():
                        try:
                            content = full_path.read_text(errors="replace")
                            lines = content.split("\n")
                            diff_lines = [
                                f"diff --git a/{untracked_path} b/{untracked_path}",
                                "new file mode 100644",
                                "--- /dev/null",
                                f"+++ b/{untracked_path}",
                                f"@@ -0,0 +1,{len(lines)} @@",
                            ]
                            for content_line in lines:
                                diff_lines.append(f"+{content_line}")
                                stats["additions"] += 1
                            files.append({"path": untracked_path, "diff": "\n".join(diff_lines)})
                        except Exception:
                            pass

        return {"files": files, "stats": stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{name}/git/log")
async def session_git_log(name: str, limit: int = 20):
    """Get recent commit history for a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        result = subprocess.run(
            ["git", "log", f"-n{limit}", "--format=%H|%h|%s|%an|%ar"],
            cwd=workdir,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=result.stderr)

        commits = []
        for line in result.stdout.strip().split("\n"):
            if line:
                parts = line.split("|", 4)
                if len(parts) >= 5:
                    commits.append({
                        "hash": parts[0],
                        "shortHash": parts[1],
                        "message": parts[2],
                        "author": parts[3],
                        "relativeDate": parts[4],
                    })
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
        # Get commit info
        info_result = subprocess.run(
            ["git", "show", commit_hash, "--format=%H|%s|%an|%ar", "--stat", "-s"],
            cwd=workdir,
            capture_output=True,
            text=True,
        )
        if info_result.returncode != 0:
            raise HTTPException(status_code=404, detail="Commit not found")

        info_line = info_result.stdout.strip().split("\n")[0]
        parts = info_line.split("|", 3)
        commit_info = {
            "hash": parts[0] if len(parts) > 0 else commit_hash,
            "message": parts[1] if len(parts) > 1 else "",
            "author": parts[2] if len(parts) > 2 else "",
            "relativeDate": parts[3] if len(parts) > 3 else "",
        }

        # Get diff for the commit
        diff_result = subprocess.run(
            ["git", "diff", f"{commit_hash}^..{commit_hash}"],
            cwd=workdir,
            capture_output=True,
            text=True,
        )
        if diff_result.returncode != 0:
            diff_result = subprocess.run(
                ["git", "show", commit_hash, "--format="],
                cwd=workdir,
                capture_output=True,
                text=True,
            )

        files = []
        stats = {"additions": 0, "deletions": 0}

        if diff_result.returncode == 0 and diff_result.stdout.strip():
            current_file = None
            current_diff_lines = []

            for line in diff_result.stdout.split("\n"):
                if line.startswith("diff --git"):
                    if current_file:
                        files.append({"path": current_file, "diff": "\n".join(current_diff_lines)})
                    parts = line.split(" b/")
                    current_file = parts[-1] if len(parts) > 1 else "unknown"
                    current_diff_lines = [line]
                elif current_file:
                    current_diff_lines.append(line)
                    if line.startswith("+") and not line.startswith("+++"):
                        stats["additions"] += 1
                    elif line.startswith("-") and not line.startswith("---"):
                        stats["deletions"] += 1

            if current_file:
                files.append({"path": current_file, "diff": "\n".join(current_diff_lines)})

        return {**commit_info, "files": files, "stats": stats}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/git/commit")
async def session_git_commit(name: str, body: CommitInput):
    """Stage all changes and create a commit in a session's workdir."""
    workdir = get_session_workdir(name)

    try:
        # Stage all changes
        add_result = subprocess.run(
            ["git", "add", "-A"],
            cwd=workdir,
            capture_output=True,
            text=True,
        )
        if add_result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"git add failed: {add_result.stderr}")

        # Create commit
        commit_result = subprocess.run(
            ["git", "commit", "-m", body.message],
            cwd=workdir,
            capture_output=True,
            text=True,
        )
        if commit_result.returncode != 0:
            if "nothing to commit" in commit_result.stdout or "nothing to commit" in commit_result.stderr:
                return {"status": "nothing_to_commit", "message": "No changes to commit"}
            raise HTTPException(status_code=500, detail=f"git commit failed: {commit_result.stderr}")

        # Get commit hash
        hash_result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=workdir,
            capture_output=True,
            text=True,
        )
        commit_hash = hash_result.stdout.strip() if hash_result.returncode == 0 else "unknown"

        return {"status": "committed", "hash": commit_hash, "message": body.message}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
