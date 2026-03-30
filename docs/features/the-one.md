# Feature Spec: "The One"

**Status:** Draft
**Date:** 2026-03-30

## Summary

A single session can be designated as "the one" — the highest-priority conversation. This surfaces across the UI to minimize idle time on the most important session: it sorts first on the dashboard, pins to the left of the navigation dots, and gets priority in session cycling.

## Motivation

When managing multiple agent sessions, one conversation is often the critical path. Today, all sessions are treated equally — sorted by recency, cycled alphabetically. "The One" lets the user signal which session matters most, so the UI actively helps them return to it the moment it needs attention.

## Requirements

### Data Model

- New boolean field `theOne` on session metadata (persisted in TinyDB `sessions.json`)
- Multiple sessions can be starred simultaneously
- Can be toggled off individually (zero sessions starred is valid)

### Backend Changes

**File:** `backend/lumbergh/routers/sessions.py`

- Add `theOne: Optional[bool]` to the `SessionUpdate` Pydantic model
- On `PATCH /api/sessions/{name}` with `theOne: true/false`:
  - Set/clear `the_one` on the target session (no mutual exclusivity)
- Expose `theOne` in the `GET /api/sessions` response (merged from stored metadata)

**File:** `backend/lumbergh/models.py`

- Add `the_one: Optional[bool]` to relevant Pydantic models

### Frontend Changes

#### 1. SessionCard Button (Dashboard)

**File:** `frontend/src/components/SessionCard.tsx`

- Add a "The One" toggle button in the card footer, next to the existing cloud icon
- **Icon:** Lucide `Star` icon (14px), matching existing cloud icon pattern
- **States:**
  - **Off:** `text-text-muted` (gray), star outline only, `hover:text-blue-400`
  - **On:** `text-blue-400` (light mode) / `text-blue-300` (dark mode), star filled with `currentColor`
- Click calls `PATCH /api/sessions/{name}` with `{ theOne: !current }`
- Stop event propagation (same pattern as cloud button)

#### 2. Session Card Blue Border (Dashboard)

**File:** `frontend/src/components/SessionCard.tsx`

- When a session is "the one," apply a blue border highlight:
  - Light mode: `border-blue-500`
  - Dark mode: `border-blue-400` (brighter blue for visibility)
- This replaces/overrides the default card border, not the status dot colors

#### 3. Dashboard Sort Order

**File:** `frontend/src/pages/Dashboard.tsx`

- In the active sessions list, "the one" always sorts first
- Remaining sessions continue to sort by `lastUsedAt` descending
- Sort logic: `theOne` sessions first, then by `lastUsedAt`

#### 4. Navigation Dots (Session Detail)

**File:** `frontend/src/components/SessionNavigatorDots.tsx`

- All starred dots are positioned at the far left
- A small vertical separator bar sits between the starred dots and the rest
- Remaining dots maintain their current order (alphabetical)
- The entire group (dot + separator + dots) remains centered in the header
- If no session is starred, no separator is shown, dots render as today
- Starred dots have a subtle blue ring/accent to distinguish them (in addition to the normal status color)

#### 5. Session Cycling Logic

**File:** `frontend/src/pages/SessionDetail.tsx` (handleCycleSession)

Current behavior:
1. Get alive, non-paused sessions sorted alphabetically
2. Cycle to next/previous by index

New behavior:
1. Get alive, non-paused sessions
2. If cycling forward and any starred sessions are **idle** (waiting for input) and not the current session:
   - Navigate to the first idle starred session
3. Otherwise, cycle normally through the remaining sessions (alphabetical)
4. Shift+click (previous) cycles normally without "the one" priority — this is an intentional escape hatch

This means: every time you click forward from any session, if "the one" is idle, you land there first. Then the next click continues the normal cycle.

## UI Mockup (Navigation Dots)

```
No "the one" set (current behavior):
         ● ● ● ● ●

"The one" set (session B is the one, currently viewing session D):
       ◉ │ ● ● ● ●
       B    A C D E
```

- `◉` = "the one" dot (blue accent ring)
- `│` = vertical separator
- `●` = normal session dot (colored by status)

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| "The one" session is killed/dies | `theOne` flag persists in TinyDB. If session appears in inactive list, no special treatment. Flag clears naturally on delete. |
| "The one" session is paused | Excluded from cycling (same as today for paused sessions). Still shows blue border on dashboard card. Dot still pinned left but grayed. |
| Only one active session | Dots section shows single dot, no separator needed. Cycling disabled (same as today). |
| "The one" is the current session and you cycle forward | Normal cycle — skip "the one" priority check since you're already there. |
| Delete "the one" session | Flag removed with the session. No "the one" is set. |

## Implementation Order

1. **Backend:** Add `theOne` field to model, update PATCH endpoint with mutual exclusivity logic, expose in GET response
2. **Frontend — Icon:** Create `TheOneIcon` SVG component
3. **Frontend — SessionCard:** Add toggle button + blue border
4. **Frontend — Dashboard:** Update sort order
5. **Frontend — Dots:** Pin "the one" left with separator
6. **Frontend — Cycling:** Update `handleCycleSession` with priority logic

## Non-Goals

- No keyboard shortcut for toggling "the one" (can add later)
- No notification/sound when "the one" becomes idle (future enhancement)
- No "the one" concept for inactive/dead sessions
