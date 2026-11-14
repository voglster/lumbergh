import json
import subprocess

import pytest

from lumbergh import bill_nudge, overseer_webhook


@pytest.fixture(autouse=True)
def piper_env(monkeypatch):
    monkeypatch.setenv(overseer_webhook.PIPER_ENV, "1")
    monkeypatch.delenv(overseer_webhook.URL_ENV, raising=False)
    monkeypatch.setattr(overseer_webhook, "sherpa_bin", lambda: "sherpa")
    overseer_webhook.reset_backoff()
    yield
    overseer_webhook.reset_backoff()


@pytest.fixture
def sherpa(monkeypatch):
    """Stands in for `sherpa piper`, recording each argv and answering as told."""
    calls = []
    answer = {"stdout": json.dumps({"sent": True, "status": 200}), "returncode": 0, "raise": None}

    def run(argv, **_kwargs):
        calls.append(argv)
        if answer["raise"] is not None:
            raise answer["raise"]
        return subprocess.CompletedProcess(argv, answer["returncode"], answer["stdout"], "")

    monkeypatch.setattr(overseer_webhook.subprocess, "run", run)
    return calls, answer


def _entry(name, state, why):
    return {"name": name, "role": "worker", "state": state, "why": why}


def test_piper_alone_turns_outside_supervision_on():
    assert overseer_webhook.configured()


def test_unset_flag_leaves_piper_off(monkeypatch):
    monkeypatch.setenv(overseer_webhook.PIPER_ENV, "0")
    assert not overseer_webhook.configured()


def test_attention_tells_piper_the_reason_sessions_and_kind(sherpa):
    calls, _ = sherpa
    sessions = [
        _entry("fix-login", "blocked", "blocked"),
        _entry("kb-9", "idle", "finished a chunk"),
    ]

    assert overseer_webhook.post("attention", "Needs you: fix-login (blocked)", "do it", sessions)

    assert calls == [
        [
            "sherpa",
            "piper",
            "Needs you: fix-login (blocked)",
            "--session",
            "fix-login,kb-9",
            "--kind",
            "blocked",
            "--json",
        ]
    ]


@pytest.mark.parametrize(
    ("kind", "sessions", "expected"),
    [
        ("attention", [_entry("a", "idle", "finished a chunk")], "done"),
        ("attention", [_entry("a", "idle", "idle holding uncommitted work")], "blocked"),
        ("attention", [_entry("a", "undelivered", "undelivered")], "blocked"),
        ("attention", [_entry("a", "blocked", "blocked"), _entry("b", "error", "error")], "error"),
        ("babysit_broken", [_entry("port", "error", "no live agent")], "error"),
        ("babysit_idle", [_entry("port", "idle", "babysat, idle")], "blocked"),
        ("heartbeat", [], None),
    ],
)
def test_each_tap_maps_to_a_piper_kind(kind, sessions, expected):
    assert overseer_webhook.piper_kind(kind, sessions) == expected


def test_the_calm_fleet_heartbeat_never_wakes_piper_but_counts_as_delivered(sherpa):
    calls, _ = sherpa

    assert bill_nudge.heartbeat_nudge()

    assert calls == []


def test_a_session_is_always_named_so_sherpa_never_guesses_its_own_tmux(sherpa):
    calls, _ = sherpa

    overseer_webhook.post("attention", "Needs you", "do it", [])

    assert calls[0][calls[0].index("--session") + 1] == "lumbergh"


@pytest.mark.parametrize(
    "answer",
    [
        {"stdout": json.dumps({"sent": False, "status": 401})},
        {"stdout": "error: missing vault key(s) PIPER_WEBHOOK_URL", "returncode": 2},
        {"raise": subprocess.TimeoutExpired("sherpa", 20)},
        {"raise": FileNotFoundError("sherpa")},
    ],
)
def test_an_undelivered_note_fails_and_holds_off_the_next(sherpa, answer):
    calls, outcome = sherpa
    outcome.update(answer)

    assert not overseer_webhook.post("babysit_broken", "Babysat port has no live agent", "", [])
    assert not overseer_webhook.post("babysit_broken", "Babysat port has no live agent", "", [])

    assert len(calls) == 1


def test_broken_babysit_nudge_reaches_piper_as_an_error(sherpa):
    calls, _ = sherpa

    assert bill_nudge.broken_babysit_nudge("port")

    (argv,) = calls
    assert argv[2] == "Babysat port has no live agent"
    assert argv[argv.index("--kind") + 1] == "error"
    assert argv[argv.index("--session") + 1] == "port"
