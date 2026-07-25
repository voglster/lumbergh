"""Dashboard feature step definitions."""

import httpx
from playwright.sync_api import Page, expect
from pytest_bdd import parsers, scenarios, then, when

scenarios("features/dashboard.feature")


# Steps shared with dashboard_extended.feature live in conftest.py - see the
# note there. Only steps this feature alone uses belong in this module.


@then(parsers.parse('I should not see the session card for "{name}"'))
def not_see_session_card(page: Page, name: str):
    card = page.locator(f'[data-testid="session-card-{name}"]')
    expect(card).not_to_be_visible(timeout=10000)


@then("I should see the create session modal")
def see_create_modal(page: Page):
    modal = page.locator('[data-testid="create-session-modal"]')
    expect(modal).to_be_visible(timeout=5000)


@when("I enter the test-repo-2 workdir in the create modal")
def enter_workdir(page: Page, repo_dir: str):
    # Default view shows DirectoryPicker search; switch to manual entry
    page.get_by_text("Enter path manually").click()
    inp = page.locator('[data-testid="workdir-input"]')
    inp.fill(f"{repo_dir}/test-repo-2")


@when(parsers.parse('I delete the session "{name}"'))
def delete_session(page: Page, base_url: str, name: str):
    # Use API to delete — UI delete involves confirmation modal which varies
    with httpx.Client(base_url=base_url, timeout=10.0) as client:
        client.delete(f"/api/sessions/{name}")
    page.goto(base_url)
    page.wait_for_load_state("networkidle")
