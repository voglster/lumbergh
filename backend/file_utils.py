"""
File system utilities for the Lumbergh backend.
"""

from collections.abc import Iterator
from pathlib import Path

from constants import EXT_TO_LANGUAGE, IGNORE_DIRS


def iter_project_files(root: Path, ignore_dirs: set[str] | None = None) -> Iterator[Path]:
    """
    Iterate over files in a project directory, skipping ignored directories.

    Args:
        root: Root directory to iterate
        ignore_dirs: Set of directory names to skip (uses IGNORE_DIRS if None)

    Yields:
        Path objects for each file/directory
    """
    if ignore_dirs is None:
        ignore_dirs = IGNORE_DIRS

    for item in sorted(root.rglob("*")):
        if any(ignored in item.parts for ignored in ignore_dirs):
            continue
        yield item


def list_project_files(root: Path, ignore_dirs: set[str] | None = None) -> list[dict]:
    """
    List files in a project directory as a list of dicts.

    Args:
        root: Root directory to list
        ignore_dirs: Set of directory names to skip

    Returns:
        List of dicts with path, type, and size keys
    """
    files = []
    for item in iter_project_files(root, ignore_dirs):
        rel_path = item.relative_to(root)
        files.append(
            {
                "path": str(rel_path),
                "type": "directory" if item.is_dir() else "file",
                "size": item.stat().st_size if item.is_file() else None,
            }
        )
    return files


def get_file_language(path: Path | str) -> str:
    """
    Get the language identifier for syntax highlighting based on file extension.

    Args:
        path: File path (Path object or string)

    Returns:
        Language identifier string (e.g., 'python', 'typescript')
    """
    if isinstance(path, str):
        path = Path(path)
    ext = path.suffix.lower()
    return EXT_TO_LANGUAGE.get(ext, "text")


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
