"""
Integration tests for API endpoints.
"""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    from main import app

    return TestClient(app)


class TestHealthEndpoint:
    def test_health_check(self, client):
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestGitEndpoints:
    def test_git_status(self, client):
        """Test git status endpoint returns expected structure."""
        response = client.get("/api/git/status")
        assert response.status_code == 200

        data = response.json()
        assert "branch" in data
        assert "files" in data
        assert "clean" in data

    def test_git_diff(self, client):
        """Test git diff endpoint returns expected structure."""
        response = client.get("/api/git/diff")
        assert response.status_code == 200

        data = response.json()
        assert "files" in data
        assert "stats" in data
        assert "additions" in data["stats"]
        assert "deletions" in data["stats"]

    def test_git_log(self, client):
        """Test git log endpoint returns commits."""
        response = client.get("/api/git/log")
        assert response.status_code == 200

        data = response.json()
        assert "commits" in data
        assert isinstance(data["commits"], list)

    def test_git_log_with_limit(self, client):
        """Test git log with limit parameter."""
        response = client.get("/api/git/log?limit=5")
        assert response.status_code == 200


class TestFilesEndpoints:
    def test_list_files(self, client):
        """Test file listing endpoint."""
        response = client.get("/api/files")
        assert response.status_code == 200

        data = response.json()
        assert "files" in data
        assert "root" in data
        assert isinstance(data["files"], list)

    def test_get_file_not_found(self, client):
        """Test getting a nonexistent file."""
        response = client.get("/api/files/nonexistent_file_xyz123.txt")
        assert response.status_code == 404

    def test_get_file_path_traversal(self, client):
        """Test that path traversal is blocked."""
        response = client.get("/api/files/../../../etc/passwd")
        # Either 403 (blocked) or 404 (not found after normalization) is acceptable
        assert response.status_code in (403, 404)
