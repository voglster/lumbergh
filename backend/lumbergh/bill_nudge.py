"""Wake Bill when he goes quiet — either with live work, or just to check in.

A model that ends its turn without re-arming ``lb fleet --wait`` would stall the whole
crew silently. The server already knows both facts, so it can just tap him on the shoulder.

Two taps, both a single tmux line (a newline would submit early and split the send):

- ``nudge`` — the *edge*: a report crossed into needing attention now. Urgent, fires once
  per idle episode.
- ``heartbeat_nudge`` — the *level*: nothing's flagged, but Bill has sat idle past his
  cadence. A routine "walk the fleet" so he never goes permanently deaf once everything has
  been acked. The idle monitor owns *when*; this owns only *what to say*.
- ``broken_babysit_nudge`` — a *fault*: a babysit is registered over a session with no live
  agent, so its loop is quietly driving nothing. He cannot fix it, so the tap tells him to
  say so to the user rather than to go poke at it.
- ``advance_nudge`` — the *level*, but pointed: a specific babysat overseer has gone plain
  idle with no sentinel, so nothing auto-refreshed it. An imperative to advance *that*
  session, not a generic check-in Bill can answer with "all quiet". The idle monitor owns
  *when* and *which*; this owns only *what to say*.

With ``LUMBERGH_OVERSEER_WEBHOOK_URL`` set, every tap goes to that webhook instead of
Bill's pane (see ``overseer_webhook``), carrying the sessions it is about so a supervisor
outside Lumbergh can act without first asking which ones.
"""

from collections.abc import Callable, Sequence

from lumbergh import fleet, overseer_webhook
from lumbergh.tmux_pty import send_text

BILL_SESSION = "bill"
_WAKE = "A task needs you — run `lb fleet` and handle it, then re-arm `lb fleet --wait`."
_HEARTBEAT = (
    "Routine check-in: run `lb fleet`, then `lb read` any session that's gone quiet or "
    "looks stuck, nudge or hand it back as needed, and re-arm `lb fleet --wait`."
)
_BROKEN_BABYSIT = (
    "Babysat `{s}` has no live agent — nothing is driving it, so its keep-alive loop is "
    "doing nothing. You cannot fix this yourself: tell the user plainly that `{s}` is "
    "babysat but not running, and ask whether to restart it or "
    "`lb babysit --stop --session {s}`. Then re-arm `lb fleet --wait`."
)
_ADVANCE = (
    "Babysat `{s}` is idle and not blocked — advance it, don't just note it: "
    "`lb read --session {s}`, then `lb babysit --refresh --session {s}` (clean handoff or "
    "context bloat), or `lb prompt --session {s}` to land delivered work and pull the next "
    "item; if it's waiting on the user or its backlog is dry, report to the user and "
    "`lb babysit --stop --session {s}`. Then re-arm `lb fleet --wait`."
)


def should_nudge(bill_state: str, rows: list[dict]) -> bool:
    if bill_state != "idle":
        return False
    # Only an overseer needing Bill re-arms him — not mere worker activity (that's the
    # overseer's job). Routed through bill_woke so the private idle+unseen ack is honored.
    from lumbergh.routers.bill import bill_woke

    return bill_woke(rows)


def _bill_ref() -> str:
    """Bill's own agent window. A bare session ref would type into whatever window of his
    session is selected."""
    from lumbergh.idle_monitor import tmux_ref

    return tmux_ref(BILL_SESSION)


def attention_reason(row: dict) -> str:
    if row["state"] in fleet.ATTENTION_STATES:
        return row["state"]
    if fleet.holding_uncommitted_work(row):
        return "idle holding uncommitted work"
    return "finished a chunk"


def session_entry(row: dict) -> dict:
    return {
        "name": row.get("session") or row["task"],
        "role": row.get("role"),
        "state": row["state"],
        "why": attention_reason(row),
    }


def nudge(needing: Sequence[dict] = (), send: Callable[[str, str], bool] = send_text) -> bool:
    if overseer_webhook.configured():
        entries = [session_entry(r) for r in needing]
        reason = "Needs you: " + ", ".join(f"{e['name']} ({e['why']})" for e in entries)
        return overseer_webhook.post("attention", reason, _WAKE, entries)
    return bool(send(_bill_ref(), _WAKE))


def heartbeat_nudge(send: Callable[[str, str], bool] = send_text) -> bool:
    if overseer_webhook.configured():
        return overseer_webhook.post(
            "heartbeat", "Routine check-in: nothing flagged", _HEARTBEAT, []
        )
    return bool(send(_bill_ref(), _HEARTBEAT))


def advance_nudge(session: str, send: Callable[[str, str], bool] = send_text) -> bool:
    text = _ADVANCE.format(s=session)
    if overseer_webhook.configured():
        entry = {"name": session, "role": "overseer", "state": "idle", "why": "babysat, idle"}
        reason = f"Babysat {session} is idle and not blocked"
        return overseer_webhook.post("babysit_idle", reason, text, [entry])
    return bool(send(_bill_ref(), text))


def broken_babysit_nudge(session: str, send: Callable[[str, str], bool] = send_text) -> bool:
    text = _BROKEN_BABYSIT.format(s=session)
    if overseer_webhook.configured():
        entry = {"name": session, "role": "overseer", "state": "error", "why": "no live agent"}
        reason = f"Babysat {session} has no live agent"
        return overseer_webhook.post("babysit_broken", reason, text, [entry])
    return bool(send(_bill_ref(), text))
