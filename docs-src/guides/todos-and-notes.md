---
title: Todos & Notes
---

# Todos & Notes

The **Todo** tab in the right pane gives you a lightweight task tracker and scratchpad for each session.

## Task List

A per-session checklist for tracking what you've asked the AI to do.

- **Add tasks** using the input field at the top
- **Check off** completed items -- completed tasks automatically sort to the bottom
- **Drag to reorder** -- prioritize what matters
- **Send to terminal** -- click a todo to inject it into the active terminal session
- **Move between sessions** -- transfer todos from one project to another

!!! tip "A practical workflow"
    Before kicking off a session, jot down the tasks you want the AI to tackle. Check them off as you review the diffs. This keeps you organized when managing multiple sessions.

## Scratchpad

A freeform text area for notes, context, or anything else you want to keep alongside the session. Each session has its own scratchpad.

Use it for:

- Pasting requirements or acceptance criteria
- Noting decisions or context the AI might need
- Keeping a log of what you've tried

## Persistence

Both todos and scratchpad content persist across restarts. Data is stored **per-project** (keyed by repository path), so multiple sessions pointing at the same repo share the same todos and scratchpad.

```
~/.config/lumbergh/projects/{repo-hash}.json
```

No external database required -- everything is local JSON files.
