"""Error handling and edge case tests.

Verifies that the API returns proper error codes for invalid inputs,
nonexistent resources, and security-sensitive operations like path traversal.
"""

FAKE_SESSION = "nonexistent-session-xyz"


# --- Session creation validation ---


def test_create_session_missing_workdir(client):
    """POST /api/sessions with no workdir should fail validation."""
    r = client.post("/api/sessions", json={"name": "bad-session"})
    assert r.status_code in (400, 422), f"Expected 400/422, got {r.status_code}: {r.text}"


def test_create_session_empty_name_no_workdir(client):
    """POST /api/sessions with empty name and no workdir should fail."""
    r = client.post("/api/sessions", json={"name": "", "workdir": ""})
    assert r.status_code in (400, 422), f"Expected 400/422, got {r.status_code}: {r.text}"


# --- Nonexistent session access ---


def test_delete_nonexistent_session(client):
    """DELETE on a missing session should not return 500."""
    r = client.delete(f"/api/sessions/{FAKE_SESSION}")
    assert r.status_code != 500, f"Got 500 for missing session delete: {r.text}"
    # 200 (already gone) or 404 are both acceptable
    assert r.status_code in (200, 404)


def test_git_status_nonexistent_session(client):
    """GET git/status for a missing session should return 404, not 500."""
    r = client.get(f"/api/sessions/{FAKE_SESSION}/git/status")
    assert r.status_code != 500, f"Got 500 for missing session git status: {r.text}"
    assert r.status_code == 404


def test_todos_nonexistent_session(client):
    """GET todos for a missing session should not crash.

    Todos are stored by workdir hash in TinyDB, so a nonexistent session
    returns 200 with empty list (no session lookup needed). This is by design.
    """
    r = client.get(f"/api/sessions/{FAKE_SESSION}/todos")
    assert r.status_code in (200, 404), f"Unexpected status {r.status_code}: {r.text}"


def test_files_nonexistent_session(client):
    """GET files for a missing session should return 404, not 500."""
    r = client.get(f"/api/sessions/{FAKE_SESSION}/files")
    assert r.status_code != 500, f"Got 500 for missing session files: {r.text}"
    assert r.status_code == 404


# --- Path traversal ---


def test_path_traversal_blocked(client, test_session):
    """Attempting to read ../../etc/passwd should be blocked."""
    r = client.get(f"/api/sessions/{test_session}/files/../../etc/passwd")
    # Must NOT succeed with file content
    if r.status_code == 200:
        data = r.json()
        content = data.get("content", "")
        assert "root:" not in content, "Path traversal returned /etc/passwd content!"
    else:
        # 403 (access denied) or 404 are both acceptable rejections
        assert r.status_code in (400, 403, 404), (
            f"Unexpected status {r.status_code} for path traversal: {r.text}"
        )


# --- Git edge cases ---


def test_checkout_nonexistent_branch(client, test_session):
    """Checking out a branch that doesn't exist should return 400."""
    r = client.post(
        f"/api/sessions/{test_session}/git/checkout",
        json={"branch": "this-branch-definitely-does-not-exist-abc123"},
    )
    assert r.status_code in (400, 409), f"Expected 400/409, got {r.status_code}: {r.text}"


# --- Todos edge cases ---


def test_save_empty_todo_list(client, test_session):
    """Posting an empty todo list should clear all todos."""
    # First save an empty list
    r = client.post(
        f"/api/sessions/{test_session}/todos",
        json={"todos": []},
    )
    assert r.status_code == 200
    assert r.json()["todos"] == []

    # Verify GET returns empty
    r2 = client.get(f"/api/sessions/{test_session}/todos")
    assert r2.status_code == 200
    assert r2.json()["todos"] == []


def test_move_todo_invalid_index(client, test_session):
    """Moving a todo with an out-of-bounds index should return 400."""
    r = client.post(
        f"/api/sessions/{test_session}/todos/move",
        json={"target_session": test_session, "todo_index": 9999},
    )
    assert r.status_code == 400, f"Expected 400 for invalid index, got {r.status_code}: {r.text}"
