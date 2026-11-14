# Project Lumbergh

A self-hosted web dashboard for supervising multiple Claude Code AI sessions running in tmux. Think "micromanager for your AI interns."

## Project Overview

Lumbergh provides a web UI to:
- View and interact with multiple Claude Code terminal sessions (via xterm.js + WebSockets)
- Monitor live git diffs as the AI works
- Manage context/planning docs and chat with a "Manager" AI agent

See `docs/` for full PRD, architecture, and implementation roadmap.

## Tech Stack

**Backend:** Python 3.11+, FastAPI, libtmux, TinyDB
**Frontend:** React + Vite + TypeScript, xterm.js, TanStack Query, Tailwind CSS

## Project Structure

```
lumbergh/
├── backend/
│   ├── lumbergh/
│   │   ├── main.py             # FastAPI app, middleware, project-level endpoints
│   │   ├── auth.py             # Password auth middleware + login/logout
│   │   ├── diff_cache.py       # Background diff/graph caching with fingerprinting
│   │   ├── idle_detector.py    # Pattern-based agent state detection
│   │   ├── idle_monitor.py     # Background session monitoring service
│   │   ├── session_manager.py  # PTY pooling for WebSocket clients
│   │   ├── tmux_pty.py         # PTY/tmux attachment logic
│   │   ├── file_utils.py       # Path validation, language detection
│   │   ├── git_utils.py        # Git subprocess wrappers
│   │   ├── version_check.py    # PyPI version checking
│   │   ├── ai/
│   │   │   ├── providers.py    # Multi-provider AI (Ollama, OpenAI, Anthropic, Google)
│   │   │   └── prompts.py      # AI prompt templates with variable substitution
│   │   └── routers/
│   │       ├── sessions.py     # Session CRUD, git ops, todos, files, AI endpoints
│   │       ├── ai.py           # AI status, commit gen, prompt management
│   │       ├── settings.py     # Global settings read/write
│   │       ├── shared.py       # Shared files upload/serve/manage
│   │       ├── notes.py        # Global prompt templates
│   │       └── tmux.py         # Mouse mode configuration
│   ├── pyproject.toml
│   └── start.sh
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── SessionDetail.tsx
│   │   │   └── LoginPage.tsx
│   │   ├── components/
│   │   │   ├── Terminal.tsx, TerminalHeader.tsx
│   │   │   ├── QuickInput.tsx
│   │   │   ├── DiffViewer.tsx, diff/
│   │   │   ├── FileBrowser.tsx
│   │   │   ├── TodoList.tsx, TodoItem.tsx
│   │   │   ├── Scratchpad.tsx
│   │   │   ├── PromptTemplates.tsx
│   │   │   ├── SharedFiles.tsx
│   │   │   ├── SettingsModal.tsx
│   │   │   ├── SessionCard.tsx
│   │   │   ├── CreateSessionModal.tsx
│   │   │   └── ResizablePanes.tsx, VerticalResizablePanes.tsx
│   │   └── hooks/
│   │       ├── useTerminalSocket.ts
│   │       ├── useAuth.tsx
│   │       └── useApiClient.ts
│   └── start.sh
├── test/
│   ├── e2e/                # API E2E tests (httpx + pytest)
│   ├── e2e-ui/             # UI E2E tests (Playwright + pytest-bdd)
│   └── e2e-vm.sh           # QEMU VM test runner
├── bootstrap.sh
└── docs/
```

## Quick Start

```bash
./bootstrap.sh
```

This creates a tmux session with claude, backend (port 8420), and frontend (port 5420) windows and opens the browser.

Or run services separately:
```bash
./backend/start.sh   # Backend on :8420
./frontend/start.sh  # Frontend on :5420
```

## Linting

Run `./lint.sh` before finishing any task. It auto-fixes what it can (ruff format, prettier, eslint --fix) and exits non-zero if unfixable errors remain. Fix all errors before considering work done.

