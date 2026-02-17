"""
Shared folder router - Cross-project context sharing via ~/.config/lumbergh/shared/
"""

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse

from constants import SHARED_DIR

router = APIRouter(prefix="/api/shared", tags=["shared"])

# Path to global CLAUDE.md
CLAUDE_MD_PATH = Path.home() / ".claude" / "CLAUDE.md"

# The section we inject into CLAUDE.md
LB_SHARED_SECTION = """
## LB Shared

Shared folder: `~/.config/lumbergh/shared/`

Commands:
- **"lb share: <topic>"** - Write context to shared/<topic>.md
- **"check lb shared"** - List and read files in shared folder
- **"clear lb shared"** - Delete all files in shared folder

Images pasted in Lumbergh are saved here. Reference by path:
`~/.config/lumbergh/shared/screenshot_2026-02-16_193045.png`
"""

LB_SHARED_MARKER = "## LB Shared"


def is_lb_shared_installed() -> bool:
    """Check if the LB Shared section exists in CLAUDE.md."""
    if not CLAUDE_MD_PATH.exists():
        return False
    content = CLAUDE_MD_PATH.read_text()
    return LB_SHARED_MARKER in content


@router.get("/claude-md-status")
async def claude_md_status():
    """Check if LB Shared section is installed in ~/.claude/CLAUDE.md."""
    return {"installed": is_lb_shared_installed()}


@router.post("/setup-claude-md")
async def setup_claude_md():
    """Add LB Shared section to ~/.claude/CLAUDE.md if not present."""
    if is_lb_shared_installed():
        return {"status": "already_exists"}

    # Ensure ~/.claude directory exists
    CLAUDE_MD_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Read existing content or start fresh
    if CLAUDE_MD_PATH.exists():
        content = CLAUDE_MD_PATH.read_text()
    else:
        content = ""

    # Append the section
    if content and not content.endswith("\n"):
        content += "\n"
    content += LB_SHARED_SECTION

    CLAUDE_MD_PATH.write_text(content)

    return {"status": "added"}


@router.get("/files")
async def list_shared_files():
    """List all files in the shared folder."""
    if not SHARED_DIR.exists():
        return {"files": []}

    files = []
    for f in sorted(SHARED_DIR.iterdir()):
        if f.is_file():
            files.append({
                "name": f.name,
                "size": f.stat().st_size,
                "modified": f.stat().st_mtime,
            })

    return {"files": files}


@router.delete("/files")
async def clear_shared_files():
    """Delete all files in the shared folder."""
    if not SHARED_DIR.exists():
        return {"deleted": 0}

    count = 0
    for f in SHARED_DIR.iterdir():
        if f.is_file():
            f.unlink()
            count += 1

    return {"deleted": count}


@router.get("/files/{filename}")
async def get_shared_file(filename: str):
    """Get contents of a shared file."""
    file_path = SHARED_DIR / filename

    # Security: ensure we stay in shared dir
    if not file_path.resolve().parent == SHARED_DIR.resolve():
        raise HTTPException(status_code=403, detail="Access denied")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    content = file_path.read_text(errors="replace")
    return {"name": filename, "content": content}


@router.delete("/files/{filename}")
async def delete_shared_file(filename: str):
    """Delete a specific shared file."""
    file_path = SHARED_DIR / filename

    # Security: ensure we stay in shared dir
    if not file_path.resolve().parent == SHARED_DIR.resolve():
        raise HTTPException(status_code=403, detail="Access denied")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    file_path.unlink()
    return {"status": "deleted", "name": filename}


@router.post("/upload")
async def upload_file(file: UploadFile):
    """Upload a file to the shared folder."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Generate timestamped filename: screenshot_2026-02-16_193045.png
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")

    # Get extension from original filename
    original_ext = Path(file.filename).suffix.lower() or ".png"

    # Determine prefix based on content type
    if file.content_type and file.content_type.startswith("image/"):
        prefix = "screenshot"
    else:
        prefix = "file"

    filename = f"{prefix}_{timestamp}{original_ext}"
    file_path = SHARED_DIR / filename

    # Save the file
    content = await file.read()
    file_path.write_bytes(content)

    return {
        "name": filename,
        "path": str(file_path),
        "size": len(content),
    }


@router.get("/files/{filename}/content")
async def get_shared_file_content(filename: str):
    """Serve the raw content of a shared file (for images, etc.)."""
    file_path = SHARED_DIR / filename

    # Security: ensure we stay in shared dir
    if not file_path.resolve().parent == SHARED_DIR.resolve():
        raise HTTPException(status_code=403, detail="Access denied")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path)
