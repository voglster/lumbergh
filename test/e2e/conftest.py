"""E2E test fixtures for Lumbergh API."""

import uuid

import httpx
import pytest


def pytest_addoption(parser):
    parser.addoption(
        "--base-url",
        default="http://localhost:18420",
        help="Base URL for the Lumbergh API",
    )


@pytest.fixture(scope="session")
def base_url(request):
    return request.config.getoption("--base-url")


@pytest.fixture(scope="session")
def client(base_url):
    with httpx.Client(base_url=base_url, timeout=30.0) as c:
        yield c


@pytest.fixture(scope="session")
def test_session(client):
    """Create a session pointing at /home/test/test-repo, clean up after."""
    name = f"e2e-test-{uuid.uuid4().hex[:8]}"
    r = client.post(
        "/api/sessions",
        json={"name": name, "workdir": "/home/test/test-repo"},
    )
    assert r.status_code == 200, f"Failed to create session: {r.text}"
    yield name
    client.delete(f"/api/sessions/{name}")


@pytest.fixture(scope="session")
def second_session(client):
    """Create a second session pointing at /home/test/test-repo-2."""
    name = f"e2e-test2-{uuid.uuid4().hex[:8]}"
    r = client.post(
        "/api/sessions",
        json={"name": name, "workdir": "/home/test/test-repo-2"},
    )
    assert r.status_code == 200, f"Failed to create second session: {r.text}"
    yield name
    client.delete(f"/api/sessions/{name}")


@pytest.fixture(scope="module")
def git_session(client):
    """Dedicated session for git mutation tests, using /home/test/git-test-repo."""
    name = f"e2e-git-{uuid.uuid4().hex[:8]}"
    r = client.post(
        "/api/sessions",
        json={"name": name, "workdir": "/home/test/git-test-repo"},
    )
    assert r.status_code == 200, f"Failed to create git session: {r.text}"
    yield name
    client.delete(f"/api/sessions/{name}")