## Testing

- **Red-green-refactor**: When fixing a bug, write a failing test first that reproduces it, verify it fails, then fix the code and verify the test passes.
- Backend unit tests: `cd backend && uv run pytest`
- E2E tests: `./test/e2e-vm.sh` (spins up QEMU VM, runs all E2E + UI tests). This is
  the only supported way to run them. The suites delete every session they own on the
  target, and `DELETE /api/sessions/{name}` runs `tmux kill-session` — pointed at your
  own machine they take out your tmux sessions and then the tmux server. `test/conftest.py`
  refuses to run outside the VM; do not work around it by setting `LUMBERGH_E2E_SANDBOX=1`
  and aiming at localhost:8420.

## Logs

The backend configures only the `lumbergh` namespace (uvicorn keeps its own), at
INFO by default — state transitions, PTY lifecycle, and any background check that
threw. Raise it with `LUMBERGH_LOG_LEVEL=debug` before starting the backend.

DEBUG adds one line per session per poll from the idle monitor:

```
poll port geometry=107x60 state=idle was=working quiet=6.3s reshaped=False fingerprint=2cd4cf2b
```

That is the line to reach for when a session's state looks wrong — it says what
the pane looked like, how long it had been still, and whether the pane had just
changed shape (a viewer attaching resizes it, the agent redraws, and content-based
detection reads the repaint as activity).

## Glasses HUD

`/glasses` is a 576x288 HUD page for supervising the fleet from Even Realities
G2 smart glasses (or, today, any phone browser over Tailscale) — a swipeable
deck of session cards plus voice dictation into whichever card is selected.
It is plain ES modules under `glasses/` with no build step, deliberately kept
out of the Vite app: the G2 plugin format wants plain web assets, not a
bundled SPA. It's served by a static mount in `main.py` registered **before**
`mount_frontend(app)` — that ordering is load-bearing, since `mount_frontend`
installs a catch-all `/{path:path}` route that would otherwise swallow
`/glasses`.

`GET /api/glasses/board` (`backend/lumbergh/routers/glasses.py`) is the HUD's
only read. `?wait=true` is a wake long poll: it holds the request open until
something needs the wearer or the timeout elapses, so the page can sit idle
without repolling. It deliberately does **not** reuse `bill.wait_fleet` for
this — that function calls `_mark_seen`, which clears `session_attention`,
the user's own dashboard unseen overlay. A pair of glasses long-polling in a
pocket must never ack sessions the user never looked at; this is the single
most important invariant in the feature. `test_glasses_router.py` guards it
two ways: `test_glasses_borrows_only_the_row_builder_from_bill` asserts on the
module's import graph (the HUD takes `_fleet_rows` from `bill` and nothing
else, and `_fleet_rows` itself never marks seen), and
`test_board_never_marks_sessions_seen` patches `bill._mark_seen` and asserts it
is never called.

`needs` is `fleet.ATTENTION_STATES` (`blocked` / `error` / `undelivered`) over
every row — neither of the two predicates either side of it. Bill's
viewer-scoped `bill._stamp_attention` resolves through `_direct_reports`, which
keeps only workers whose `parent` is the viewer; no session has an overseer
named "glasses", so that stamp is empty by construction and the HUD would never
surface anything. `fleet.needs_attention` errs the other way: it also counts
`idle + unseen`, and `unseen` is the user's own dashboard overlay, true of every
session they left mid-thought — measured live, that had 10 of 12 quiet sessions
claiming the wearer, so the HUD woke instantly and never went dark. **Idle is not
asking.** Idle sessions still appear in the deck, are still browsable and still
carry their outcome line; they just never set `needs` and never wake the long
poll. The glasses are the user's view of the whole fleet, not a node in Bill's
overseer/worker tree.

