"""ETag caching middleware tests.

Verifies that the ETagMiddleware returns ETags on responses
and responds with 304 Not Modified for conditional requests.
"""


def test_etag_returned_on_response(client):
    """GET response should include an ETag header."""
    r = client.get("/api/health")
    assert r.status_code == 200
    assert "etag" in r.headers, f"No ETag header in response: {dict(r.headers)}"
    assert r.headers["etag"], "ETag header is empty"


def test_conditional_get_304(client):
    """If-None-Match with same ETag returns 304 Not Modified."""
    # First request to get the ETag
    r1 = client.get("/api/health")
    assert r1.status_code == 200
    etag = r1.headers.get("etag")
    assert etag, "No ETag in first response"

    # Second request with If-None-Match
    r2 = client.get("/api/health", headers={"If-None-Match": etag})
    assert r2.status_code == 304, (
        f"Expected 304, got {r2.status_code} "
        f"(ETag sent: {etag}, response ETag: {r2.headers.get('etag')})"
    )


def test_etag_changes_after_mutation(client, test_session):
    """ETag should differ after state changes."""
    url = f"/api/sessions/{test_session}/git/status"

    # Get initial ETag
    r1 = client.get(url)
    assert r1.status_code == 200
    etag1 = r1.headers.get("etag")

    # The health endpoint is static so its ETag won't change.
    # Use a different endpoint — settings can be mutated.
    r_settings1 = client.get("/api/settings")
    assert r_settings1.status_code == 200
    settings_etag1 = r_settings1.headers.get("etag")

    # Mutate settings
    client.patch("/api/settings", json={"gitGraphCommits": 77})

    r_settings2 = client.get("/api/settings")
    assert r_settings2.status_code == 200
    settings_etag2 = r_settings2.headers.get("etag")

    assert settings_etag1 != settings_etag2, (
        f"ETag should change after mutation: {settings_etag1} == {settings_etag2}"
    )

    # Restore original value
    client.patch("/api/settings", json={"gitGraphCommits": 50})
