"""
File system utilities for the Lumbergh backend.
"""

import os
from pathlib import Path

from lumbergh.constants import IGNORE_DIRS


def list_directory(
    root: Path, rel_path: str = "", ignore_dirs: set[str] | None = None
) -> list[dict]:
    """
    List the immediate children of one directory under root.

    Only the named directory is scanned; nothing beneath it is touched. The
    file browser expands one level at a time, so walking the whole tree was
    work whose result was discarded -- and it held the GIL long enough to
    stall the event loop. See
    docs/superpowers/specs/2026-09-17-lazy-file-listing-design.md.

    Args:
        root: Project root. Reported paths are relative to this.
        rel_path: Directory to list, relative to root. Empty lists root itself.
        ignore_dirs: Directory names to omit (uses IGNORE_DIRS if None)

    Returns:
        List of dicts with path, type, and size keys. Directories sort first,
        then files, each group case-insensitively by name.

    Raises:
        PermissionError: rel_path escapes root, or the directory is unreadable
        FileNotFoundError: rel_path does not exist
        NotADirectoryError: rel_path is a file, not a directory
    """
    if ignore_dirs is None:
        ignore_dirs = IGNORE_DIRS

    target = root / rel_path if rel_path else root
    if not validate_path_within_root(target, root):
        raise PermissionError(rel_path)

    entries: list[dict] = []
    with os.scandir(target) as it:
        for entry in it:
            if entry.name in ignore_dirs:
                continue
            try:
                # is_dir() follows symlinks so a linked directory still shows
                # as a folder; escape safety is validate_path_within_root's job
                # on the way in. scandir reuses the dirent type, so this costs
                # no extra syscall; only files are stat()ed, for their size.
                is_dir = entry.is_dir()
                size = None if is_dir else entry.stat().st_size
            except OSError:
                continue  # vanished between scandir and stat
            entries.append(
                {
                    "path": f"{rel_path}/{entry.name}" if rel_path else entry.name,
                    "type": "directory" if is_dir else "file",
                    "size": size,
                }
            )

    entries.sort(key=lambda e: (e["type"] != "directory", e["path"].lower()))
    return entries


def get_file_language(path: Path | str) -> str:
    """
    Return a syntax-highlighting hint for a file, based on its extension.

    The hint is the bare, lowercased extension without the dot (e.g. 'py',
    'ts', 'feature'). The frontend resolves it against highlight.js / lowlight,
    which map extensions to languages through their own alias tables and fall
    back to content auto-detection for anything unrecognized. Files with no
    extension return 'text'.
    """
    if isinstance(path, str):
        path = Path(path)
    return path.suffix.lstrip(".").lower() or "text"


def validate_path_within_root(path: Path, root: Path) -> bool:
    """
    Validate that a path is within the root directory (security check).

    Args:
        path: Path to validate
        root: Root directory that path must be within

    Returns:
        True if path is within root, False otherwise
    """
    try:
        return path.resolve().is_relative_to(root.resolve())
    except (ValueError, RuntimeError):
        return False


def read_file_safe(path: Path) -> tuple[str | None, str | None]:
    """
    Safely read a file's contents with error handling.

    Args:
        path: Path to the file

    Returns:
        Tuple of (content, error_message). One will always be None.
    """
    if not path.exists():
        return None, "File not found"
    if not path.is_file():
        return None, "Path is not a file"

    try:
        content = path.read_text(errors="replace")
        return content, None
    except Exception as e:
        return None, str(e)