`backend/lumbergh/glasses/summarize.py`'s `LINE_MAX` (currently 34; note the
repo also has a top-level `glasses/` holding the client) is the one place the display
character budget lives — change it there and nowhere else. Summarization is
a best-effort embellishment on a deterministic truncation and never blocks
or breaks the board: any provider failure or timeout degrades to the
truncated line.

The summarizer has its own provider config at `settings["glasses"]["summarizer"]`
(`baseUrl` / `apiKey` / `model`) and never inherits the dashboard's `ai.provider`.
On this machine that's `claude_cli`, and `claude -p` is far too slow and
expensive for a view that refreshes on every fleet change. Unconfigured means
deterministic lines only — a working HUD, not a stalled one. Measured on this
hardware against Ollama at `llmbox:11434`: `qwen3.5:4b` returns empty content
over the OpenAI-compatible `/v1` route (its reasoning tokens consume the
response) and takes ~1.6s via the native `/api/chat` route while leaking its
own character-counting into the text; `llama3.2:latest` answers cleanly in
~3.9s but exceeds the 2s budget and drops identifiers the summarizer prompt
asks it to keep verbatim. No LiteLLM proxy was reachable. This is why the
deterministic path is the default, not a fallback of last resort. That key is
reachable only by hand-editing `~/.config/lumbergh/settings.json`:
`SettingsUpdate` in `routers/settings.py` has no `glasses` field, so the API
strips it. Deliberate while the summarizer stays off by default — add the
Pydantic field when it earns a place in the settings UI.

The client deck holds its order still while the wearer swipes, but browsing is
a *transient* posture: `BROWSE_HOLD_MS` in `glasses/main.js` returns it to rest
a few seconds after the last swipe (never while a dictation is live). Without
that, one swipe froze the deck for the life of the page — no new cards, no
reordering, and no wake.

Dictation (`glasses/dictate.js`) needs a reachable WhisperLive at
`llmbox:9091` (see `glasses/stt-config.js`). It also needs a secure context
for `getUserMedia`/`AudioWorklet` — `localhost` qualifies, a Tailscale
hostname over plain HTTP does not.

The Even app's WebView runs the page's JS and renders its DOM, but only on the
phone — the lenses are a separate display, driven over BLE, showing only what is
pushed as positioned containers ("no CSS, no flexbox, no DOM"). Confirmed on
hardware: the page rendered in the app and the lenses stayed blank. `glasses/lens.js`
is therefore what the wearer actually sees; it pushes the same card the DOM shows as
text containers through the SDK vendored in `glasses/vendor/`, and `index.html` is the
phone-side preview and desktop debugging path on the same 576x288 frame. Firmware
limits: 8 text containers max, `containerTotalNum` 1..12, brightness 0..4.

The SDK is vendored rather than installed because it can be — zero dependencies,
`type: module`, no bare imports — which keeps the HUD's no-build-step property while
still reaching the glasses. `window.EvenAppBridge` does not exist until that SDK
initialises it; the host injects only `window.flutter_inappwebview` and
`__EVEN_HUB_APP_ID__`. `?debug=1` reports what the WebView exposes to
`POST /api/glasses/probe`, which writes `~/.config/lumbergh/glasses-probe.json` — that
WebView has no console.

## Outside Supervisor Webhook

Bill's four server-side taps (`bill_nudge.py`: attention, heartbeat, broken babysit,
idle babysat overseer) normally type into the tmux session named `bill`. With
`LUMBERGH_OVERSEER_WEBHOOK_URL` set in the backend's environment they go out as a
JSON POST instead (`overseer_webhook.py`), for a supervisor that lives outside
Lumbergh and drives `lb` as Bill (`LUMBERGH_SESSION=bill`). The key comes from
`LUMBERGH_OVERSEER_WEBHOOK_KEY`, sent as `Authorization: Bearer <key>` unless
`LUMBERGH_OVERSEER_WEBHOOK_HEADER` names another header, which then carries the raw key.
Body: `source`, `kind` (`attention` / `heartbeat` / `babysit_broken` / `babysit_idle`),
`reason`, `message` (the text Bill would have been typed), `sessions`
(`name`/`role`/`state`/`why`) and `timestamp`.

