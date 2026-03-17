"""Auth endpoint tests.

Tests the full auth lifecycle: password setting, login, logout,
and middleware enforcement on protected routes.

Each test uses fresh httpx clients to avoid cookie contamination.
The shared ``client`` fixture is only used when auth is disabled.
"""

import httpx
import pytest

TEST_PASSWORD = "e2e-test-password-xyz"


@pytest.fixture()
def base(client):
    """Return the base URL string from the session-scoped client."""
    return str(client.base_url)


@pytest.fixture(autouse=True)
def _ensure_password_cleared(base):
    """Ensure password is cleared before and after every test in this module."""
    # Before: clear with an unauthenticated request (works when auth is disabled)
    # or an authenticated one (works when auth is enabled from a prior test).
    _force_clear_password(base)
    yield
    _force_clear_password(base)


def _force_clear_password(base_url: str):
    """Clear password by any means necessary — try unauthenticated first,
    then authenticate and clear."""
    with httpx.Client(base_url=base_url, timeout=30.0) as c:
        r = c.patch("/api/settings", json={"password": ""})
        if r.status_code == 200:
            return
        # Auth is enabled — need to login first
        r2 = c.post("/api/auth/login", json={"password": TEST_PASSWORD})
        if r2.status_code == 200:
            c.patch("/api/settings", json={"password": ""})


def _setup_auth_and_login(base_url: str) -> httpx.Client:
    """Create a client, set password, login, return the authenticated client.

    Caller is responsible for closing the client.
    """
    c = httpx.Client(base_url=base_url, timeout=30.0)
    c.patch("/api/settings", json={"password": TEST_PASSWORD})
    c.post("/api/auth/login", json={"password": TEST_PASSWORD})
    return c


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_auth_status_when_no_password(base):
    """When no password is set, auth should be disabled."""
    with httpx.Client(base_url=base, timeout=30.0) as c:
        r = c.get("/api/auth/status")
        assert r.status_code == 200
        data = r.json()
        assert data["enabled"] is False
        assert data["authenticated"] is True


def test_set_password_via_settings(base):
    """PATCH /api/settings with password field enables auth."""
    with httpx.Client(base_url=base, timeout=30.0) as c:
        r = c.patch("/api/settings", json={"password": TEST_PASSWORD})
        assert r.status_code == 200

        # Login to check settings
        c.post("/api/auth/login", json={"password": TEST_PASSWORD})
        r2 = c.get("/api/settings")
        assert r2.status_code == 200
        assert r2.json()["passwordSet"] is True


def test_auth_status_when_enabled(base):
    """When password is set, unauthenticated status shows enabled=True, authenticated=False."""
    with httpx.Client(base_url=base, timeout=30.0) as c:
        c.patch("/api/settings", json={"password": TEST_PASSWORD})

    # Fresh client without cookies
    with httpx.Client(base_url=base, timeout=30.0) as fresh:
        r = fresh.get("/api/auth/status")
        assert r.status_code == 200
        data = r.json()
        assert data["enabled"] is True
        assert data["authenticated"] is False


def test_login_correct_password(base):
    """POST /api/auth/login with correct password returns 200 + cookie."""
    with httpx.Client(base_url=base, timeout=30.0) as c:
        c.patch("/api/settings", json={"password": TEST_PASSWORD})
        r = c.post("/api/auth/login", json={"password": TEST_PASSWORD})
        assert r.status_code == 200
        assert r.json()["ok"] is True
        assert "lumbergh_session" in r.cookies


def test_login_wrong_password(base):
    """POST /api/auth/login with wrong password returns 401."""
    with httpx.Client(base_url=base, timeout=30.0) as c:
        c.patch("/api/settings", json={"password": TEST_PASSWORD})
        r = c.post("/api/auth/login", json={"password": "wrong-password"})
        assert r.status_code == 401
        assert "Invalid password" in r.json().get("detail", "")


def test_authenticated_request_works(base):
    """With valid auth cookie, protected endpoints return 200."""
    c = _setup_auth_and_login(base)
    try:
        r = c.get("/api/sessions")
        assert r.status_code == 200
    finally:
        c.close()


def test_unauthenticated_request_blocked(base):
    """Without auth cookie, protected endpoints return 401."""
    # Set password via a temporary client
    with httpx.Client(base_url=base, timeout=30.0) as c:
        c.patch("/api/settings", json={"password": TEST_PASSWORD})

    # Fresh client — no cookies
    with httpx.Client(base_url=base, timeout=30.0) as fresh:
        r = fresh.get("/api/sessions")
        assert r.status_code == 401


def test_logout_clears_session(base):
    """POST /api/auth/logout invalidates session, subsequent requests 401."""
    c = _setup_auth_and_login(base)
    try:
        # Verify authenticated
        r = c.get("/api/sessions")
        assert r.status_code == 200

        # Logout
        r2 = c.post("/api/auth/logout")
        assert r2.status_code == 200

        # Should be blocked now
        r3 = c.get("/api/sessions")
        assert r3.status_code == 401
    finally:
        c.close()


def test_health_exempt_from_auth(base):
    """GET /api/health should always return 200 regardless of auth state."""
    # Set password
    with httpx.Client(base_url=base, timeout=30.0) as c:
        c.patch("/api/settings", json={"password": TEST_PASSWORD})

    # Unauthenticated client
    with httpx.Client(base_url=base, timeout=30.0) as fresh:
        r = fresh.get("/api/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"
