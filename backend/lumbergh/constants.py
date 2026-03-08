"""
Shared constants for the Lumbergh backend.
"""

from pathlib import Path

# Configuration directories
CONFIG_DIR = Path.home() / ".config" / "lumbergh"
PROJECTS_DIR = CONFIG_DIR / "projects"
SESSIONS_DATA_DIR = CONFIG_DIR / "session_data"
SHARED_DIR = CONFIG_DIR / "shared"

# Ensure directories exist
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
SESSIONS_DATA_DIR.mkdir(parents=True, exist_ok=True)
SHARED_DIR.mkdir(parents=True, exist_ok=True)

# Git status code mapping
GIT_STATUS_MAP = {
    "M": "modified",
    "A": "added",
    "D": "deleted",
    "R": "renamed",
    "C": "copied",
    "U": "unmerged",
    "?": "untracked",
}

# File extension to language mapping for syntax highlighting
EXT_TO_LANGUAGE = {
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

# Directories to ignore when listing/searching files
IGNORE_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"}

# Additional directories to skip when searching for git repos
REPO_SEARCH_SKIP_DIRS = IGNORE_DIRS | {".cache", ".tox", ".nox"}
