"""AI endpoint tests.

Tests the AI status endpoint, graceful degradation when no provider
is configured, and AI prompt CRUD operations.
"""

import uuid


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


def test_ai_status(client):
    """GET /api/ai/status returns 200 with provider info."""
    r = client.get("/api/ai/status")
    assert r.status_code == 200
    data = r.json()
    assert "provider" in data
    assert "available" in data
    assert "model" in data


# ---------------------------------------------------------------------------
# Graceful degradation — these expect 503 when no provider is reachable
# ---------------------------------------------------------------------------


def test_generate_commit_no_provider(client):
    """POST /api/ai/generate/commit-message returns 503 when provider unavailable."""
    r = client.post(
        "/api/ai/generate/commit-message",
        json={"diff": "diff --git a/foo.txt\n+hello"},
    )
    # 503 = no provider, 500 = no prompt template, 200 = provider actually works
    assert r.status_code in (200, 500, 503), f"Unexpected: {r.status_code} — {r.text}"


def test_generate_prompt_name_no_provider(client):
    """POST /api/ai/generate/prompt-name returns 503 when provider unavailable."""
    r = client.post(
        "/api/ai/generate/prompt-name",
        json={"content": "This is a test prompt for code review."},
    )
    assert r.status_code in (200, 503), f"Unexpected: {r.status_code} — {r.text}"


def test_session_status_summary_no_provider(client, test_session):
    """POST /sessions/{name}/status-summary returns 503 when no provider."""
    r = client.post(
        f"/api/sessions/{test_session}/status-summary",
        json={"text": "Working on fixing the auth bug"},
    )
    assert r.status_code in (200, 503), f"Unexpected: {r.status_code} — {r.text}"


def test_ollama_models_no_server(client):
    """GET /api/ai/ollama/models returns 503 when Ollama is not running."""
    r = client.get("/api/ai/ollama/models")
    # 503 if Ollama not running, 200 if it happens to be
    assert r.status_code in (200, 503), f"Unexpected: {r.status_code} — {r.text}"


# ---------------------------------------------------------------------------
# AI Prompts CRUD — Global
# ---------------------------------------------------------------------------


def test_ai_prompts_crud(client):
    """GET/POST global AI prompts."""
    # Get current prompts
    r = client.get("/api/ai/prompts")
    assert r.status_code == 200
    original_prompts = r.json()

    # Add a test prompt
    test_prompt = {
        "id": f"e2e-{uuid.uuid4().hex[:8]}",
        "task": "test_task",
        "name": "e2e_test_prompt",
        "template": "This is an e2e test prompt: {{variable}}",
        "isDefault": False,
    }
    new_prompts = original_prompts + [test_prompt]

    r2 = client.post("/api/ai/prompts", json={"prompts": new_prompts})
    assert r2.status_code == 200
    saved = r2.json()
    saved_ids = [p["id"] for p in saved]
    assert test_prompt["id"] in saved_ids

    # Verify via GET
    r3 = client.get("/api/ai/prompts")
    assert r3.status_code == 200
    fetched_ids = [p["id"] for p in r3.json()]
    assert test_prompt["id"] in fetched_ids

    # Cleanup: restore original prompts
    client.post("/api/ai/prompts", json={"prompts": original_prompts})


def test_ai_project_prompts_crud(client, test_session, test_repo_dir):
    """GET/POST project-specific AI prompts."""
    project_path = test_repo_dir

    # Get current project prompts
    r = client.get(f"/api/ai/prompts/project?project_path={project_path}")
    assert r.status_code == 200
    original = r.json()

    # Add a test prompt
    test_prompt = {
        "id": f"e2e-proj-{uuid.uuid4().hex[:8]}",
        "task": "project_test",
        "name": "e2e_project_prompt",
        "template": "Project-specific test prompt",
        "isDefault": False,
    }
    r2 = client.post(
        f"/api/ai/prompts/project?project_path={project_path}",
        json={"prompts": original + [test_prompt]},
    )
    assert r2.status_code == 200

    # Verify
    r3 = client.get(f"/api/ai/prompts/project?project_path={project_path}")
    assert r3.status_code == 200
    ids = [p["id"] for p in r3.json()]
    assert test_prompt["id"] in ids

    # Cleanup
    client.post(
        f"/api/ai/prompts/project?project_path={project_path}",
        json={"prompts": original},
    )
