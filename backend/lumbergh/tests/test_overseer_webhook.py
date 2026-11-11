import asyncio
import time

import httpx
import pytest

from lumbergh import bill_nudge, overseer_webhook
from lumbergh.idle_monitor import IdleMonitor

URL = "https://hooks.example/lumbergh"


@pytest.fixture(autouse=True)
def webhook_env(monkeypatch):
    monkeypatch.setenv(overseer_webhook.URL_ENV, URL)
    monkeypatch.setenv(overseer_webhook.KEY_ENV, "s3cret")
    monkeypatch.delenv(overseer_webhook.HEADER_ENV, raising=False)
    overseer_webhook.reset_backoff()
    yield
    overseer_webhook.reset_backoff()


def _receiver(status=200, raises=None):
    """A real httpx client on a mock transport, recording what reached the receiver."""
    received = []

    def handle(request: httpx.Request) -> httpx.Response:
        if raises:
            raise raises
        received.append(request)
        return httpx.Response(status)

    client = httpx.Client(transport=httpx.MockTransport(handle))
    return client.post, received


def test_key_defaults_to_a_bearer_authorization_header():
    assert overseer_webhook.headers() == {"Authorization": "Bearer s3cret"}


def test_a_named_header_carries_the_raw_key(monkeypatch):
    monkeypatch.setenv(overseer_webhook.HEADER_ENV, "X-Webhook-Secret")
    assert overseer_webhook.headers() == {"X-Webhook-Secret": "s3cret"}


def test_a_key_that_already_names_its_scheme_is_sent_as_given(monkeypatch):
    monkeypatch.setenv(overseer_webhook.KEY_ENV, "Token abc")
    assert overseer_webhook.headers() == {"Authorization": "Token abc"}


def test_no_key_sends_no_auth_header(monkeypatch):
    monkeypatch.delenv(overseer_webhook.KEY_ENV)
    assert overseer_webhook.headers() == {}


def test_unset_url_means_not_configured(monkeypatch):
    monkeypatch.delenv(overseer_webhook.URL_ENV)
    assert not overseer_webhook.configured()


def test_post_delivers_the_documented_body():
    send, received = _receiver()

    assert overseer_webhook.post("attention", "Needs you", "do it", [{"name": "w"}], send=send)

    (request,) = received
    assert str(request.url) == URL
    assert request.headers["Authorization"] == "Bearer s3cret"
    body = httpx.Response(200, content=request.content).json()
    assert body["kind"] == "attention"
    assert body["reason"] == "Needs you"
    assert body["message"] == "do it"
    assert body["sessions"] == [{"name": "w"}]
    assert body["source"] == "lumbergh"
    assert body["timestamp"].endswith("+00:00")


def test_a_rejected_post_reports_failure_and_holds_off_the_next():
    send, received = _receiver(status=500)

    assert not overseer_webhook.post("heartbeat", "r", "m", [], send=send)
    assert not overseer_webhook.post("heartbeat", "r", "m", [], send=send)

    assert len(received) == 1, "a down receiver must not be hit on every sweep"


def test_an_unreachable_receiver_reports_failure():
    send, _ = _receiver(raises=httpx.ConnectError("refused"))
    assert not overseer_webhook.post("heartbeat", "r", "m", [], send=send)


def test_the_key_never_reaches_the_log(caplog):
    send, _ = _receiver(status=401)
    overseer_webhook.post("heartbeat", "r", "m", [], send=send)
    assert "s3cret" not in caplog.text


@pytest.fixture
def posted(monkeypatch):
    calls = []

    def record(kind, reason, message, sessions, **_kwargs):
        calls.append({"kind": kind, "reason": reason, "message": message, "sessions": sessions})
        return True

    monkeypatch.setattr(overseer_webhook, "post", record)
    return calls


def _never_type(_ref, _text):
    raise AssertionError("webhook mode must not type into Bill's pane")


def test_each_nudge_posts_instead_of_typing(posted):
    blocked = {"role": "worker", "task": "w1", "session": "w1", "state": "blocked"}

    bill_nudge.nudge([blocked], send=_never_type)
    bill_nudge.heartbeat_nudge(send=_never_type)
    bill_nudge.advance_nudge("port", send=_never_type)
    bill_nudge.broken_babysit_nudge("port", send=_never_type)

    assert [c["kind"] for c in posted] == [
        "attention",
        "heartbeat",
        "babysit_idle",
        "babysit_broken",
    ]
    assert posted[0]["sessions"] == [
        {"name": "w1", "role": "worker", "state": "blocked", "why": "blocked"}
    ]
    assert "w1 (blocked)" in posted[0]["reason"]
    assert posted[2]["sessions"][0]["name"] == "port"
    assert "lb babysit --refresh --session port" in posted[2]["message"]


