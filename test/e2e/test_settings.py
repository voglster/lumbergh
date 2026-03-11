"""Settings read/patch tests."""


def test_get_settings_returns_defaults(client):
    r = client.get("/api/settings")
    assert r.status_code == 200
    data = r.json()
    assert "repoSearchDir" in data
    assert "gitGraphCommits" in data
    assert "ai" in data
    assert data["gitGraphCommits"] >= 10


def test_patch_setting_and_verify(client):
    r = client.patch("/api/settings", json={"gitGraphCommits": 50})
    assert r.status_code == 200
    assert r.json()["gitGraphCommits"] == 50

    # Verify persisted
    r2 = client.get("/api/settings")
    assert r2.json()["gitGraphCommits"] == 50


def test_patch_invalid_setting_rejected(client):
    r = client.patch("/api/settings", json={"gitGraphCommits": 5})
    assert r.status_code == 400
