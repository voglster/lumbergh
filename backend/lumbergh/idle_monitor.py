"""
Background monitor for session idle state detection.

Periodically polls all live tmux sessions and updates their state,
independent of whether any WebSocket clients are connected.

State classification is based on pane-content quiescence: Claude Code
(and other agent CLIs) animate spinners, timers, and token counters
continuously while working, so a frozen pane means the session is idle.
Each poll takes a short burst of captures (to avoid aliasing with the
animation period) and compares the tail fingerprint across bursts and
across polls.

Pattern-based overrides from :mod:`idle_detector` catch the one case
quiescence alone cannot: a pane parked on an approval/question/login
prompt (BLOCKED). "The agent exited/died" is not scraped from pane text —
it is derived from the process signal here (see :meth:`_mark_exited`).
"""

import asyncio
import hashlib
import json
import logging
import re
import time
from datetime import UTC, datetime

import libtmux

from lumbergh import question_detector, session_attention, session_identity
from lumbergh.constants import TMUX_CMD
from lumbergh.db_utils import (
    get_session_data_db,
    recover_session_data_db,
    session_data_lock,
)
from lumbergh.idle_detector import SessionState, classify_overrides
from lumbergh.spawn_delivery import context_used
from lumbergh.targets import format_target, parse_target
from lumbergh.tmux_pty import (
    IS_WINDOWS,
    capture_pane_content,
    capture_pane_geometry,
    capture_pane_text,
    capture_pane_title,
)

logger = logging.getLogger(__name__)

_ANSI_PATTERN = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[PX^_][^\x1b]*\x1b\\")


