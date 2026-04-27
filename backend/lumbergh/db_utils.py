"""
TinyDB utilities for the Lumbergh backend.
"""

import hashlib
import json
import logging
import subprocess
import threading
import time
from pathlib import Path

from tinydb import TinyDB

from lumbergh.constants import CONFIG_DIR, PROJECTS_DIR, SESSIONS_DATA_DIR

logger = logging.getLogger(__name__)

# Per-session-file locks.  Multiple writers (idle_monitor, session_summary,
# todos/scratchpad routes) share one TinyDB JSON file per session and can
# corrupt it via interleaved writes.  Any caller that mutates a session
# data DB should hold ``session_data_lock(name)`` for its read-modify-write.
_session_data_locks: dict[str, threading.Lock] = {}
_session_data_locks_mutex = threading.Lock()

# Cache TinyDB instances by resolved path.  TinyDB's JSONStorage opens the
# backing file in __init__ and only releases the fd on .close(); constructing
# a new instance per call leaks fds until GC finalizers run, which exhausts
# macOS's 256-per-process default soft limit under load.
_db_cache: dict[Path, TinyDB] = {}
_db_cache_mutex = threading.Lock()


def _get_cached_db(path: Path) -> TinyDB:
    """Return a process-wide cached TinyDB for ``path``, creating it once."""
    key = path.resolve() if path.exists() else path
    with _db_cache_mutex:
        db = _db_cache.get(key)
        if db is None:
            db = TinyDB(path)
            _db_cache[key] = db
        return db


def session_data_lock(session_name: str) -> threading.Lock:
    """Return a process-wide threading.Lock scoped to a session's DB file."""
    with _session_data_locks_mutex:
        lock = _session_data_locks.get(session_name)
        if lock is None:
            lock = threading.Lock()
            _session_data_locks[session_name] = lock
        return lock


def recover_session_data_db(session_name: str) -> bool:
    """
    Attempt to recover a corrupt session DB JSON file.

    Strategy:
      1. Parse the longest valid JSON prefix with ``raw_decode`` — this
         handles the common case of a trailing-garbage corruption caused
         by interleaved writes.  All table data that parses cleanly is
         preserved.
      2. If no valid prefix parses, back the file up to ``<name>.json.corrupt``
         and replace it with ``{}`` so writes can continue.

    Callers must hold ``session_data_lock(session_name)``.
    """
    path = SESSIONS_DATA_DIR / f"{session_name}.json"
    try:
        raw = path.read_text()
    except OSError:
        return False

    try:
        obj, _ = json.JSONDecoder().raw_decode(raw)
        invalidate_db_cache(path)
        path.write_text(json.dumps(obj))
        logger.warning(
            f"Recovered corrupt session DB for {session_name} (trimmed trailing garbage)"
        )
        return True
    except json.JSONDecodeError:
        pass

    backup = path.with_suffix(f".json.corrupt-{int(time.time())}")
    try:
        invalidate_db_cache(path)
        path.rename(backup)
        path.write_text("{}")
    except OSError as e:
        logger.error(f"Could not recover session DB {path}: {e}")
        return False

    logger.error(f"Session DB {path} was unrecoverable; backed up to {backup} and reset")
    return True


def _resolve_main_repo(project_path: Path) -> Path:
    """Resolve a worktree path to its main repository root.

    For worktrees, git's common dir points to the main repo's .git,
    so we use that to find the canonical repo path. For non-worktree
    repos, this returns the resolved project_path unchanged.
    """
    resolved = project_path.resolve()
    try:
        common_dir = Path(
            subprocess.check_output(
                ["git", "-C", str(resolved), "rev-parse", "--git-common-dir"],
                encoding="utf-8",
                errors="replace",
                stderr=subprocess.DEVNULL,
            ).strip()
        )
        if not common_dir.is_absolute():
            common_dir = (resolved / common_dir).resolve()
        # common_dir is the .git dir (or .git/worktrees/../.. -> .git)
        # The repo root is its parent
        return common_dir.parent
    except (subprocess.CalledProcessError, OSError):
        return resolved


def get_sessions_db() -> TinyDB:
    """Get the TinyDB instance for session metadata."""
    return _get_cached_db(CONFIG_DIR / "sessions.json")


def get_settings_db() -> TinyDB:
    """Get the TinyDB instance for application settings."""
    return _get_cached_db(CONFIG_DIR / "settings.json")


def get_global_db() -> TinyDB:
    """Get the TinyDB instance for global cross-project data."""
    return _get_cached_db(CONFIG_DIR / "global.json")


def get_project_db(project_path: Path) -> TinyDB:
    """
    Get a TinyDB instance for project-specific data.

    Args:
        project_path: Path to the project root

    Returns:
        TinyDB instance for the project
    """
    project_hash = hashlib.md5(str(_resolve_main_repo(project_path)).encode()).hexdigest()[:12]
    return _get_cached_db(PROJECTS_DIR / f"{project_hash}.json")


def get_session_data_db(session_name: str) -> TinyDB:
    """
    Get a TinyDB instance for session-specific data (todos, scratchpad, etc.).

    Args:
        session_name: Name of the session

    Returns:
        TinyDB instance for the session
    """
    return _get_cached_db(SESSIONS_DATA_DIR / f"{session_name}.json")


def invalidate_db_cache(path: Path) -> None:
    """Drop a cached TinyDB instance (e.g. after replacing the underlying file).

    Used by recovery paths that rename/rewrite a DB file out from under TinyDB.
    """
    key = path.resolve() if path.exists() else path
    with _db_cache_mutex:
        db = _db_cache.pop(key, None)
    if db is not None:
        try:
            db.close()
        except Exception:  # noqa: S110 - best-effort close during invalidation
            pass


def get_single_document_items(table, key: str = "items") -> list:
    """
    Get items from a table that stores a single document with a list.

    This is the common TinyDB pattern used throughout the app:
    - Table stores one document: {"items": [...]}
    - Returns the list, or empty list if not found

    Args:
        table: TinyDB table instance
        key: Key in the document that holds the list (default: "items")

    Returns:
        List of items, or empty list
    """
    all_docs = table.all()
    if all_docs:
        return all_docs[0].get(key, [])
    return []


def save_single_document_items(table, items: list, key: str = "items") -> list:
    """
    Save items to a table using the single-document pattern.

    Truncates the table and inserts a single document with the items.

    Args:
        table: TinyDB table instance
        items: List of items to save
        key: Key in the document that holds the list (default: "items")

    Returns:
        The saved items list
    """
    table.truncate()
    table.insert({key: items})
    return items


def get_single_document_value(table, key: str, default=None):
    """
    Get a single value from a table that stores one document.

    Args:
        table: TinyDB table instance
        key: Key in the document to retrieve
        default: Default value if not found

    Returns:
        The value, or default
    """
    all_docs = table.all()
    if all_docs:
        return all_docs[0].get(key, default)
    return default


def save_single_document_value(table, key: str, value):
    """
    Save a single value to a table using the single-document pattern.

    Args:
        table: TinyDB table instance
        key: Key in the document
        value: Value to save

    Returns:
        The saved value
    """
    table.truncate()
    table.insert({key: value})
    return value
