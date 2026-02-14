"""
Lumbergh Backend - FastAPI server for tmux terminal streaming.

Run with: uv run python main.py
"""

import subprocess
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Lumbergh", description="Tmux session supervisor")

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
    """Get git diff for all changed files."""
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

        return {"files": files, "stats": stats}
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


@app.get("/api/sessions")
async def list_sessions():
    """List available tmux sessions."""
    from tmux_pty import list_tmux_sessions
    sessions = list_tmux_sessions()
    return {"sessions": sessions}


@app.websocket("/api/session/{session_name}/stream")
async def session_stream(websocket: WebSocket, session_name: str):
    """
    WebSocket endpoint for bidirectional terminal I/O with a tmux session.

    Messages from client:
    - {"type": "input", "data": "..."} - Send keystrokes to terminal
    - {"type": "resize", "cols": N, "rows": M} - Resize terminal

    Messages to client:
    - {"type": "output", "data": "..."} - Terminal output
    - {"type": "error", "message": "..."} - Error messages
    """
    await websocket.accept()

    from tmux_pty import TmuxPtySession

    try:
        session = TmuxPtySession(session_name)
        await session.run(websocket)
    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})
        await websocket.close()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
