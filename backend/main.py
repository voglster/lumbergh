"""
Lumbergh Backend - FastAPI server for tmux terminal streaming.

Run with: uv run python main.py
"""

import subprocess
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from routers import notes, sessions


class SendInput(BaseModel):
    text: str
    send_enter: bool = True


class CommitInput(BaseModel):
    message: str

app = FastAPI(title="Lumbergh", description="Tmux session supervisor")
app.include_router(notes.router)
app.include_router(sessions.router)

# Project root (parent of backend/)
PROJECT_ROOT = Path(__file__).parent.parent

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/api/git/status")
async def git_status():
    """Get git status for the project."""
    try:
        # Get current branch
        branch_result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )
        branch = branch_result.stdout.strip() if branch_result.returncode == 0 else "unknown"

        # Get status (porcelain format for easy parsing)
        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )

        files = []
        if status_result.returncode == 0 and status_result.stdout.strip():
            for line in status_result.stdout.strip().split("\n"):
                if line:
                    status_code = line[:2].strip()
                    path = line[3:]
                    # Map status codes to human-readable status
                    status_map = {
                        "M": "modified",
                        "A": "added",
                        "D": "deleted",
                        "R": "renamed",
                        "C": "copied",
                        "U": "unmerged",
                        "?": "untracked",
                    }
                    status = status_map.get(status_code[0] if status_code else "?", "unknown")
                    files.append({"path": path, "status": status})

        return {
            "branch": branch,
            "files": files,
            "clean": len(files) == 0,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/diff")
async def git_diff():
    """Get git diff for all changed files, including untracked files."""
    try:
        # Get diff for staged and unstaged changes
        diff_result = subprocess.run(
            ["git", "diff", "HEAD"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )

        # Parse diff into per-file chunks
        files = []
        stats = {"additions": 0, "deletions": 0}

        if diff_result.returncode == 0 and diff_result.stdout.strip():
            current_file = None
            current_diff_lines = []

            for line in diff_result.stdout.split("\n"):
                if line.startswith("diff --git"):
                    # Save previous file if exists
                    if current_file:
                        files.append({
                            "path": current_file,
                            "diff": "\n".join(current_diff_lines),
                        })
                    # Extract filename from "diff --git a/path b/path"
                    parts = line.split(" b/")
                    current_file = parts[-1] if len(parts) > 1 else "unknown"
                    current_diff_lines = [line]
                elif current_file:
                    current_diff_lines.append(line)
                    if line.startswith("+") and not line.startswith("+++"):
                        stats["additions"] += 1
                    elif line.startswith("-") and not line.startswith("---"):
                        stats["deletions"] += 1

            # Don't forget the last file
            if current_file:
                files.append({
                    "path": current_file,
                    "diff": "\n".join(current_diff_lines),
                })

        # Also include untracked files
        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )
        if status_result.returncode == 0:
            for line in status_result.stdout.split("\n"):
                if line.startswith("??"):
                    untracked_path = line[3:]
                    full_path = PROJECT_ROOT / untracked_path
                    if full_path.is_file():
                        try:
                            content = full_path.read_text(errors="replace")
                            lines = content.split("\n")
                            # Generate pseudo-diff for new file
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
                            files.append({
                                "path": untracked_path,
                                "diff": "\n".join(diff_lines),
                            })
                        except Exception:
                            pass  # Skip files that can't be read

        return {"files": files, "stats": stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/log")
async def git_log(limit: int = 20):
    """Get recent commit history."""
    try:
        result = subprocess.run(
            ["git", "log", f"-n{limit}", "--format=%H|%h|%s|%an|%ar"],
            cwd=PROJECT_ROOT,
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/commit/{commit_hash}")
async def git_commit_diff(commit_hash: str):
    """Get diff for a specific commit."""
    try:
        # Get commit info
        info_result = subprocess.run(
            ["git", "show", commit_hash, "--format=%H|%s|%an|%ar", "--stat", "-s"],
            cwd=PROJECT_ROOT,
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
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )
        # For first commit, use show instead
        if diff_result.returncode != 0:
            diff_result = subprocess.run(
                ["git", "show", commit_hash, "--format="],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
            )

        # Parse diff into per-file chunks
        files = []
        stats = {"additions": 0, "deletions": 0}

        if diff_result.returncode == 0 and diff_result.stdout.strip():
            current_file = None
            current_diff_lines = []

            for line in diff_result.stdout.split("\n"):
                if line.startswith("diff --git"):
                    if current_file:
                        files.append({
                            "path": current_file,
                            "diff": "\n".join(current_diff_lines),
                        })
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
                files.append({
                    "path": current_file,
                    "diff": "\n".join(current_diff_lines),
                })

        return {**commit_info, "files": files, "stats": stats}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/commit")
async def git_commit(body: CommitInput):
    """Stage all changes and create a commit."""
    try:
        # Stage all changes (including untracked files)
        add_result = subprocess.run(
            ["git", "add", "-A"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )
        if add_result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"git add failed: {add_result.stderr}")

        # Create commit
        commit_result = subprocess.run(
            ["git", "commit", "-m", body.message],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )
        if commit_result.returncode != 0:
            # Check if there's nothing to commit
            if "nothing to commit" in commit_result.stdout or "nothing to commit" in commit_result.stderr:
                return {"status": "nothing_to_commit", "message": "No changes to commit"}
            raise HTTPException(status_code=500, detail=f"git commit failed: {commit_result.stderr}")

        # Get the commit hash
        hash_result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )
        commit_hash = hash_result.stdout.strip() if hash_result.returncode == 0 else "unknown"

        return {"status": "committed", "hash": commit_hash, "message": body.message}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files")
async def list_files():
    """List files in the project directory."""
    try:
        files = []
        # Walk the project, skipping common ignored directories
        ignore_dirs = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"}

        for item in sorted(PROJECT_ROOT.rglob("*")):
            # Skip ignored directories
            if any(ignored in item.parts for ignored in ignore_dirs):
                continue

            rel_path = item.relative_to(PROJECT_ROOT)
            files.append({
                "path": str(rel_path),
                "type": "directory" if item.is_dir() else "file",
                "size": item.stat().st_size if item.is_file() else None,
            })

        return {"files": files, "root": str(PROJECT_ROOT)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files/{file_path:path}")
async def get_file(file_path: str):
    """Get contents of a specific file."""
    try:
        full_path = PROJECT_ROOT / file_path

        # Security: ensure path doesn't escape project root
        if not full_path.resolve().is_relative_to(PROJECT_ROOT.resolve()):
            raise HTTPException(status_code=403, detail="Access denied")

        if not full_path.exists():
            raise HTTPException(status_code=404, detail="File not found")

        if not full_path.is_file():
            raise HTTPException(status_code=400, detail="Path is not a file")

        # Determine language from extension
        ext_to_lang = {
            ".py": "python",
            ".js": "javascript",
            ".ts": "typescript",
            ".tsx": "tsx",
            ".jsx": "jsx",
            ".json": "json",
            ".md": "markdown",
            ".sh": "bash",
            ".css": "css",
            ".html": "html",
            ".yaml": "yaml",
            ".yml": "yaml",
            ".toml": "toml",
        }
        ext = full_path.suffix.lower()
        language = ext_to_lang.get(ext, "text")

        content = full_path.read_text(errors="replace")
        return {"content": content, "language": language, "path": file_path}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_name}/send")
async def send_to_session(session_name: str, body: SendInput):
    """Send text to a tmux session using tmux send-keys."""
    text = body.text.rstrip('\n')

    # Use -l for literal text (no special key interpretation)
    result = subprocess.run(
        ["tmux", "send-keys", "-t", session_name, "-l", text],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr)

    # Send Enter key separately (without -l so it's interpreted as a key)
    if body.send_enter:
        result = subprocess.run(
            ["tmux", "send-keys", "-t", session_name, "Enter"],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=result.stderr)

    return {"status": "sent"}


@app.websocket("/api/session/{session_name}/stream")
async def session_stream(websocket: WebSocket, session_name: str):
    """
    WebSocket endpoint for bidirectional terminal I/O with a tmux session.

    Uses session pooling to ensure one PTY per tmux session, even with
    multiple WebSocket clients (e.g., React StrictMode double-mounts).

    Messages from client:
    - {"type": "input", "data": "..."} - Send keystrokes to terminal
    - {"type": "resize", "cols": N, "rows": M} - Resize terminal

    Messages to client:
    - {"type": "output", "data": "..."} - Terminal output
    - {"type": "error", "message": "..."} - Error messages
    """
    from fastapi import WebSocketDisconnect
    from session_manager import session_manager

    await websocket.accept()

    try:
        # Register this client with the session manager
        await session_manager.register_client(session_name, websocket)

        # Read messages from client and forward to PTY
        while True:
            message = await websocket.receive_json()
            await session_manager.handle_client_message(session_name, message)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        # Unregister client - PTY closes only when last client disconnects
        await session_manager.unregister_client(session_name, websocket)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
