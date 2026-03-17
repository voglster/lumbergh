"""Version endpoint test."""


def test_version_endpoint(client):
    """GET /api/version returns 200 with version info."""
    r = client.get("/api/version")
    assert r.status_code == 200
    data = r.json()
    assert "current" in data, f"Missing 'current' field: {list(data.keys())}"
