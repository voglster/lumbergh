"""
Lumbergh Backend - FastAPI server for tmux terminal streaming.

Run with: uv run python main.py
"""

import asyncio
import hashlib
import logging
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware

from lumbergh.auth import AuthMiddleware
from lumbergh.auth import router as auth_router
from lumbergh.constants import TMUX_CMD
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
from lumbergh.routers import ai, backup, cloud, notes, sessions, settings, shared, tmux

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001 - required by FastAPI
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

    # Event loop lag watchdog — writes stacks to /tmp/lumbergh-lag.log
    # when the loop is blocked >200ms.  Cheap (one sleep per 50ms tick).
    lag_log = Path(tempfile.gettempdir()) / "lumbergh-lag.log"

    async def _lag_watchdog(threshold_ms: float = 200):
        import sys
        import time
        import traceback

        while True:
            t0 = time.monotonic()
            await asyncio.sleep(0.05)
            lag_ms = (time.monotonic() - t0 - 0.05) * 1000
            if lag_ms > threshold_ms:
                with open(lag_log, "a") as f:
                    f.write(
                        f"\n{'=' * 60}\nBlocked {lag_ms:.0f}ms at {time.strftime('%H:%M:%S')}\n"
                    )
                    for tid, frame in sys._current_frames().items():
                        f.write(f"\n--- Thread {tid} ---\n")
                        traceback.print_stack(frame, file=f)

    _lag_task = asyncio.create_task(_lag_watchdog())  # noqa: RUF006

    # Start background services
    idle_monitor.start()
    diff_cache.start()

    from lumbergh.backup_scheduler import backup_scheduler

    backup_scheduler.start()

    # Fire startup telemetry (non-blocking) + periodic heartbeat
    from lumbergh.telemetry import heartbeat_loop, send_startup

    _telemetry_task = asyncio.create_task(send_startup())  # noqa: RUF006
    _heartbeat_task = asyncio.create_task(heartbeat_loop())

    # Start cloud tunnel for remote session access (if cloud is configured)
    from lumbergh.routers.settings import get_settings
    from lumbergh.tunnel import cloud_tunnel

    if get_settings().get("cloudToken"):
        cloud_tunnel.start()

    yield

    _heartbeat_task.cancel()

    # Stop background services
    cloud_tunnel.stop()
    backup_scheduler.stop()
    diff_cache.stop()
    idle_monitor.stop()


