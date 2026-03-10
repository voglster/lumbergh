"""
Lumbergh Backend - FastAPI server for tmux terminal streaming.

Run with: uv run python main.py
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from lumbergh.file_utils import get_file_language, list_project_files, validate_path_within_root
from lumbergh.git_utils import (
    get_commit_diff,
    get_commit_log,
    get_current_branch,
    get_full_diff_with_untracked,
    get_porcelain_status,
    git_push,
    reset_to_head,
    revert_file,
    stage_all_and_commit,
)
from lumbergh.models import CommitInput, RevertFileInput, SendInput, TmuxCommand
from lumbergh.routers import ai, notes, sessions, settings, shared, tmux

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifespan handler - runs on startup/shutdown."""
    from lumbergh.diff_cache import diff_cache
    from lumbergh.idle_monitor import idle_monitor
    from lumbergh.routers.sessions import get_live_sessions, get_stored_sessions

    # Log any orphaned sessions (stored in TinyDB but no longer in tmux)
    live = set(get_live_sessions().keys())
    stored = set(get_stored_sessions().keys())
    orphaned = stored - live
    if orphaned:
        logger.info(f"Found {len(orphaned)} stored session(s) without tmux: {orphaned}")

    # Start background services
    idle_monitor.start()
    diff_cache.start()

    yield

    # Stop background services
    diff_cache.stop()
    idle_monitor.stop()


app = FastAPI(title="Lumbergh", description="Tmux session supervisor", lifespan=lifespan)
app.include_router(ai.router)
app.include_router(notes.router)
app.include_router(sessions.router)
app.include_router(sessions.directories_router)
app.include_router(settings.router)
app.include_router(shared.router)
app.include_router(tmux.router)

# Project root (parent of backend/)
PROJECT_ROOT = Path(__file__).parent.parent.parent

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


@app.post("/api/git/reset")
async def git_reset():
    """Reset all changes to HEAD (discard all uncommitted changes)."""
    try:
        result = reset_to_head(PROJECT_ROOT)
        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/revert-file")
async def git_revert_file(body: RevertFileInput):
    """Revert a single file to HEAD (discard changes for one file)."""
    try:
        result = revert_file(PROJECT_ROOT, body.path)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/push")
async def git_push_endpoint():
    """Push commits to remote repository."""
    try:
        result = git_push(PROJECT_ROOT)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
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
async def get_file(file_path: str, raw: bool = False):
    """Get contents of a specific file. Pass ?raw=1 for raw bytes."""
    try:
        full_path = PROJECT_ROOT / file_path

        # Security: ensure path doesn't escape project root
        if not validate_path_within_root(full_path, PROJECT_ROOT):
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


@app.post("/api/session/{session_name}/send")
async def send_to_session(session_name: str, body: SendInput):
    """Send text to a tmux session using tmux send-keys or paste-buffer."""
    import subprocess

    text = body.text.rstrip("\n")

    if len(text) > 128:
        # For large text, use load-buffer + paste-buffer (much faster than send-keys
        # which processes each character individually through tmux's key pipeline)
        result = subprocess.run(
            ["tmux", "load-buffer", "-"],
            input=text,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=result.stderr)
        result = subprocess.run(
            ["tmux", "paste-buffer", "-t", session_name, "-d", "-p"],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=result.stderr)
    else:
        # For short text, send-keys -l is fine
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

    # Buffer the message for AI commit context
    if body.send_enter:
        from lumbergh.message_buffer import message_buffer

        message_buffer.add(session_name, body.text)

    return {"status": "sent"}


@app.post("/api/session/{session_name}/tmux-command")
async def send_tmux_command(session_name: str, cmd: TmuxCommand):
    """Send a tmux window navigation command to a session."""
    import subprocess

    from lumbergh.routers.sessions import get_session_workdir

    tmux_commands = {
        "next-window": ["tmux", "next-window", "-t", session_name],
        "prev-window": ["tmux", "previous-window", "-t", session_name],
    }

    if cmd.command == "new-window":
        # Get the session's working directory so new windows start there
        workdir = get_session_workdir(session_name)
        tmux_cmd = ["tmux", "new-window", "-t", session_name, "-c", str(workdir)]
    else:
        tmux_cmd = tmux_commands[cmd.command]

    result = subprocess.run(tmux_cmd, capture_output=True, text=True)
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

    from lumbergh.session_manager import session_manager

    await websocket.accept()

    try:
        # Register this client with the session manager
        await session_manager.register_client(session_name, websocket)

        # Read messages from client and forward to PTY
        while True:
            message = await websocket.receive_json()
            await session_manager.handle_client_message(session_name, message, sender=websocket)

    except ValueError as e:
        # Session doesn't exist (e.g., killed externally)
        try:
            await websocket.send_json({
                "type": "session_not_found",
                "message": str(e)
            })
        except Exception:
            pass
        return
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


def mount_frontend(app: FastAPI):
    """Mount frontend static files if a built frontend is available."""
    from starlette.responses import FileResponse
    from starlette.staticfiles import StaticFiles

    # Look for frontend dist in package data first, then source tree
    dist_dir = None
    pkg_dist = Path(__file__).parent / "frontend_dist"
    src_dist = Path(__file__).parent.parent.parent / "frontend" / "dist"

    if pkg_dist.is_dir() and (pkg_dist / "index.html").exists():
        dist_dir = pkg_dist
    elif src_dist.is_dir() and (src_dist / "index.html").exists():
        dist_dir = src_dist

    if dist_dir is None:
        return  # No frontend build found, API-only mode

    # Mount Vite's hashed assets
    assets_dir = dist_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

    # Catch-all route for SPA - serves index.html for any non-API path
    index_html = dist_dir / "index.html"

    @app.get("/{path:path}")
    async def serve_frontend(path: str):
        # Don't intercept API routes
        if path.startswith("api/") or path == "api":
            raise HTTPException(status_code=404, detail="Not found")
        # Try to serve static file first (only within dist_dir)
        try:
            static_file = (dist_dir / path).resolve()
            if static_file.is_file() and str(static_file).startswith(str(dist_dir.resolve())):
                return FileResponse(str(static_file))
        except (ValueError, OSError):
            pass
        return FileResponse(str(index_html))


mount_frontend(app)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8420)
