"""
Shared constants for the Lumbergh backend.
"""

import os
import sys
from pathlib import Path

# tmux binary — psmux is a PowerShell-based tmux clone for Windows
# (`uv tool install psmux`). On Unix, the standard `tmux` binary is used.
TMUX_CMD = "psmux" if sys.platform == "win32" else "tmux"

# Configuration directories — override with LUMBERGH_DATA_DIR env var
CONFIG_DIR = Path(os.environ.get("LUMBERGH_DATA_DIR", Path.home() / ".config" / "lumbergh"))
PROJECTS_DIR = CONFIG_DIR / "projects"
SESSIONS_DATA_DIR = CONFIG_DIR / "session_data"
SHARED_DIR = CONFIG_DIR / "shared"
SCRATCH_DIR = CONFIG_DIR / "scratch"

# Ensure directories exist
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
SESSIONS_DATA_DIR.mkdir(parents=True, exist_ok=True)
SHARED_DIR.mkdir(parents=True, exist_ok=True)
SCRATCH_DIR.mkdir(parents=True, exist_ok=True)

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