Webhook mode drops the "is Bill idle?" gate, since there is no pane to read, so it has
its own dedupe in `IdleMonitor._post_attention`: an attention post fires only when a
report needs the supervisor for a reason not already posted, and the heartbeat runs at
most every 30 minutes, counted from backend start so `--reload` doesn't post one on
every save. A failed POST holds further ones off for a minute.

`LUMBERGH_OVERSEER_PIPER=1` sends the same taps to Piper (Jim's Grok Bot assistant) by
running `sherpa piper "<reason>" --session <names> --kind done|blocked|error` instead of
POSTing. Piper's webhook URL and auth stay in sherpa's vault, not Lumbergh's
environment. The heartbeat is not sent to Piper. A note `sherpa piper` reports as unsent
counts as a failed POST, and gets the same one-minute hold-off.

## Debugging Event Loop Lag

Lumbergh serves terminals, polls and clicks from one event loop, so a handler
that blocks stops everything at once — the UI does not degrade, it freezes.

`stall_watchdog.py` catches that and names the culprit. It keeps the loop's
liveness in a timestamp and watches that timestamp **from a plain OS thread**,
which keeps running while the loop does not. That detail is the whole point: a
watchdog that samples from the loop itself only gets to run once the block is
over, so its stacks show a server already idle again. The earlier in-loop
version logged 250 stalls totalling 11 minutes without once naming a cause.

Stacks land in `/tmp/lumbergh-lag.log` under `STALL <ms>`, main thread first —
the frame at the bottom of that stack *is* the blocking call.

**The rule this exists to enforce: an endpoint that does unbounded work must be
a sync `def`, not an `async def`.** FastAPI runs sync handlers in a threadpool
and `async` ones on the loop. `create_session` and `delete_session` were `async`
while calling `git worktree remove` over a borrowed `node_modules` and running
project post-create hooks (`npm install`), which froze the entire UI for as long
as that took — measured at 1.4s and 2.0s on a 671MB worktree, and up to 68s in
the wild. Both are now sync; `test_endpoints_do_not_block_the_loop.py` measures
loop responsiveness directly and fails if either regresses.

Note when writing such a test: racing a second HTTP request against the slow one
does not work, because which request reaches the loop first is scheduling luck.
Measure the loop itself (`worst_loop_gap`).

## Conventions

- Keep the backend simple - it's a thin layer over tmux/git subprocesses
- TinyDB for persistence:
  - Project data: `~/.config/lumbergh/projects/{hash}.json` (todos, scratchpad, prompts)
  - Global data: `~/.config/lumbergh/global.json` (shared prompts)
- Todos are addressed by `id`, never by position (`backend/lumbergh/todos.py`). The
  dashboard floats unfinished todos to the top on load without writing that order back,
  and `lb todo add` appends — so the browser's order and the store's order are different
  lists. Any endpoint taking a position acted on a different todo than the one clicked;
  launching a todo as a worker spawned the wrong task, and moving one did it silently.
  Ids are backfilled on read, so old backlogs pick them up on first open.
- WebSocket for terminal streaming, REST+polling for diffs and metadata
- Mobile-first responsive design (this will be used from phones/tablets)

## Releasing

When asked to release, read and follow `docs/release-workflow.md`.

## Lumbergh Cloud (Sibling Project)

`../lumbergh-cloud/` is the closed-source companion server (Home Assistant model). See `../lumbergh-cloud/docs/launch-plan.md` for the full plan. The cloud server handles prompt sharing, settings sync, and future paid features (hosted VMs, team workspaces). The open-source app works 100% offline without it.

## Current Phase

Phases 1-5 complete (terminal, diff viewer, file browser, todos, prompts, multi-session dashboard, auth, AI features, shared files, settings). Phase 6 (Manager AI chat) is next.
