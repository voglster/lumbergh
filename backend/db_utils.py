"""
TinyDB utilities for the Lumbergh backend.
"""

import hashlib
from pathlib import Path

from tinydb import TinyDB

from constants import CONFIG_DIR, PROJECTS_DIR, SESSIONS_DATA_DIR


def get_sessions_db() -> TinyDB:
    """Get the TinyDB instance for session metadata."""
    return TinyDB(CONFIG_DIR / "sessions.json")


def get_settings_db() -> TinyDB:
    """Get the TinyDB instance for application settings."""
    return TinyDB(CONFIG_DIR / "settings.json")


def get_global_db() -> TinyDB:
    """Get the TinyDB instance for global cross-project data."""
    return TinyDB(CONFIG_DIR / "global.json")


def get_project_db(project_path: Path) -> TinyDB:
    """
    Get a TinyDB instance for project-specific data.

    Args:
        project_path: Path to the project root

    Returns:
        TinyDB instance for the project
    """
    project_hash = hashlib.md5(str(project_path.resolve()).encode()).hexdigest()[:12]
    return TinyDB(PROJECTS_DIR / f"{project_hash}.json")


def get_session_data_db(session_name: str) -> TinyDB:
    """
    Get a TinyDB instance for session-specific data (todos, scratchpad, etc.).

    Args:
        session_name: Name of the session

    Returns:
        TinyDB instance for the session
    """
    return TinyDB(SESSIONS_DATA_DIR / f"{session_name}.json")


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
