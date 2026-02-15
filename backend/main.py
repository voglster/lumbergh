"""
Lumbergh Backend - FastAPI server for tmux terminal streaming.

Run with: uv run python main.py
"""

from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from file_utils import get_file_language, list_project_files, validate_path_within_root
from git_utils import (
    get_commit_diff,
    get_commit_log,
    get_current_branch,
    get_full_diff_with_untracked,
    get_porcelain_status,
    stage_all_and_commit,
)
from models import CommitInput, SendInput, TmuxCommand
from routers import ai, notes, sessions, settings

app = FastAPI(title="Lumbergh", description="Tmux session supervisor")
app.include_router(ai.router)
app.include_router(notes.router)
app.include_router(sessions.router)
app.include_router(sessions.directories_router)
app.include_router(settings.router)

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
        branch = get_current_branch(PROJECT_ROOT)
        files = get_porcelain_status(PROJECT_ROOT)
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
        return get_full_diff_with_untracked(PROJECT_ROOT)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/log")
async def git_log(limit: int = 20):
    """Get recent commit history."""
    try:
        commits = get_commit_log(PROJECT_ROOT, limit)
        return {"commits": commits}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/commit/{commit_hash}")
async def git_commit_diff(commit_hash: str):
    """Get diff for a specific commit."""
    try:
        result = get_commit_diff(PROJECT_ROOT, commit_hash)
        if result is None:
            raise HTTPException(status_code=404, detail="Commit not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/commit")
async def git_commit(body: CommitInput):
    """Stage all changes and create a commit."""
    try:
        result = stage_all_and_commit(PROJECT_ROOT, body.message)
        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files")
async def list_files():
    """List files in the project directory."""
    try:
        files = list_project_files(PROJECT_ROOT)
        return {"files": files, "root": str(PROJECT_ROOT)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files/{file_path:path}")
async def get_file(file_path: str):
    """Get contents of a specific file."""
    try:
        full_path = PROJECT_ROOT / file_path

        # Security: ensure path doesn't escape project root
        if not validate_path_within_root(full_path, PROJECT_ROOT):
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


@app.post("/api/session/{session_name}/send")
async def send_to_session(session_name: str, body: SendInput):
    """Send text to a tmux session using tmux send-keys."""
    import subprocess

    text = body.text.rstrip("\n")

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


@app.post("/api/session/{session_name}/tmux-command")
async def send_tmux_command(session_name: str, cmd: TmuxCommand):
    """Send a tmux window navigation command to a session."""
    import subprocess

    tmux_commands = {
        "next-window": ["tmux", "next-window", "-t", session_name],
        "prev-window": ["tmux", "previous-window", "-t", session_name],
        "new-window": ["tmux", "new-window", "-t", session_name],
    }
    result = subprocess.run(tmux_commands[cmd.command], capture_output=True, text=True)
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr)
    return {"status": "ok"}


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
