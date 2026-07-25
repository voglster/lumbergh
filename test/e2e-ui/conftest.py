"""Playwright E2E test configuration and shared step definitions."""

import httpx
import pytest
from playwright.sync_api import Browser, BrowserContext, Page, expect, sync_playwright
from pytest_bdd import given, parsers, then, when


def pytest_addoption(parser):
    parser.addoption(
        "--base-url",
        default="http://localhost:8420",
        help="Base URL for the Lumbergh UI",
    )
    parser.addoption(
        "--repo-dir",
        default="/home/test",
        help="Directory containing test-repo, test-repo-2, git-test-repo",
    )


@pytest.fixture(scope="session")
def base_url(request):
    return request.config.getoption("--base-url")


@pytest.fixture(scope="session")
def repo_dir(request):
    return request.config.getoption("--repo-dir")


@pytest.fixture(scope="session", autouse=True)
def _settle_telemetry_consent(base_url):
    """Record a telemetry decision so the first-run consent modal stays shut.

    What this does: PATCHes `telemetryConsent: false` on the server under test
    before any scenario runs.

    Why: a fresh install has no `telemetryConsent` at all, and `GET
    /api/settings` omits the field, so the session page reads it as null and
    pops the `TelemetryOptIn` consent modal - a `fixed inset-0 z-50` overlay.
    That overlay intercepts pointer events across the whole viewport, which
    broke 9 of the 18 UI scenarios on a fresh environment (including the
    project's own QEMU VM, where settings always start empty). Worse than the
    failures: a scenario that drives the mouse can still pass while the overlay
    silently eats the gesture, proving nothing at all.

    It declines rather than accepts, so this can never switch real telemetry
    on.

    Known side effect: the decision persists in the settings store the tests
    ran against. On a throwaway VM that is irrelevant, but running the suite
    against your own dev server writes `telemetryConsent: false` into
    ~/.config/lumbergh/settings.json and leaves it there. It cannot be undone
    from here: the PATCH model treats None as "field not provided", so there is
    no way to express "put it back to undecided" through the API. If you later
    wonder why telemetry is off and you were never asked, this fixture is why -
    re-enable it in Settings, or delete the key from settings.json to get the
    prompt back.
    """
    with httpx.Client(base_url=base_url, timeout=10.0) as client:
        r = client.patch("/api/settings", json={"telemetryConsent": False})
        assert r.status_code == 200, f"Failed to settle telemetry consent: {r.text}"


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture(scope="function")
def context(browser: Browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    yield ctx
    ctx.close()


@pytest.fixture(scope="function")
def page(context: BrowserContext, base_url: str):
    pg = context.new_page()
    pg.goto(base_url)
    yield pg
    pg.close()


@pytest.fixture(scope="session")
def _ensure_test_session(base_url, repo_dir):
    """Create a test session via API so UI tests have something to interact with."""
    session_name = "e2e-ui-session"
    with httpx.Client(base_url=base_url, timeout=30.0) as client:
        # Delete if exists from a previous run
        client.delete(f"/api/sessions/{session_name}")

        r = client.post(
            "/api/sessions",
            json={"name": session_name, "workdir": f"{repo_dir}/test-repo"},
        )
        assert r.status_code == 200, f"Failed to create test session: {r.text}"

        yield session_name

        client.delete(f"/api/sessions/{session_name}")


@pytest.fixture(scope="session")
def _ensure_second_session(base_url, repo_dir):
    """Create a second test session for multi-session UI tests."""
    session_name = "e2e-ui-session-2"
    with httpx.Client(base_url=base_url, timeout=30.0) as client:
        client.delete(f"/api/sessions/{session_name}")

        r = client.post(
            "/api/sessions",
            json={"name": session_name, "workdir": f"{repo_dir}/test-repo-2"},
        )
        assert r.status_code == 200, f"Failed to create second session: {r.text}"

        yield session_name

        client.delete(f"/api/sessions/{session_name}")


# ── Shared Step Definitions (available to all feature files) ──────────


@given("I am on the dashboard")
def go_to_dashboard(page: Page, base_url: str):
    page.goto(base_url)
    page.wait_for_load_state("networkidle")


@given("a test session exists")
def ensure_test_session(_ensure_test_session):
    """Relies on the session-scoped fixture from conftest."""
    pass


@given(parsers.parse('a session "{name}" exists'))
def ensure_named_session(base_url: str, name: str):
    """Verify session exists via API."""
    with httpx.Client(base_url=base_url, timeout=10.0) as client:
        r = client.get("/api/sessions")
        names = [s["name"] for s in r.json()["sessions"]]
        assert name in names, f"Session '{name}' not found in {names}"


@given(parsers.parse('I am on the session page for "{name}"'))
def go_to_session_page(page: Page, base_url: str, _ensure_test_session, name: str):
    page.goto(f"{base_url}/session/{name}")
    page.wait_for_load_state("networkidle")


@when(parsers.parse('I click the "{tab_name}" tab'))
def click_tab(page: Page, tab_name: str):
    tab = page.locator(f'[data-testid="tab-{tab_name}"]')
    tab.click()
    page.wait_for_timeout(500)


@when(parsers.parse('I navigate to the session page for "{name}"'))
def navigate_to_session(page: Page, base_url: str, name: str):
    page.goto(f"{base_url}/session/{name}")
    page.wait_for_load_state("networkidle")


# Session-creation steps. These live here rather than in test_dashboard.py
# because both dashboard.feature and dashboard_extended.feature use them, and
# pytest-bdd only resolves step definitions from the scenario's own module or
# from conftest - never across test modules. A step defined in one module and
# used by another feature file fails at collection with
# StepDefinitionNotFoundError. Steps used by a single feature stay in that
# feature's module.


@when("I click the new session button")
def click_new_session(page: Page):
    page.locator('[data-testid="new-session-btn"]').click()


@when(parsers.parse('I enter session name "{name}" in the create modal'))
def enter_session_name(page: Page, name: str):
    inp = page.locator('[data-testid="session-name-input"]')
    inp.fill(name)


@when("I submit the create session form")
def submit_create_form(page: Page):
    btn = page.locator('[data-testid="create-session-submit"]')
    # Wait for directory validation to complete and button to become enabled
    expect(btn).to_be_enabled(timeout=10000)
    btn.click()
    # After submit, the app navigates to the new session's detail page
    # Wait for the modal to close as confirmation
    modal = page.locator('[data-testid="create-session-modal"]')
    expect(modal).not_to_be_visible(timeout=15000)


@then(parsers.parse('I should see the session card for "{name}"'))
def see_session_card(page: Page, name: str):
    card = page.locator(f'[data-testid="session-card-{name}"]')
    expect(card).to_be_visible(timeout=10000)


@then(parsers.parse('I should be on the session page for "{name}"'))
def on_session_page(page: Page, name: str):
    # The app navigates to /session/{name} after creation
    page.wait_for_url(f"**/session/{name}", timeout=10000)
    # Terminal container should be visible on the session detail page
    terminal = page.locator('[data-testid="terminal-container"]')
    expect(terminal).to_be_visible(timeout=10000)