def _live_session_names() -> list[str]:
    try:
        server = libtmux.Server(tmux_bin=TMUX_CMD)
        names = [s.name for s in server.sessions if s.name is not None]
        if names or not IS_WINDOWS:
            return names
    except Exception:
        if not IS_WINDOWS:
            return []

    # Windows fallback: psmux's `-F` format flags don't always work
    # under libtmux, so parse the default `list-sessions` output.
    try:
        import subprocess

        result = subprocess.run(
            [TMUX_CMD, "list-sessions"],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if result.returncode != 0:
            return []
        names = []
        pattern = re.compile(r"^([^:]+):")
        for line in result.stdout.splitlines():
            match = pattern.match(line)
            if match:
                names.append(match.group(1))
        return names
    except Exception:
        return []


def _registered_worker_targets() -> set[str]:
    """Targets the worktree registry claims as fleet work — the only windows that are
    supervised in their own right rather than as part of the session that holds them."""
    from lumbergh import worktrees

    try:
        return {r["target"] for r in worktrees.all_entries() if r.get("target")}
    except Exception:
        logger.warning("could not read worker targets; treating every window as its session's")
        return set()


def discover_target_refs() -> dict[str, str]:
    """Live target → the tmux window ref that is it. See ``lumbergh.targets``."""
    from lumbergh.targets import discover_target_refs as _discover
    from lumbergh.tmux_pty import build_pane_commands_lookup, list_session_window_specs

    return _discover(
        _live_session_names(),
        list_windows=list_session_window_specs,
        pane_commands=build_pane_commands_lookup(),
        worker_targets=_registered_worker_targets(),
    )


def discover_live_targets() -> list[str]:
    return list(discover_target_refs())


def tmux_ref(target: str) -> str:
    """The tmux ref to hand tmux for ``target`` — never the bare target string.

    A bare session name means "the selected window" to tmux, so passing one to
    ``capture-pane`` reads whatever the user is looking at, and passing one to
    ``send-keys`` types into it. Both are wrong: a session's agent is its first window.
    Discovery's cached window id is exact; ``{start}`` is tmux's own name for the
    lowest-numbered window and covers a target no pass has seen yet.
    """
    cached = idle_monitor.ref_for(target)
    if cached:
        return cached
    session, window = parse_target(target)
    return format_target(session, window) if window else f"{session}:{{start}}"


class IdleMonitor:
    """Background service that monitors tmux sessions via quiescence detection."""

    POLL_INTERVAL_SECONDS = 2.0
    BURST_CAPTURES = 3
    BURST_GAP_SECONDS = 0.15
    QUIET_THRESHOLD_SECONDS = 5.0
    # How long a pane may keep churning after it changed shape before we believe
    # the churn again. One repaint can span several polls on a busy agent.
    RESHAPE_SETTLE_SECONDS = 12.0
    FINGERPRINT_LINE_COUNT = 20
    # How long a session must sit continuously IDLE before we spend a cheap-LLM
    # call asking whether it is actually waiting on a human answer.
    QUESTION_CHECK_DELAY_SECONDS = 10.0
    # How often to sweep the fleet for a stalled Bill. This sweep shells out to git
    # per repo, so it runs on its own throttle rather than every 2s poll; fifteen
    # seconds is still well within "human-scale noticeable" for a stalled orchestrator.
    BILL_NUDGE_CHECK_INTERVAL_SECONDS = 15.0
    # How long Bill may sit idle with a calm fleet before the level-triggered heartbeat
    # taps him to check in on his own. The edge nudge handles anything urgent immediately;
    # this only covers the "everything's acked, nothing crossed an edge" gap that otherwise
    # lets him go permanently deaf. Fifteen minutes is ~96 check-ins/day — cheap even for a
    # local model, and a check-in a few minutes late costs nothing at supervision scale.
    BILL_HEARTBEAT_INTERVAL_SECONDS = 900.0
    # The same check-in, posted to an outside supervisor's webhook. That supervisor has no
    # idle state we can read, so the cadence alone throttles it — and a chat assistant
    # pinged every fifteen minutes about a calm fleet is noise, not supervision.
    OVERSEER_WEBHOOK_HEARTBEAT_INTERVAL_SECONDS = 1800.0

    def __init__(self):
        self._fingerprints: dict[str, str] = {}
        self._geometry: dict[str, str] = {}
        self._reshaped_at: dict[str, float] = {}
        self._last_change: dict[str, float] = {}
        self._states: dict[str, SessionState] = {}
        self._state_since: dict[str, float] = {}
        # Soft "the agent asked something and is waiting" overlay (name -> reason),
        # inferred by a cheap LLM once per idle episode; see question_detector.
        self._needs_answer: dict[str, str] = {}
        self._question_checked: set[str] = set()
        self._question_inflight: set[str] = set()
        self._question_tasks: set[asyncio.Task] = set()
        self._task: asyncio.Task | None = None
        self._running = False
        self._bill_nudged = False
        self._bill_nudge_checked_at = 0.0
        # Last time we contacted Bill by any tap (edge or heartbeat). Shared so the two
        # never double-contact him inside one heartbeat window.
        self._last_bill_nudge_at = 0.0
        # Webhook mode only: the session entry (name, role, state, why) of every report already posted as
        # needing the supervisor. Without Bill's idle->working edge to re-arm on, this is
        # what keeps one blocked worker from being re-posted every sweep.
        self._webhook_attention_posted: set[tuple] = set()
        # The webhook heartbeat counts from here rather than from 0, or every backend
        # restart (and `--reload` restarts on each save) would post a check-in at once.
        self._started_at = time.time()
        # Per-babysat-session latch for the "advance a stuck babysat overseer" tap: the
        # _state_since value we last nudged Bill about. Keying on the idle-episode
        # timestamp re-arms on the session's *next* idle without our having to observe
        # the working transition (the sweep only runs while Bill himself is idle).
        self._babysit_nudged_since: dict[str, float] = {}
        # Context the agent reports having consumed, per target — the one signal that
        # separates a worker still holding an unsubmitted brief from one merely thinking.
        # Read off the pane the monitor already captured, so it costs nothing extra.
        self._context: dict[str, tuple[float, float] | None] = {}
        self._live_targets: list[str] = []
        # Babysat names found with no live agent on the last pass, so the warning and the
        # attention overlay fire on the transition rather than every two seconds.
        self._babysit_broken: set[str] = set()
        # Broken babysits Bill has already been told about, so a standing fault taps him
        # once rather than every sweep. Re-arms if the babysit starts resolving again.
        self._babysit_broken_nudged: set[str] = set()
        # target -> the tmux window id that *is* it, from the last discovery pass. What
        # reaches tmux for a read or a keystroke; see the module-level ``tmux_ref``.
        self._target_refs: dict[str, str] = {}
        # Targets whose agent process went missing but whose terminal is still
        # open — held one poll before being declared exited, so a transient
        # discovery miss can't fire a false "the worker died" wake.
        self._exit_pending: set[str] = set()

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._running = True
            self._task = asyncio.create_task(self._monitor_loop())
            logger.info("Idle monitor started")

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None
            logger.info("Idle monitor stopped")

    def get_state(self, session_name: str) -> SessionState:
        return self._states.get(session_name, SessionState.UNKNOWN)

    def context_used(self, session_name: str) -> tuple[float, float] | None:
        """``(thousands of tokens, percent)`` the agent last reported, or None if it does
        not say. None is not zero: a provider whose TUI shows no readout has told us
        nothing, and callers turn on exactly that distinction."""
        return self._context.get(session_name)

    def live_targets(self) -> list[str]:
        return list(self._live_targets)

    def ref_for(self, target: str) -> str | None:
        """The tmux window id discovery bound to ``target``, if it has seen it."""
        return self._target_refs.get(target)

    def _record_state_change(self, session_name: str, state: SessionState) -> None:
        self._states[session_name] = state
        self._state_since[session_name] = time.time()

    def state_since_seconds(self, session_name: str) -> float | None:
        started = self._state_since.get(session_name)
        return None if started is None else time.time() - started

    def needs_answer(self, session_name: str) -> bool:
        return session_name in self._needs_answer

    def needs_answer_reason(self, session_name: str) -> str | None:
        return self._needs_answer.get(session_name)

    @classmethod
    def _fingerprint(cls, content: str) -> str:
        """Hash the tail of pane content (ANSI stripped, whitespace trimmed)."""
        lines = [_ANSI_PATTERN.sub("", line).rstrip() for line in content.split("\n")]
        while lines and not lines[-1]:
            lines.pop()
        tail = lines[-cls.FINGERPRINT_LINE_COUNT :]
        return hashlib.sha1("\n".join(tail).encode("utf-8")).hexdigest()

    def _classify_burst(
        self, session_name: str, captures: list[str], now: float, osc_title: str = ""
    ) -> SessionState:
        """
        Classify a session's state from a burst of captures.

        Returns WORKING if the pane changed within the burst or since the
        last poll.  Returns IDLE once the pane has been stable for at least
        ``QUIET_THRESHOLD_SECONDS``.  Manifest overrides (ERROR, BLOCKED,
        shell prompts) take precedence.
        """
        if not captures:
            return SessionState.UNKNOWN

        override = classify_overrides(captures[-1], osc_title)
        if override is not None:
            return override

        fingerprints = [self._fingerprint(c) for c in captures]
        last_fp = fingerprints[-1]
        prev_fp = self._fingerprints.get(session_name)

        burst_stable = len(set(fingerprints)) == 1
        changed_since_prev_poll = prev_fp is not None and prev_fp != last_fp

        if not burst_stable or changed_since_prev_poll:
            self._last_change[session_name] = now
            self._fingerprints[session_name] = last_fp
            return SessionState.WORKING

        # Fully stable within burst and across polls
        self._fingerprints[session_name] = last_fp
        if session_name not in self._last_change:
            # First sighting: bias toward working until quiet threshold elapses
            self._last_change[session_name] = now
            return SessionState.WORKING

        quiet_for = now - self._last_change[session_name]
        if quiet_for >= self.QUIET_THRESHOLD_SECONDS:
            return SessionState.IDLE
        return SessionState.WORKING

    async def _monitor_loop(self) -> None:
        while self._running:
            try:
                await self._check_all_sessions()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Idle monitor error: {e}")
            await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

    async def _check_all_sessions(self) -> None:
        loop = asyncio.get_event_loop()
        try:
            refs = await loop.run_in_executor(None, discover_target_refs)
        except Exception as e:
            logger.warning(f"Failed to get live sessions: {e}")
            return

        targets = list(refs)
        self._target_refs = refs
        self._live_targets = targets

        live_session_names = set(await loop.run_in_executor(None, _live_session_names))
        await self._reap_dead_targets(set(targets), live_session_names)

        # Identity files are keyed by the full session:window target (that's what
        # each pane's LUMBERGH_SESSION is set to), so prune with full targets —
        # reducing to bare session names would delete every window worker's
        # identity each poll and force outcome reads onto the cwd-guess fallback.
        session_identity.prune(set(targets))

        await self._check_babysit_health(set(targets))

        # return_exceptions keeps one bad session from cancelling the rest — but the
        # results have to be read, or a target that throws every poll goes unnoticed
        # forever while its state quietly freezes.
        results = await asyncio.gather(
            *(self._check_session(target) for target in targets),
            return_exceptions=True,
        )
        for target, result in zip(targets, results, strict=True):
            if isinstance(result, asyncio.CancelledError):
                raise result
            if isinstance(result, BaseException):
                logger.warning("idle check failed for %s: %s", target, result, exc_info=result)

        try:
            await self._maybe_nudge_bill(loop)
        except Exception:
            logger.debug("bill nudge skipped", exc_info=True)

    async def _check_babysit_health(self, targets: set[str]) -> None:
        """Surface any babysit that has nothing left to drive.

        Marked as an attention *error* on the babysat name itself, which is what the
        sessions API hands the dashboard notifier — so it reaches the user's browser
        whether or not Bill is running. Bill's own tap is a separate, quieter path
        (``_maybe_nudge_bill``), because the user asked to hear about this directly.
        """
        from lumbergh import babysit

        try:
            broken = babysit.unresolved(targets)
        except Exception:
            logger.warning("could not check babysit health", exc_info=True)
            return
        for session in broken:
            if session not in self._babysit_broken:
                logger.warning("babysat %r has no live agent — nothing is driving it", session)
            session_attention.mark_attention(session, SessionState.ERROR.value)
        newly_healthy = self._babysit_broken - set(broken)
        for session in newly_healthy:
            session_attention.clear_unseen(session)
        self._babysit_broken = set(broken)
        self._babysit_broken_nudged &= self._babysit_broken
        if broken or newly_healthy:
            await session_attention.persist()

    def _forget_target(self, target: str) -> None:
        self._fingerprints.pop(target, None)
        self._last_change.pop(target, None)
        self._states.pop(target, None)
        self._state_since.pop(target, None)
        self._needs_answer.pop(target, None)
        self._question_checked.discard(target)
        self._question_inflight.discard(target)
        self._exit_pending.discard(target)
        self._context.pop(target, None)
        self._babysit_nudged_since.pop(target, None)

    async def _reap_dead_targets(self, targets: set[str], live_sessions: set[str]) -> None:
        """Retire targets we were tracking that are no longer discovered.

        A target drops out for one of two reasons, told apart by the process
        signal (not pane text): if its tmux session is still alive, the agent
        process itself exited/died while the terminal stayed open — a real
        "the worker stopped" event worth surfacing as ERROR. If the whole
        session is gone, it was just killed — retire it silently.
        """
        dead_targets = set(self._fingerprints.keys()) - targets
        self._exit_pending &= dead_targets  # an agent that came back is no longer exiting

        for target in dead_targets:
            terminal_alive = parse_target(target)[0] in live_sessions
            was_tracked = self._states.get(target) not in (None, SessionState.ERROR)
            exiting = terminal_alive and was_tracked

            if exiting and target not in self._exit_pending:
                # First poll the agent is missing: hold one cycle (keep tracking
                # state so it re-enters here next poll) to absorb a transient miss.
                self._exit_pending.add(target)
                continue

            confirmed_exit = exiting and target in self._exit_pending
            self._forget_target(target)
            if confirmed_exit:
                await self._mark_exited(target)

    async def _mark_exited(self, session_name: str) -> None:
        """Surface an agent that exited/died from a still-open terminal.

        Ground truth from the process signal, so unlike the old pane-text guess
        it fires only when the agent is genuinely gone. Wakes the overseer once,
        then stops tracking (the persisted state carries the UI until relaunch).
        """
        logger.info(f"Session {session_name} agent exited (process gone, terminal alive) -> error")
        await self._persist_state(session_name, SessionState.ERROR)
        session_attention.mark_attention(session_name, SessionState.ERROR.value)
        await session_attention.persist()

    async def _maybe_nudge_bill(self, loop: asyncio.AbstractEventLoop) -> None:
        """Tap Bill if he's idle — with live work (edge) or just to check in (heartbeat).

        ``_fleet_rows`` shells out to tmux and git per repo, so it never runs on the
        loop directly, and it only runs on ``BILL_NUDGE_CHECK_INTERVAL_SECONDS`` — not
        every ~2s poll — since a stalled Bill is a human-scale problem, not one that
        needs sub-second detection.

        Two triggers share this one sweep:

        - **edge** — a report needs attention now. Fires once per idle episode
          (``_bill_nudged``), preempting the heartbeat so a real blocker never gets a
          mere "routine check-in".
        - **level (heartbeat)** — nothing's flagged, but Bill has sat idle past
          ``BILL_HEARTBEAT_INTERVAL_SECONDS``. Fires on that cadence so he never goes
          permanently deaf once everything has been acked — the exact gap the edge
          trigger alone can't see.
        """
        from lumbergh import bill_nudge, overseer_webhook

        webhook = overseer_webhook.configured()
        # An outside supervisor has no pane to read, so there is no "busy" to wait out:
        # it is always reachable, and the dedupe below does the job the idle gate does.
        state = "idle" if webhook else self.get_state(bill_nudge.BILL_SESSION).value
        if state != "idle":
            self._bill_nudged = False
            return

        now = time.time()
        if now - self._bill_nudge_checked_at < self.BILL_NUDGE_CHECK_INTERVAL_SECONDS:
            return
        self._bill_nudge_checked_at = now

        from lumbergh.routers.bill import BILL_ORIGIN, _fleet_rows

        # One unfiltered snapshot serves both triggers, because they need different slices
        # of it: the edge nudge only counts Bill's own workers, while "is this overseer
        # actually stalled?" has to see the workers *it* spawned, whatever their origin.
        rows = await loop.run_in_executor(None, _fleet_rows, None)
        # BILL_ORIGIN, not BILL_SESSION: this is the registry `origin` value, and the two
        # only happen to share a string today. Using the session name here would turn the
        # whole backstop into a silent no-op the day Bill is renamed.
        his = [r for r in rows if r.get("role") != "worker" or r.get("origin") == BILL_ORIGIN]

        if await self._maybe_report_broken_babysit(loop, now):
            return

        if await self._maybe_wake(loop, now, his, webhook):
            return

        # No edge, but a babysat overseer may be stuck idle with no sentinel — ranked below
        # a real blocker, above the generic heartbeat. Returns True once it has tapped Bill.
        if await self._maybe_advance_babysat(loop, now, rows):
            return

        # Calm fleet: fall through to the heartbeat. It must not touch ``_bill_nudged`` —
        # that latch belongs to the edge, and a heartbeat setting it would suppress a real
        # blocker until Bill next left idle.
        if not self._heartbeat_due(now, webhook):
            return
        if await loop.run_in_executor(None, bill_nudge.heartbeat_nudge):
            self._last_bill_nudge_at = now

    async def _maybe_wake(
        self, loop: asyncio.AbstractEventLoop, now: float, his: list[dict], webhook: bool
    ) -> bool:
        """The edge, by transport. True when a report needs the supervisor, so the caller
        stops before the lower-ranked taps."""
        from lumbergh import bill_nudge

        if webhook:
            return await self._post_attention(loop, now, his)
        if bill_nudge.should_nudge("idle", his):
            await self._nudge_edge(loop, now)
            return True
        return False

    def _heartbeat_due(self, now: float, webhook: bool) -> bool:
        if webhook:
            quiet_since = max(self._last_bill_nudge_at, self._started_at)
            return now - quiet_since >= self.OVERSEER_WEBHOOK_HEARTBEAT_INTERVAL_SECONDS
        from lumbergh import bill_nudge

        idle_for = self.state_since_seconds(bill_nudge.BILL_SESSION)
        if idle_for is None or idle_for < self.BILL_HEARTBEAT_INTERVAL_SECONDS:
            return False
        return now - self._last_bill_nudge_at >= self.BILL_HEARTBEAT_INTERVAL_SECONDS

    async def _post_attention(
        self, loop: asyncio.AbstractEventLoop, now: float, rows: list[dict]
    ) -> bool:
        """The edge tap, for a webhook supervisor. Returns whether anything needs it.

        Bill's edge re-arms when he leaves idle; a webhook receiver never does, so this
        latches on *what* was posted instead. A report needing attention for a reason not
        yet posted (newly blocked, a fresh chunk, blocked turned error) posts again, with
        every currently-needing report in the body. A report that stops needing attention
        drops out of the latch, so its next episode posts afresh. The supervisor acks the
        idle+unseen ones by running ``lb fleet`` as Bill, exactly as Bill does.

        True while anything needs attention, posted or not, so the caller holds the
        advance and heartbeat taps back just as it does behind Bill's latched edge.
        """
        from lumbergh import bill_nudge
        from lumbergh.routers.bill import BILL_SESSION, _needing

        needing = _needing(rows, BILL_SESSION)
        current = {tuple(bill_nudge.session_entry(r).values()) for r in needing}
        self._webhook_attention_posted &= current
        if current - self._webhook_attention_posted:
            sent = await loop.run_in_executor(None, bill_nudge.nudge, needing)
            if sent:
                self._webhook_attention_posted = current
                self._last_bill_nudge_at = now
        return bool(needing)

    async def _nudge_edge(self, loop: asyncio.AbstractEventLoop, now: float) -> None:
        """The edge tap: a report needs Bill now. Once per idle episode.

        The latch is set from the send's own result. Setting it unconditionally meant a
        failed tmux send disarmed the backstop permanently: nothing retries, and Bill never
        leaves ``idle`` because he was never actually woken.
        """
        from lumbergh import bill_nudge

        if self._bill_nudged:
            return
        if await loop.run_in_executor(None, bill_nudge.nudge):
            self._bill_nudged = True
            self._last_bill_nudge_at = now

    async def _maybe_report_broken_babysit(
        self, loop: asyncio.AbstractEventLoop, now: float
    ) -> bool:
        """Tap Bill about a babysit that has nothing behind it. Ranked above the edge nudge.

        The generic wake tells him to run ``lb fleet`` and *handle* it, and there is nothing
        there to handle — that loop is what burned a night. This one tells him to report it.
        Latched per fault rather than per idle episode, because the fault stands until the
        user acts on it. Returns whether a tap was made, so the caller stops here.
        """
        from lumbergh import bill_nudge

        untold = sorted(self._babysit_broken - self._babysit_broken_nudged)
        if not untold:
            return False
        if await loop.run_in_executor(None, bill_nudge.broken_babysit_nudge, untold[0]):
            self._babysit_broken_nudged.add(untold[0])
            self._last_bill_nudge_at = now
        return True

    async def _maybe_advance_babysat(
        self, loop: asyncio.AbstractEventLoop, now: float, rows: list[dict]
    ) -> bool:
        """Tap Bill at a babysat overseer stuck plain-idle with no sentinel — the gap the
        sentinel-driven babysit loop deliberately leaves to supervision (babysit.decide's
        NONE), and the one that stalled port overnight. An imperative to advance *that*
        session, not a generic check-in he can answer with "all quiet". Latched per idle
        episode. Returns whether a tap was made, so the caller stops before the heartbeat.
        """
        from lumbergh import bill_nudge

        stuck = self._unhandled_babysat_idle(rows)
        if stuck is None:
            return False
        if await loop.run_in_executor(None, bill_nudge.advance_nudge, stuck):
            self._babysit_nudged_since[stuck] = self._state_since.get(stuck, 0.0)
            self._last_bill_nudge_at = now
        return True

    def _unhandled_babysat_idle(self, rows: list[dict]) -> str | None:
        """A babysat overseer sitting plain-idle that Bill hasn't been pointed at yet.

        Skips one that's blocked/error (a different wake owns that), waiting on the user
        (``needs_answer``), still supervising live workers, or already tapped for this idle
        episode. Returns one such session, or None.

        **An overseer waiting on its own batch is idle too**, and telling Bill to "advance"
        one is how a `/clear` landed on a session supervising five running workers. Idle
        plus a live crew is not a stall; it is the system working.
        """
        from lumbergh import babysit, fleet

        for session in babysit.babysat_sessions():
            if self.get_state(session) != SessionState.IDLE:
                continue
            if self.needs_answer(session):
                continue
            if fleet.workers_in_flight(rows, session):
                continue
            since = self._state_since.get(session, 0.0)
            if self._babysit_nudged_since.get(session) == since:
                continue
            return session
        return None

    async def _burst_capture(self, session_name: str) -> list[str]:
        """Take BURST_CAPTURES snapshots with short async gaps between them."""
        loop = asyncio.get_event_loop()
        ref = tmux_ref(session_name)
        captures: list[str] = []
        for i in range(self.BURST_CAPTURES):
            if i > 0:
                await asyncio.sleep(self.BURST_GAP_SECONDS)
            content = await loop.run_in_executor(None, capture_pane_content, ref)
            captures.append(content or "")
        return captures

    def _reshaped(self, session_name: str, geometry: str) -> bool:
        """Whether the pane changed size since the last look.

        An empty geometry means tmux would not answer; treat that as "no news"
        rather than a reshape, so a failing query cannot freeze state updates.
        """
        if not geometry:
            return False
        previous = self._geometry.get(session_name)
        self._geometry[session_name] = geometry
        return previous is not None and previous != geometry

    def _settling_after_reshape(self, session_name: str) -> bool:
        reshaped_at = self._reshaped_at.get(session_name)
        return reshaped_at is not None and time.time() - reshaped_at < self.RESHAPE_SETTLE_SECONDS

    async def _check_session(self, session_name: str) -> None:
        captures = await self._burst_capture(session_name)
        if not any(captures):
            return

        loop = asyncio.get_event_loop()
        ref = tmux_ref(session_name)
        osc_title = await loop.run_in_executor(None, capture_pane_title, ref)
        geometry = await loop.run_in_executor(None, capture_pane_geometry, ref)

        self._context[session_name] = context_used(_ANSI_PATTERN.sub("", captures[-1]))

        if self._reshaped(session_name, geometry):
            # The pane changed shape — a viewer attached, a phone rotated — and the
            # agent redrew itself to fit. Take the new picture as the baseline so the
            # repaint is not read as the agent doing something. Judging continues:
            # skipping the pass entirely lets a pane that keeps being resized freeze
            # its state at whatever it last was.
            logger.debug("Session %s pane reshaped to %s; re-baselining", session_name, geometry)
            self._fingerprints[session_name] = self._fingerprint(captures[-1])
            self._reshaped_at[session_name] = time.time()

        state = self._classify_burst(session_name, captures, time.time(), osc_title)

        old_state = self._states.get(session_name, SessionState.UNKNOWN)
        if logger.isEnabledFor(logging.DEBUG):
            # One line per target per poll: everything needed to explain a state
            # that looks wrong — what the pane looked like, how long it has been
            # still, and whether we reshaped it ourselves.
            logger.debug(
                "poll %s geometry=%s state=%s was=%s quiet=%.1fs reshaped=%s fingerprint=%s",
                session_name,
                geometry or "unknown",
                state.value,
                old_state.value,
                time.time() - self._last_change.get(session_name, time.time()),
                self._settling_after_reshape(session_name),
                self._fingerprints.get(session_name, "")[:8],
            )
        if state != old_state:
            logger.info(f"Session {session_name} state: {old_state.value} -> {state.value}")
            self._record_state_change(session_name, state)
            await self._persist_state(session_name, state)
            settling = state is SessionState.IDLE and self._settling_after_reshape(session_name)
            if state in (SessionState.IDLE, SessionState.BLOCKED, SessionState.ERROR):
                # Going quiet right after a reshape is the repaint finishing, not the
                # agent. Flagging it hands you a "done while you were away" for work
                # that never happened — and only ever right after you looked.
                if not settling:
                    session_attention.mark_attention(session_name, state.value)
            else:
                session_attention.clear_unseen(session_name)
            await session_attention.persist()
            if state == SessionState.IDLE:
                await self._maybe_drive_babysit(session_name)

        self._update_question_detection(session_name, state)

    async def _maybe_drive_babysit(self, session_name: str) -> None:
        """Let a babysit loop cycle a session that just went idle.

        Fires only on the transition into idle, so a babysat overseer that printed its
        refresh sentinel is sent the ``/clear`` + restart it can't run for itself before
        Bill is ever nudged. A blocked/error/plain idle is left alone and flows to Bill's
        normal supervision. Best-effort: a babysit failure must never stall the monitor.
        """
        from lumbergh import babysit

        try:
            await babysit.on_idle(session_name)
        except Exception:
            logger.warning("babysit drive failed for %s", session_name, exc_info=True)

    def _update_question_detection(self, session_name: str, state: SessionState) -> None:
        """Schedule a cheap-LLM question check for a sustained-idle session.

        Runs every poll (not just on transitions).  Fires at most once per idle
        episode, after the session has been continuously IDLE for
        ``QUESTION_CHECK_DELAY_SECONDS``.  Any non-idle state resets the episode
        and drops a stale ``needs_answer`` flag.
        """
        if state != SessionState.IDLE:
            self._needs_answer.pop(session_name, None)
            self._question_checked.discard(session_name)
            return
        if session_name in self._question_checked or session_name in self._question_inflight:
            return
        since = self.state_since_seconds(session_name)
        if since is None or since < self.QUESTION_CHECK_DELAY_SECONDS:
            return
        # Mark checked before the (settings-reading) enable gate so a disabled
        # detector reads settings at most once per idle episode.
        self._question_checked.add(session_name)
        if not self._question_detection_enabled():
            return
        self._question_inflight.add(session_name)
        task = asyncio.create_task(self._run_question_detection(session_name))
        self._question_tasks.add(task)
        task.add_done_callback(self._question_tasks.discard)

    def _question_detection_enabled(self) -> bool:
        from lumbergh.routers.settings import get_settings

        return bool(get_settings().get("questionDetectionEnabled"))

    def _question_provider(self):
        from lumbergh.ai.providers import get_provider
        from lumbergh.routers.settings import get_settings

        settings = get_settings()
        if not settings.get("questionDetectionEnabled"):
            return None
        try:
            return get_provider(settings.get("ai", {}), settings)
        except Exception:
            return None

    async def _run_question_detection(self, session_name: str) -> None:
        try:
            if self._states.get(session_name) != SessionState.IDLE:
                return
            provider = self._question_provider()
            if provider is None:
                return
            loop = asyncio.get_event_loop()
            text = await loop.run_in_executor(None, capture_pane_text, tmux_ref(session_name))
            if not text or not text.strip():
                return
            verdict = await question_detector.detect(text, provider)
            if verdict.waiting and self._states.get(session_name) == SessionState.IDLE:
                self._needs_answer[session_name] = verdict.reason
                logger.info(
                    f"Session {session_name} appears to be waiting on a human: {verdict.reason}"
                )
        except Exception as e:
            logger.warning(f"Question detection failed for {session_name}: {e}")
        finally:
            self._question_inflight.discard(session_name)

    async def _persist_state(self, session_name: str, state: SessionState) -> None:
        loop = asyncio.get_event_loop()

        def _save():
            with session_data_lock(session_name):
                try:
                    _write_idle_state(session_name, state)
                except (ValueError, json.JSONDecodeError) as e:
                    logger.warning(f"Corrupt DB for {session_name}; attempting recovery: {e}")
                    if recover_session_data_db(session_name):
                        _write_idle_state(session_name, state)
                    else:
                        raise

        try:
            await loop.run_in_executor(None, _save)
        except Exception as e:
            logger.error(f"Failed to persist state for {session_name}: {e}")


def _write_idle_state(session_name: str, state: SessionState) -> None:
    """Write the idle_state row.  Caller must hold session_data_lock(name)."""
    session_db = get_session_data_db(session_name)
    state_table = session_db.table("idle_state")
    state_table.truncate()
    state_table.insert(
        {
            "state": state.value,
            "updatedAt": datetime.now(tz=UTC).isoformat(),
        }
    )


# Global singleton instance
idle_monitor = IdleMonitor()
