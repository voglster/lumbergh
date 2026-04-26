"""Session lifecycle tests beyond basic CRUD.

Tests reset, patching metadata fields (displayName, description, paused),
and agent provider assignment.
"""

import uuid


def test_session_reset(client, test_session):
    """POST /sessions/{name}/reset should succeed (session stays alive)."""
    r = client.post(f"/api/sessions/{test_session}/reset")
    # 200 = reset performed, 400 = nothing to reset / no agent running
    assert r.status_code in (200, 400), f"Unexpected status: {r.status_code} — {r.text}"

    # Session should still be in the list
    r2 = client.get("/api/sessions")
    names = [s["name"] for s in r2.json()["sessions"]]
    assert test_session in names


def test_session_patch_display_name(client, test_session):
    """PATCH displayName and verify it persists."""
    display_name = f"Test Display {uuid.uuid4().hex[:6]}"
    r = client.patch(
        f"/api/sessions/{test_session}",
        json={"displayName": display_name},
    )
    assert r.status_code == 200
    assert r.json()["displayName"] == display_name

    # Verify via GET
    r2 = client.get("/api/sessions")
    session = next(s for s in r2.json()["sessions"] if s["name"] == test_session)
    assert session["displayName"] == display_name


def test_session_patch_description(client, test_session):
    """PATCH description and verify it persists."""
    desc = f"E2E test description {uuid.uuid4().hex[:6]}"
    r = client.patch(
        f"/api/sessions/{test_session}",
        json={"description": desc},
    )
    assert r.status_code == 200
    assert r.json()["description"] == desc


def test_session_patch_paused(client, test_session):
    """PATCH paused flag and verify it persists."""
    # Pause
    r = client.patch(
        f"/api/sessions/{test_session}",
        json={"paused": True},
    )
    assert r.status_code == 200
    assert r.json()["paused"] is True

    # Verify via GET
    r2 = client.get("/api/sessions")
    session = next(s for s in r2.json()["sessions"] if s["name"] == test_session)
    assert session.get("paused") is True

    # Unpause
    r3 = client.patch(
        f"/api/sessions/{test_session}",
        json={"paused": False},
    )
    assert r3.status_code == 200
    assert r3.json()["paused"] is False


def test_session_pause_kills_process(client, test_session):
    """POST /sessions/{name}/pause should kill the agent and set paused flag."""
    # Ensure session is not paused
    client.patch(f"/api/sessions/{test_session}", json={"paused": False})

    # Pause via new endpoint
    r = client.post(f"/api/sessions/{test_session}/pause")
    assert r.status_code == 200
    assert r.json()["status"] == "paused"

    # Verify paused flag is set
    r2 = client.get("/api/sessions")
    session = next(s for s in r2.json()["sessions"] if s["name"] == test_session)
    assert session.get("paused") is True

    # Session should still be alive (tmux session exists)
    assert session.get("alive") is True


def test_session_resume_restarts_process(client, test_session):
    """POST /sessions/{name}/resume should restart the agent and clear paused flag."""
    # Ensure session is paused first
    client.post(f"/api/sessions/{test_session}/pause")

    # Resume
    r = client.post(f"/api/sessions/{test_session}/resume")
    assert r.status_code == 200
    assert r.json()["status"] == "resumed"

    # Verify paused flag is cleared
    r2 = client.get("/api/sessions")
    session = next(s for s in r2.json()["sessions"] if s["name"] == test_session)
    assert session.get("paused") is False


def test_session_resume_idempotent(client, test_session):
    """POST /sessions/{name}/resume should succeed even if not paused (idempotent)."""
    # Ensure not paused
    client.patch(f"/api/sessions/{test_session}", json={"paused": False})

    r = client.post(f"/api/sessions/{test_session}/resume")
    assert r.status_code == 200
    assert r.json()["status"] == "resumed"


def test_session_pause_not_found(client):
    """POST /sessions/{name}/pause should 404 for non-existent session."""
    r = client.post("/api/sessions/nonexistent-session-xyz/pause")
    assert r.status_code == 404


def test_session_resume_not_found(client):
    """POST /sessions/{name}/resume should 404 for non-existent session."""
    r = client.post("/api/sessions/nonexistent-session-xyz/resume")
    assert r.status_code == 404


def test_session_agent_provider(client, repo_dir):
    """Create a session with agentProvider, verify in metadata."""
    name = f"e2e-agent-{uuid.uuid4().hex[:8]}"
    r = client.post(
        "/api/sessions",
        json={
            "name": name,
            "workdir": f"{repo_dir}/test-repo-2",
            "agent_provider": "claude-code",
        },
    )
    assert r.status_code == 200
    data = r.json()

    # The API may return an existing session for this workdir
    actual_name = data.get("name", name)

    # Check metadata — use the actual session name returned
    r2 = client.get("/api/sessions")
    session = next((s for s in r2.json()["sessions"] if s["name"] == actual_name), None)
    assert session is not None

    # agentProvider is only set on newly created sessions, not returned for existing ones
    if not data.get("existing"):
        assert session.get("agentProvider") == "claude-code"

    # Cleanup only if we created a new session
    if not data.get("existing"):
        client.delete(f"/api/sessions/{actual_name}")
