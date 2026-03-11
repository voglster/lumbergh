"""Directory validation and search tests."""


def test_validate_existing_directory(client):
    r = client.get("/api/directories/validate", params={"path": "/home/test"})
    assert r.status_code == 200
    assert r.json()["exists"] is True


def test_validate_nonexistent_directory(client):
    r = client.get(
        "/api/directories/validate",
        params={"path": "/nonexistent/path/that/doesnt/exist"},
    )
    assert r.status_code == 200
    assert r.json()["exists"] is False


def test_search_directories(client):
    r = client.get("/api/directories/search", params={"query": ""})
    assert r.status_code == 200
    assert "directories" in r.json()
