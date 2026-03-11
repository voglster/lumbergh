"""Session CRUD lifecycle tests."""

import uuid


def test_list_sessions_includes_created(client, test_session):
    r = client.get("/api/sessions")
    assert r.status_code == 200
    names = [s["name"] for s in r.json()["sessions"]]
    assert test_session in names


def test_session_has_correct_metadata(client, test_session):
    r = client.get("/api/sessions")
    assert r.status_code == 200
    session = next(s for s in r.json()["sessions"] if s["name"] == test_session)
    assert session["workdir"] == "/home/test/test-repo"
    assert session["alive"] is True


def test_duplicate_session_returns_409(client, test_session):
    r = client.post(
        "/api/sessions",
        json={"name": test_session, "workdir": "/home/test/test-repo"},
    )
    assert r.status_code == 409


def test_touch_updates_timestamp(client, test_session):
    r = client.post(f"/api/sessions/{test_session}/touch")
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Verify lastUsedAt is set
    r2 = client.get("/api/sessions")
    session = next(s for s in r2.json()["sessions"] if s["name"] == test_session)
    assert session["lastUsedAt"] is not None


def test_patch_display_name(client, test_session):
    r = client.patch(
        f"/api/sessions/{test_session}",
        json={"displayName": "My Test Session"},
    )
    assert r.status_code == 200
    assert r.json()["displayName"] == "My Test Session"


def test_create_and_delete_session(client):
    name = f"e2e-tmp-{uuid.uuid4().hex[:8]}"
    r = client.post(
        "/api/sessions",
        json={"name": name, "workdir": "/home/test/test-repo"},
    )
    # Might get 200 (new) or 200 with existing=True if workdir already used
    assert r.status_code == 200

    r2 = client.delete(f"/api/sessions/{name}")
    assert r2.status_code == 200
    assert r2.json()["status"] == "deleted"

    # Verify removed from list
    r3 = client.get("/api/sessions")
    names = [s["name"] for s in r3.json()["sessions"]]
    assert name not in names