def test_without_the_url_nudges_still_type_into_bill(monkeypatch, posted):
    monkeypatch.delenv(overseer_webhook.URL_ENV)
    typed = []

    assert bill_nudge.heartbeat_nudge(send=lambda ref, _text: typed.append(ref) or True)

    assert typed == ["bill:{start}"]
    assert posted == []


def _overseer(state, task="port", unseen=False):
    return {
        "role": "overseer",
        "task": task,
        "session": task,
        "state": state,
        "unseen": unseen,
        "watched": True,
    }


@pytest.fixture
def fleet(monkeypatch):
    state = {"rows": []}
    monkeypatch.setattr("lumbergh.routers.bill._fleet_rows", lambda _origin, **_kw: state["rows"])
    monkeypatch.setattr("lumbergh.babysit.babysat_sessions", lambda: set())
    from lumbergh.routers.bill import _overseer_acked

    _overseer_acked.clear()
    return state


@pytest.fixture
def monitor():
    return IdleMonitor()


async def _sweep(monitor: IdleMonitor):
    monitor._bill_nudge_checked_at = 0.0
    await monitor._maybe_nudge_bill(asyncio.get_event_loop())


async def test_attention_posts_with_no_bill_session_at_all(monitor, fleet, posted):
    fleet["rows"] = [_overseer("blocked")]

    await _sweep(monitor)

    assert [c["kind"] for c in posted] == ["attention"]


async def test_a_standing_blocker_posts_once(monitor, fleet, posted):
    fleet["rows"] = [_overseer("blocked")]

    for _ in range(4):
        await _sweep(monitor)

    assert len(posted) == 1


async def test_a_new_blocker_posts_again_naming_both(monitor, fleet, posted):
    fleet["rows"] = [_overseer("blocked")]
    await _sweep(monitor)

    fleet["rows"] = [_overseer("blocked"), _overseer("error", task="issue-9")]
    await _sweep(monitor)

    assert len(posted) == 2
    assert {s["name"] for s in posted[1]["sessions"]} == {"port", "issue-9"}


async def test_a_blocker_that_clears_and_returns_posts_again(monitor, fleet, posted):
    fleet["rows"] = [_overseer("blocked")]
    await _sweep(monitor)
    fleet["rows"] = [_overseer("working")]
    await _sweep(monitor)
    fleet["rows"] = [_overseer("blocked")]
    await _sweep(monitor)

    assert len(posted) == 2


async def test_a_failed_attention_post_is_retried(monitor, fleet, monkeypatch):
    fleet["rows"] = [_overseer("blocked")]
    outcomes = iter([False, True])
    calls = []
    monkeypatch.setattr(
        overseer_webhook, "post", lambda *a, **_k: calls.append(a[0]) or next(outcomes)
    )

    await _sweep(monitor)
    await _sweep(monitor)
    await _sweep(monitor)

    assert calls == ["attention", "attention"]


@pytest.mark.usefixtures("fleet")
async def test_no_heartbeat_right_after_startup(monitor, posted):
    await _sweep(monitor)
    assert posted == []


@pytest.mark.usefixtures("fleet")
async def test_heartbeat_comes_every_thirty_minutes_and_no_sooner(monitor, posted):
    monitor._started_at = time.time() - monitor.OVERSEER_WEBHOOK_HEARTBEAT_INTERVAL_SECONDS - 1

    await _sweep(monitor)
    await _sweep(monitor)
    assert [c["kind"] for c in posted] == ["heartbeat"]

    monitor._last_bill_nudge_at -= monitor.OVERSEER_WEBHOOK_HEARTBEAT_INTERVAL_SECONDS - 60
    await _sweep(monitor)
    assert len(posted) == 1, "29 minutes after the last check-in is still too soon"

    monitor._last_bill_nudge_at -= 61
    await _sweep(monitor)
    assert len(posted) == 2


async def test_heartbeat_holds_back_while_something_needs_attention(monitor, fleet, posted):
    monitor._started_at = time.time() - monitor.OVERSEER_WEBHOOK_HEARTBEAT_INTERVAL_SECONDS - 1
    fleet["rows"] = [_overseer("blocked")]

    await _sweep(monitor)
    monitor._last_bill_nudge_at -= monitor.OVERSEER_WEBHOOK_HEARTBEAT_INTERVAL_SECONDS + 1
    await _sweep(monitor)

    assert [c["kind"] for c in posted] == ["attention"]


@pytest.mark.usefixtures("fleet")
async def test_a_broken_babysit_is_posted_once(monitor, posted):
    monitor._babysit_broken = {"port"}

    await _sweep(monitor)
    await _sweep(monitor)

    assert [c["kind"] for c in posted] == ["babysit_broken"]
    assert posted[0]["sessions"][0]["name"] == "port"
