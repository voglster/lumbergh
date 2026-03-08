"""
Shared pytest fixtures for Lumbergh backend tests.
"""

import subprocess
import tempfile
from pathlib import Path

import pytest
from tinydb import TinyDB


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def mock_tinydb(temp_dir):
    """Create a TinyDB instance using a temp file."""
    db_path = temp_dir / "test_db.json"
    db = TinyDB(db_path)
    yield db
    db.close()


@pytest.fixture
def mock_git_repo(temp_dir):
    """
    Create a mock git repository with some files and commits.

    Returns the path to the repo.
    """
    repo_path = temp_dir / "test_repo"
    repo_path.mkdir()

    # Initialize git repo
    subprocess.run(["git", "init"], cwd=repo_path, capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "test@example.com"],
        cwd=repo_path,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test User"],
        cwd=repo_path,
        capture_output=True,
    )

    # Create initial file and commit
    (repo_path / "README.md").write_text("# Test Repo\n")
    subprocess.run(["git", "add", "."], cwd=repo_path, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=repo_path,
        capture_output=True,
    )

    yield repo_path


@pytest.fixture
def mock_git_repo_with_changes(mock_git_repo):
    """
    A git repo with uncommitted changes (modified and untracked files).
    """
    # Modify existing file
    (mock_git_repo / "README.md").write_text("# Test Repo\n\nModified content.\n")

    # Add untracked file
    (mock_git_repo / "new_file.txt").write_text("This is a new file.\n")

    yield mock_git_repo
