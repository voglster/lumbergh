"""Terminal feature step definitions."""

from playwright.sync_api import Page, expect
from pytest_bdd import parsers, scenarios, then, when

scenarios("features/session_terminal.feature")


@when(parsers.parse('I click on the session "{name}"'))
def click_session_card(page: Page, name: str):
    card = page.locator(f'[data-testid="session-card-{name}"]')
    card.click()
    page.wait_for_load_state("networkidle")


@then("I should see the terminal container")
def see_terminal_container(page: Page):
    container = page.locator('[data-testid="terminal-container"]')
    expect(container).to_be_visible(timeout=10000)


@then("I should see the xterm terminal")
def see_xterm(page: Page):
    xterm = page.locator('[data-testid="xterm-container"]')
    expect(xterm).to_be_visible(timeout=10000)


@then("I should see the git tab content")
def see_git_tab(page: Page):
    git_tab = page.locator('[data-testid="git-tab"]')
    expect(git_tab).to_be_visible(timeout=10000)


@then("I should see the todo input")
def see_todo_input(page: Page):
    inp = page.locator('[data-testid="todo-input"]')
    expect(inp).to_be_visible(timeout=10000)


# ── Issue #24: the wheel must not inject keystrokes into a plain shell ────

# PageUp / PageDown. The client wraps terminal input in JSON, so ESC reaches
# the wire JSON-escaped; the raw forms are matched too in case the framing
# ever changes.
PAGE_KEYS = ("\\u001b[5~", "\\u001b[6~", "\x1b[5~", "\x1b[6~")


@when("I record terminal websocket frames", target_fixture="sent_ws_frames")
def record_ws_frames(page: Page) -> list[str]:
    """Attach a frame recorder before the terminal WebSocket is opened.

    Must run before navigating to the session: the socket connects as soon as
    the Terminal component mounts, and a listener attached afterwards sees
    nothing.
    """
    sent: list[str] = []

    def record(payload) -> None:
        # Playwright hands the frame payload through as str or bytes.
        sent.append(payload if isinstance(payload, str) else payload.decode("utf-8", "replace"))

    page.on("websocket", lambda ws: ws.on("framesent", record))
    return sent


@when("I scroll the terminal with the wheel")
def scroll_terminal_with_wheel(page: Page):
    """Two-finger-swipe-style wheel burst over the middle of the pane."""
    xterm = page.locator('[data-testid="xterm-container"]')
    expect(xterm).to_be_visible(timeout=10000)
    box = xterm.bounding_box()
    assert box is not None, "xterm container has no bounding box"
    # Count the wheel events that actually land on the pane. An overlay or a
    # layout change can swallow the whole gesture, and then "no page keys were
    # sent" would be true for the wrong reason. Capture phase on the container
    # runs before the component's own listener on xterm's root, so its
    # stopPropagation() cannot hide the event from this counter.
    page.evaluate("""() => {
      window.__wheelHits = 0
      document
        .querySelector('[data-testid="xterm-container"]')
        .addEventListener('wheel', () => { window.__wheelHits += 1 }, { capture: true, passive: true })
    }""")
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    # Many small deltas, the way a macOS trackpad two-finger swipe arrives.
    for _ in range(40):
        page.mouse.wheel(0, -3)
    page.wait_for_timeout(500)
    assert page.evaluate("window.__wheelHits"), (
        "no wheel event reached the terminal pane - the gesture under test never happened"
    )


@then("no page-key escape sequences are sent to the session")
def no_page_keys_sent(sent_ws_frames: list[str]):
    # Guard against a vacuous pass: the client always sends activate/resize
    # frames on connect, so an empty list means the recorder never saw the
    # socket and the assertion below would prove nothing.
    assert sent_ws_frames, "recorder observed no websocket frames at all"
    offenders = [f for f in sent_ws_frames if any(k in f for k in PAGE_KEYS)]
    assert not offenders, f"client injected page keys into a plain shell: {offenders}"