class ETagMiddleware(BaseHTTPMiddleware):
    """Add ETag support to GET responses. Returns 304 if content unchanged."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        if request.method != "GET" or response.status_code != 200:
            return response

        # Read the response body
        body = b"".join(
            [
                chunk if isinstance(chunk, bytes) else chunk.encode()
                async for chunk in response.body_iterator
            ]
        )

        # Compute ETag from body hash
        etag = f'"{hashlib.md5(body).hexdigest()}"'

        # Check If-None-Match
        if_none_match = request.headers.get("if-none-match")
        if if_none_match == etag:
            return Response(status_code=304, headers={"ETag": etag})

        return Response(
            content=body,
            status_code=response.status_code,
            headers={**dict(response.headers), "ETag": etag},
            media_type=response.media_type,
        )


app = FastAPI(title="Lumbergh", description="Tmux session supervisor", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(ai.router)
app.include_router(notes.router)
app.include_router(sessions.router)
app.include_router(sessions.directories_router)
app.include_router(settings.router)
app.include_router(cloud.router)
app.include_router(backup.router)
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
    expose_headers=["ETag"],
)
app.add_middleware(AuthMiddleware)
app.add_middleware(ETagMiddleware)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/api/version")
async def version_check():
    """Check current version and whether an update is available."""
    from lumbergh.version_check import get_version_info

    return await get_version_info()


@app.get("/api/git/status")
async def git_status():
    """Get git status for the project."""
    from lumbergh.routers.sessions import _run_git

    try:
        branch = await _run_git(get_current_branch, PROJECT_ROOT)
        files = await _run_git(get_porcelain_status, PROJECT_ROOT)
        return {
            "branch": branch,
            "files": files,
            "clean": len(files) == 0,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/diff")
async def git_diff():
    """Get git diff for all changed files, including untracked files."""
    from lumbergh.routers.sessions import _run_git

    try:
        return await _run_git(get_full_diff_with_untracked, PROJECT_ROOT)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/log")
async def git_log(limit: int = 20):
    """Get recent commit history."""
    from lumbergh.routers.sessions import _run_git

    try:
        commits = await _run_git(get_commit_log, PROJECT_ROOT, limit)
        return {"commits": commits}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/commit/{commit_hash}")
async def git_commit_diff(commit_hash: str):
    """Get diff for a specific commit."""
    from lumbergh.routers.sessions import _run_git

    try:
        result = await _run_git(get_commit_diff, PROJECT_ROOT, commit_hash)
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
    from lumbergh.routers.sessions import GIT_WRITE_TIMEOUT, _run_git

    try:
        result = await _run_git(
            stage_all_and_commit, PROJECT_ROOT, body.message, timeout=GIT_WRITE_TIMEOUT
        )
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
    from lumbergh.routers.sessions import GIT_WRITE_TIMEOUT, _run_git

    try:
        result = await _run_git(reset_to_head, PROJECT_ROOT, timeout=GIT_WRITE_TIMEOUT)
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
    from lumbergh.routers.sessions import GIT_WRITE_TIMEOUT, _run_git

    try:
        result = await _run_git(revert_file, PROJECT_ROOT, body.path, timeout=GIT_WRITE_TIMEOUT)
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
    from lumbergh.routers.sessions import GIT_WRITE_TIMEOUT, _run_git

    try:
        result = await _run_git(git_push, PROJECT_ROOT, timeout=GIT_WRITE_TIMEOUT)
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
    from lumbergh.routers.sessions import _run_git

    try:
        files = await _run_git(list_project_files, PROJECT_ROOT)
        return {"files": files, "root": str(PROJECT_ROOT)}
    except HTTPException:
        raise
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


async def _exit_copy_mode(session_name: str) -> None:
    """If the pane is in copy-mode, send 'q' to exit it."""
    mode = (await _run_tmux("display-message", "-p", "-t", session_name, "#{pane_mode}")).strip()
    if mode == "copy-mode":
        await _run_tmux("send-keys", "-t", session_name, "q")


async def _run_tmux(*args: str, input_data: str | None = None, timeout: float = 5.0) -> str:
    """Run a tmux command asynchronously with a timeout.

    Raises HTTPException on failure or timeout (e.g. tmux stuck in copy-mode).
    """
    proc = await asyncio.create_subprocess_exec(
        TMUX_CMD,
        *args,
        stdin=asyncio.subprocess.PIPE if input_data else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=input_data.encode() if input_data else None),
            timeout=timeout,
        )
    except TimeoutError:
        proc.kill()
        raise HTTPException(
            status_code=504,
            detail="tmux command timed out (is the pane in copy-mode?)",
        )
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=stderr.decode())
    return stdout.decode()


@app.post("/api/session/{session_name}/send")
async def send_to_session(session_name: str, body: SendInput):
    """Send text to a tmux session using tmux send-keys or paste-buffer."""
    await _exit_copy_mode(session_name)
    text = body.text.rstrip("\n")

    if len(text) > 128:
        # For large text, use load-buffer + paste-buffer (much faster than send-keys
        # which processes each character individually through tmux's key pipeline).
        # Include trailing newline in the buffer itself so the Enter is delivered
        # atomically with the text — a separate send-keys Enter can race.
        buf = text + "\n" if body.send_enter else text
        await _run_tmux("load-buffer", "-", input_data=buf)
        await _run_tmux("paste-buffer", "-t", session_name, "-d", "-p")
    else:
        # For short text, send-keys -l is fine
        await _run_tmux("send-keys", "-t", session_name, "-l", text)
        # Send Enter key separately (without -l so it's interpreted as a key)
        if body.send_enter:
            await _run_tmux("send-keys", "-t", session_name, "Enter")

    # Buffer the message for AI commit context
    if body.send_enter:
        from lumbergh.message_buffer import message_buffer

        message_buffer.add(session_name, body.text)

    return {"status": "sent"}


@app.post("/api/session/{session_name}/tmux-command")
async def send_tmux_command(session_name: str, cmd: TmuxCommand):
    """Send a tmux command to a session."""
    from lumbergh.routers.sessions import get_session_workdir

    if cmd.command == "new-window":
        workdir = get_session_workdir(session_name)
        await _run_tmux("new-window", "-t", session_name, "-c", str(workdir))
    elif cmd.command == "next-window":
        await _run_tmux("next-window", "-t", session_name)
    elif cmd.command == "prev-window":
        await _run_tmux("previous-window", "-t", session_name)
    elif cmd.command == "copy-mode":
        await _run_tmux("copy-mode", "-t", session_name)
    elif cmd.command == "copy-mode-cancel":
        await _run_tmux("send-keys", "-t", session_name, "q")
    elif cmd.command == "page-up":
        await _run_tmux("send-keys", "-t", session_name, "PageUp")
    elif cmd.command == "page-down":
        await _run_tmux("send-keys", "-t", session_name, "PageDown")
    else:
        raise HTTPException(status_code=400, detail=f"Unknown command: {cmd.command}")
    return {"status": "ok"}


@app.get("/api/session/{session_name}/copy-mode")
async def get_copy_mode(session_name: str):
    """Check if the tmux pane is in copy-mode."""
    mode = (await _run_tmux("display-message", "-p", "-t", session_name, "#{pane_mode}")).strip()
    return {"active": mode == "copy-mode"}


@app.websocket("/api/session/{session_name}/stream")
async def session_stream(
    websocket: WebSocket,
    session_name: str,
    cols: int | None = None,
    rows: int | None = None,
):
    """
    WebSocket endpoint for bidirectional terminal I/O with a tmux session.

    Uses session pooling to ensure one PTY per tmux session, even with
    multiple WebSocket clients (e.g., React StrictMode double-mounts).

    Query params ``cols`` / ``rows`` (optional) hint the initial PTY size so
    the first ``tmux attach`` doesn't land at 80x24 and reflow the agent's
    UI before the client's first resize message arrives.

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

    initial_cols = cols if cols and 20 <= cols <= 500 else None
    initial_rows = rows if rows and 5 <= rows <= 200 else None

    try:
        # Register this client with the session manager
        await session_manager.register_client(
            session_name, websocket, initial_cols=initial_cols, initial_rows=initial_rows
        )

        # Read messages from client and forward to PTY
        while True:
            message = await websocket.receive_json()
            await session_manager.handle_client_message(session_name, message, sender=websocket)

    except ValueError as e:
        # Session doesn't exist (e.g., killed externally)
        try:
            await websocket.send_json({"type": "session_not_found", "message": str(e)})
        except Exception:  # noqa: S110 - best-effort error notification
            pass
        return
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:  # noqa: S110 - best-effort error notification
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
