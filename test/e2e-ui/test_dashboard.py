"""Dashboard feature step definitions."""

import httpx
from playwright.sync_api import Page, expect
from pytest_bdd import parsers, scenarios, then, when

scenarios("features/dashboard.feature")


@then(parsers.parse('I should see the session card for "{name}"'))
def see_session_card(page: Page, name: str):
    card = page.locator(f'[data-testid="session-card-{name}"]')
    expect(card).to_be_visible(timeout=10000)


@then(parsers.parse('I should not see the session card for "{name}"'))
def not_see_session_card(page: Page, name: str):
    card = page.locator(f'[data-testid="session-card-{name}"]')
    expect(card).not_to_be_visible(timeout=10000)


@when("I click the new session button")
def click_new_session(page: Page):
    page.locator('[data-testid="new-session-btn"]').click()


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


@then(parsers.parse('I should be on the session page for "{name}"'))
def on_session_page(page: Page, name: str):
    # The app navigates to /session/{name} after creation
    page.wait_for_url(f"**/session/{name}", timeout=10000)
    # Terminal container should be visible on the session detail page
    terminal = page.locator('[data-testid="terminal-container"]')
    expect(terminal).to_be_visible(timeout=10000)


@when(parsers.parse('I delete the session "{name}"'))
def delete_session(page: Page, base_url: str, name: str):
    # Use API to delete — UI delete involves confirmation modal which varies
    with httpx.Client(base_url=base_url, timeout=10.0) as client:
        client.delete(f"/api/sessions/{name}")
    page.goto(base_url)
    page.wait_for_load_state("networkidle")
