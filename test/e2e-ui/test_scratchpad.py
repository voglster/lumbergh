"""Scratchpad feature step definitions."""

import time

import httpx
from playwright.sync_api import Page, expect
from pytest_bdd import given, parsers, scenarios, then, when

scenarios("features/session_scratchpad.feature")


@given("a second test session exists")
def ensure_second_session(_ensure_second_session):
    """Relies on the session-scoped fixture from conftest."""
    pass


@given(parsers.parse('session "{name}" has scratchpad content "{content}"'))
def set_backend_scratchpad(
    base_url: str,
    name: str,
    content: str,
    _ensure_test_session,
    _ensure_second_session,
):
    with httpx.Client(base_url=base_url, timeout=10.0) as client:
        r = client.post(
            f"/api/sessions/{name}/scratchpad", json={"content": content}
        )
        assert r.status_code == 200, f"Failed to seed scratchpad: {r.text}"


@given(parsers.parse('the scratchpad GET for "{name}" is delayed by {ms:d} ms'))
def delay_scratchpad_get(page: Page, name: str, ms: int):
    pattern = f"**/api/sessions/{name}/scratchpad"

    def handler(route, request):
        if request.method == "GET":
            time.sleep(ms / 1000)
        route.continue_()

    page.route(pattern, handler)


@when(parsers.parse('I open the session page for "{name}" without waiting'))
def open_session_no_wait(page: Page, base_url: str, name: str):
    page.goto(f"{base_url}/session/{name}", wait_until="domcontentloaded")


@when(parsers.parse('I switch in-app to the session page for "{name}"'))
def spa_switch_session(page: Page, name: str):
    # In-app SPA navigation: triggers React Router without unmounting SessionDetail,
    # which is the only way to reproduce the stale-fetch race (full page reloads
    # tear down the in-flight fetch).
    page.evaluate(
        """(target) => {
            window.history.pushState({}, '', target);
            window.dispatchEvent(new PopStateEvent('popstate'));
        }""",
        f"/session/{name}",
    )
    page.wait_for_timeout(200)


@when(parsers.parse('I click the "{tab_name}" tab without waiting'))
def click_tab_no_wait(page: Page, tab_name: str):
    tab = page.locator(f'[data-testid="tab-{tab_name}"]')
    tab.click()


@when(parsers.parse("I wait {ms:d} ms"))
def wait_ms(page: Page, ms: int):
    page.wait_for_timeout(ms)


@then(
    parsers.parse(
        'session "{name}" backend scratchpad should not contain "{text}"'
    )
)
def backend_scratchpad_not_contains(base_url: str, name: str, text: str):
    with httpx.Client(base_url=base_url, timeout=10.0) as client:
        r = client.get(f"/api/sessions/{name}/scratchpad")
        assert r.status_code == 200, r.text
        assert text not in r.json().get("content", ""), (
            f"Backend scratchpad for {name} unexpectedly contained: {text!r}"
        )


@when(parsers.parse('I type "{text}" in the scratchpad'))
def type_in_scratchpad(page: Page, text: str):
    textarea = page.locator('[data-testid="scratchpad-textarea"]')
    expect(textarea).to_be_visible(timeout=5000)
    textarea.fill(text)
    # Wait for debounced save to trigger (500ms debounce + buffer)
    page.wait_for_timeout(1000)


@then(parsers.parse('the scratchpad should contain "{text}"'))
def scratchpad_contains(page: Page, text: str):
    textarea = page.locator('[data-testid="scratchpad-textarea"]')
    expect(textarea).to_have_value(text, timeout=5000)


@then(parsers.parse('the scratchpad should not contain "{text}"'))
def scratchpad_not_contains(page: Page, text: str):
    textarea = page.locator('[data-testid="scratchpad-textarea"]')
    expect(textarea).to_be_visible(timeout=5000)
    expect(textarea).not_to_have_value(text, timeout=5000)
