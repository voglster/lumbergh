# Lumbergh Feature Roadmap

## Where We Are

Lumbergh is **feature-complete for solo supervision** — terminal streaming, live diffs, git graph, file browser, todos, prompts, multi-session dashboard, mobile PWA, idle detection, AI status summaries. That's a genuinely solid v1. The biggest planned-but-unbuilt piece is the **Manager AI chat pane** (Phase 4).

The competitive landscape is crowded with lightweight tools (claude-squad, agent-view, agtx, agent-deck) but none combine terminal + live diffs + todos + prompt templates + mobile in one package. Lumbergh's unique angle is being the **full supervision cockpit**, not just a session list.

---

## Tier 1: High Impact, Builds on What Exists

### 1. Notifications & Alerts
**Why:** The #1 reason people want a dashboard is to walk away and get pinged when something needs attention. Right now you have to watch.
- Push notifications via PWA (you already have PWA infra)
- "Session needs input" / "Session errored" / "Session idle for 5 min" alerts
- Optional sound/vibration on mobile
- Leverage the existing idle_detector states — the data is already there

### 2. Manager AI Chat Pane
**Why:** This is the planned Phase 4 capstone. The backend AI infra exists (providers, prompts, templates). Missing: chat endpoint, conversation history, and the frontend pane.
- Chat with context: "what did this session just do?" / "review the last 3 commits" / "write me a PR description"
- Auto-inject session context (recent terminal output, git diff, file tree)
- Multi-turn conversation stored per-session
- Could act as a "code review" companion — select a diff hunk, ask the manager about it

### 3. Session Orchestration / Task Queue
**Why:** The market is moving toward parallel agent coordination. Claude Code now has native agent teams, but no good UI for it.
- Define a task list with dependencies ("do auth first, then frontend, then tests")
- Auto-assign tasks to sessions
- Visual task board (kanban-style?) showing which session is working on what
- Block/unblock based on completion signals from idle_detector
- This is the "micromanager" fantasy fully realized

### 4. Terminal Session Recording & Playback
**Why:** You can watch live, but can't review what happened while you were away.
- Record terminal output to scrollback files (tmux `capture-pane` or pipe-pane)
- Playback UI with timeline scrubbing
- "What happened while I was gone?" summary (feed recording to AI)
- Great for debugging AI mistakes after the fact

---

## Tier 2: Quality of Life & Polish

### 5. Desktop/External Notifications
- Native OS notifications via `notify-send` or `osascript`
- Slack/Discord webhook integration for remote alerts
- Configurable per-session notification rules

### 6. Session Analytics & Metrics
- Commits per hour, lines changed, time-to-idle
- Cost estimation (if using paid AI providers)
- "Productivity" trends over time
- Which sessions are productive vs spinning their wheels

### 7. Global Search
- Search across all session files, todos, scratchpads, prompts
- Fuzzy file finder across all projects
- Search terminal scrollback history

### 8. Side-by-Side Diff View
- Toggle between unified and split diff
- Inline commenting on diff hunks (stored as notes, not GitHub comments)
- "Accept/reject" individual hunks before committing

### 9. Merge Conflict Resolution UI
- Visual merge tool when sessions create conflicting changes
- Three-way diff view
- Especially valuable when running parallel worktree sessions

### 10. Quick Actions / Command Palette
- Cmd+K style command palette
- Jump to any session, file, todo, prompt
- Run common actions: "restart backend", "run tests", "commit all"
- Keyboard-driven workflow for power users

---

## Tier 3: Differentiators & Moat

### 11. Cross-Tool Session Handoff
**Why:** People use Claude Code, Cursor, Aider, Copilot. The `continues` project (182 cross-tool handoff paths) shows demand.
- Export session context (CLAUDE.md, recent diffs, todos) in a format other tools can consume
- Import context from other tools
- "Continue this in Cursor" / "Hand off to Aider" buttons

### 12. Git Worktree Orchestrator
**Why:** You already support worktree creation. Take it further.
- Visual branch topology showing which worktrees exist
- One-click "spawn a new agent on a feature branch"
- Auto-merge worktree back to main when CI passes
- PR creation from worktree with AI-generated description

### 13. CLAUDE.md / Context File Editor
- Built-in editor for CLAUDE.md, PLAN.md, and similar context files
- AI-assisted: "generate a CLAUDE.md from this repo's structure"
- Sync context files across sessions
- Version history for context files

### 14. Plugin / Hook System
- User-defined hooks: "on session idle, run tests" / "on commit, lint"
- Plugin API for custom dashboard widgets
- Community-shareable prompt template packs

### 15. Multi-Machine Support
- Connect to tmux sessions on remote machines via SSH
- Tailscale-native discovery (you already recommend Tailscale)
- Centralized dashboard for sessions across multiple dev machines

---

## Recommended Build Order

1. **Notifications** — small effort, massive value. People need to walk away.
2. **Manager AI Chat** — completes the vision, uses existing infra.
3. **Terminal Recording** — tmux makes this easy, huge debugging value.
4. **Command Palette** — makes power users love the tool.
5. **Session Orchestration** — the "10x" feature that makes Lumbergh the coordination layer, not just a viewer.

---

## Anti-Patterns to Avoid

- Don't try to replace the terminal — Lumbergh supervises, it doesn't drive
- Don't build a full IDE — file browser and diffs are for monitoring, not editing
- Don't add auth/multi-tenant — keep it personal/team, trust the network
- Don't over-invest in AI chat before notifications — people need alerts before they need a conversation
