"""Extended dashboard feature step definitions."""

import httpx
from playwright.sync_api import Page, expect
from pytest_bdd import given, parsers, scenarios, then, when

scenarios("features/dashboard_extended.feature")


# Re-register shared steps needed by this feature's scenarios.
# pytest-bdd requires step definitions to be in the same module or conftest.


@when("I click the new session button")
def click_new_session(page: Page):
    page.locator('[data-testid="new-session-btn"]').click()


@when(parsers.parse('I enter session name "{name}" in the create modal'))
def enter_session_name(page: Page, name: str):
    inp = page.locator('[data-testid="session-name-input"]')
    inp.fill(name)


@then(parsers.parse('I should see the session card for "{name}"'))
def see_session_card(page: Page, name: str):
    card = page.locator(f'[data-testid="session-card-{name}"]')
    expect(card).to_be_visible(timeout=10000)


@given("all test sessions are cleaned up")
def cleanup_all_sessions(base_url: str, _ensure_test_session):
    """Delete all sessions so the dashboard shows the empty state.

    The _ensure_test_session fixture is included so it runs first and the
    session-scoped setup/teardown still works.  We delete everything here;
    the session-scoped finalizer on _ensure_test_session will recreate the
    test session at the end of the test run.
    """
    with httpx.Client(base_url=base_url, timeout=30.0) as client:
        r = client.get("/api/sessions")
        for session in r.json().get("sessions", []):
            client.delete(f"/api/sessions/{session['name']}")


@then("I should see the empty state message")
def see_empty_state(page: Page, base_url: str, repo_dir: str):
    # Reload to pick up the deletion
    page.reload()
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text("No sessions yet")).to_be_visible(timeout=10000)

    # Recreate the test session so subsequent scenarios that depend on it work.
    # The session-scoped _ensure_test_session fixture won't re-run mid-session.
    with httpx.Client(base_url=base_url, timeout=30.0) as client:
        client.post(
            "/api/sessions",
            json={"name": "e2e-ui-session", "workdir": f"{repo_dir}/test-repo"},
        )


@when(parsers.parse('I enter manual workdir "{path}"'))
def enter_manual_workdir(page: Page, path: str):
    page.get_by_text("Enter path manually").click()
    inp = page.locator('[data-testid="workdir-input"]')
    inp.fill(path)
    # Wait for directory validation to complete
    page.wait_for_timeout(1500)


@then("the create button should be disabled or show directory not found")
def create_button_disabled_or_not_found(page: Page):
    btn = page.locator('[data-testid="create-session-submit"]')
    not_found = page.get_by_text("Directory not found")

    # Either the button is disabled or the "Directory not found" text is shown
    is_disabled = btn.is_disabled()
    is_not_found = not_found.is_visible()
    assert is_disabled or is_not_found, (
        f"Expected create button to be disabled ({is_disabled}) "
        f"or 'Directory not found' to be visible ({is_not_found})"
    )


@given("I am on the dashboard with mobile viewport")
def go_to_dashboard_mobile(page: Page, base_url: str):
    """Resize the existing page to a mobile viewport (iPhone-sized) and navigate."""
    page.set_viewport_size({"width": 375, "height": 812})
    page.goto(base_url)
    page.wait_for_load_state("networkidle")


@then("the page should not have horizontal scroll")
def no_horizontal_scroll(page: Page):
    has_no_overflow = page.evaluate(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
    )
    assert has_no_overflow, (
        f"Page has horizontal scroll: scrollWidth="
        f"{page.evaluate('document.documentElement.scrollWidth')}, "
        f"clientWidth={page.evaluate('document.documentElement.clientWidth')}"
    )
