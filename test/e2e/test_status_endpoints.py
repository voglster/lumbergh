"""Status endpoint tests for shared, tmux, and AI routers."""


def test_shared_claude_md_status(client):
    """GET /api/shared/claude-md-status returns 200 with installed boolean."""
    r = client.get("/api/shared/claude-md-status")
    assert r.status_code == 200
    data = r.json()
    assert "installed" in data
    assert isinstance(data["installed"], bool)


def test_tmux_mouse_status(client):
    """GET /api/tmux/mouse-status returns 200 with expected fields."""
    r = client.get("/api/tmux/mouse-status")
    assert r.status_code == 200
    data = r.json()
    assert "enabled" in data
    assert isinstance(data["enabled"], bool)
    assert "has_config" in data
    assert isinstance(data["has_config"], bool)


def test_ai_provider_status(client):
    """GET /api/ai/status returns 200 with provider status structure."""
    r = client.get("/api/ai/status")
    assert r.status_code == 200
    data = r.json()
    assert "provider" in data
    assert isinstance(data["provider"], str)
    assert "available" in data
    assert isinstance(data["available"], bool)
    assert "model" in data


def test_shared_save_as_prompt(client, test_session):
    """Upload a shared file, save it as a prompt template, then clean up."""
    # Upload a text file to shared
    r = client.post(
        "/api/shared/upload",
        files={"file": ("save-as-prompt-test.txt", b"Test prompt content", "text/plain")},
    )
    assert r.status_code == 200
    filename = r.json()["name"]

    try:
        # Save as a global prompt
        r2 = client.post(
            f"/api/shared/files/{filename}/save-as-prompt",
            json={
                "name": "e2e_test_prompt",
                "scope": "global",
            },
        )
        assert r2.status_code == 200
        data = r2.json()
        assert "template" in data
        assert data["template"]["name"] == "e2e_test_prompt"
        assert "Test prompt content" in data["template"]["prompt"]
    finally:
        # Clean up the shared file
        client.delete(f"/api/shared/files/{filename}")
