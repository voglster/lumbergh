"""Prompt template tests (project-scoped and global)."""

import uuid


def test_project_prompts_initially_empty(client, test_session):
    r = client.get(f"/api/sessions/{test_session}/prompts")
    assert r.status_code == 200
    assert r.json()["templates"] == []


def test_save_and_get_project_prompts(client, test_session):
    templates = [
        {"id": str(uuid.uuid4()), "name": "Review", "prompt": "Review this code"},
        {"id": str(uuid.uuid4()), "name": "Refactor", "prompt": "Refactor this"},
    ]
    r = client.post(
        f"/api/sessions/{test_session}/prompts",
        json={"templates": templates},
    )
    assert r.status_code == 200
    assert len(r.json()["templates"]) == 2

    r2 = client.get(f"/api/sessions/{test_session}/prompts")
    assert len(r2.json()["templates"]) == 2
    assert r2.json()["templates"][0]["name"] == "Review"


def test_global_prompts_crud(client):
    # Initially may or may not be empty (depends on other tests)
    # Save some global prompts
    tid = str(uuid.uuid4())
    templates = [
        {"id": tid, "name": "Global Template", "prompt": "Do something globally"},
    ]
    r = client.post("/api/global/prompts", json={"templates": templates})
    assert r.status_code == 200

    r2 = client.get("/api/global/prompts")
    assert r2.status_code == 200
    found = [t for t in r2.json()["templates"] if t["id"] == tid]
    assert len(found) == 1
    assert found[0]["name"] == "Global Template"


def test_copy_project_prompt_to_global(client, test_session):
    # Ensure there's a project prompt
    tid = str(uuid.uuid4())
    templates = [{"id": tid, "name": "ToCopy", "prompt": "Copy me to global"}]
    client.post(f"/api/sessions/{test_session}/prompts", json={"templates": templates})

    r = client.post(f"/api/sessions/{test_session}/prompts/{tid}/copy-to-global")
    assert r.status_code == 200
    assert r.json()["success"] is True

    # Project prompts should now be empty (moved, not copied)
    r2 = client.get(f"/api/sessions/{test_session}/prompts")
    assert len(r2.json()["templates"]) == 0

    # Should exist in global
    r3 = client.get("/api/global/prompts")
    names = [t["name"] for t in r3.json()["templates"]]
    assert "ToCopy" in names


def test_copy_global_prompt_to_project(client, test_session):
    # Get a global template ID
    r = client.get("/api/global/prompts")
    global_templates = r.json()["templates"]
    assert len(global_templates) > 0
    tid = global_templates[0]["id"]

    r2 = client.post(
        f"/api/sessions/{test_session}/global/prompts/{tid}/copy-to-project"
    )
    assert r2.status_code == 200
    assert r2.json()["success"] is True

    # Should now exist in project prompts
    r3 = client.get(f"/api/sessions/{test_session}/prompts")
    assert len(r3.json()["templates"]) >= 1
