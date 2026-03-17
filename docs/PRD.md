# Product Requirements Document: "Project Lumbergh"

## 1. Product Overview

Lumbergh is a self-hosted, web-based orchestration dashboard designed to supervise a fleet of AI coding agents (Claude Code, Cursor, Aider, etc.). It acts as the ultimate micromanager for developers who need to oversee multiple asynchronous coding tasks across different repositories without losing context.

### 1.1 Problem Statement

- **The "Herding Cats" Problem:** Managing 20 concurrent AI sessions in a terminal is mentally exhausting. Users lose track of which intern is doing what.
- **The "Did You Get The Memo?" Problem:** CLI Agents often drift off-task. They need a manager to review their work (Diffs) and correct their course (Voice/Text) in real-time.
- **Context Fragmentation:** The "Plan" usually lives in the user's head, while the "Code" lives in the terminal. When switching between tasks, the user forgets the plan.

### 1.2 Value Proposition

- **"Yeah... I'm gonna need you to come in on Saturday":** Utilizing tmux ensures that if the connection drops, the AI keeps working.
- **Mass Concurrency:** Run 10+ AI sessions in parallel. While Intern A runs tests, you are reviewing Intern B's code.
- **"Over-the-Shoulder" Supervision:** Live, auto-updating diffs allow you to spot hallucinations immediately.
- **The "Lumbergh" Experience:** Use quick text inputs to bark corrections directly into the terminal.
- **Mobile-First:** Full functionality from a phone or tablet over Tailscale.

## 2. Core Features

### 2.1 The Office Floor (Dashboard)

**Cubicle Grid:** A bird's-eye view of all active tmux sessions as cards.

**Status Indicators (Idle Detection):**
- 🟢 Working (Claude is generating, running tools, reading/writing files)
- 🟡 Idle (Waiting for user input, approval prompt visible)
- 🔴 Error (Rate limited, API error, crashed, shell prompt = agent exited)
- 🔴 Stalled (Working > 10 minutes without progress)
- ⚪ Offline (Session not running)

**New Hire Orientation (Session Creation):**
- **Mode A (Desk Assignment):** Open in an existing repository with directory picker search.
- **Mode B (The Annex):** Auto-create a git worktree and spawn a fresh session on a branch.
- **Mode C (New Project):** Initialize a new git repo and start fresh.
- **Agent Selection:** Choose which AI agent to run (Claude Code, Cursor, Aider, Gemini CLI, OpenCode, Codex).

**Session Management:**
- Custom display names and descriptions per session
- Pause/unpause sessions
- Session reset (kill and respawn agent)
- Delete with optional worktree cleanup

### 2.2 The Cubicle (Session View)

A unified interface for micromanaging a single "Intern" via tabbed navigation.

#### Terminal Tab
- **Web Terminal:** xterm.js attached to the tmux session via WebSocket.
- **Quick Input:** Dedicated input box for typing commands without focusing the terminal.
- **Send to Terminal:** One-click buttons to inject prompt text from todos or templates.
- **Tmux Controls:** Window navigation, copy-mode, scroll (page-up/down).

#### Git Tab
- **Live Diffs:** Real-time `git diff` visualization with syntax highlighting, auto-refreshed via background cache.
- **Diff Stats:** File count, insertions/deletions badge.
- **Commit History:** Scrollable log with per-commit diff viewing.
- **Git Graph:** Metro-style commit graph visualization.
- **Git Operations:** Commit, amend, reword, reset, revert, stash, cherry-pick, rebase, branch create/delete, push, force-push, fast-forward, checkout.
- **Remote Status:** Ahead/behind tracking branch indicator.

#### Files Tab
- **File Browser:** Tree view of project files with syntax-highlighted content viewing.

#### Todo Tab
- **Todo List:** Add/edit/delete/reorder tasks per project.
- **Scratchpad:** Free-form notes area.
- **Cross-Session:** Move todos between projects. Data shared across sessions pointing at the same repo.

#### Prompts Tab
- **Prompt Templates:** Reusable text templates (project-scoped and global).
- **Copy Between Scopes:** Promote project templates to global or copy global to project.
- **Send to Terminal:** One-click injection of template text.

#### Shared Files Tab
- **Cross-Project Sharing:** Upload files to `~/.config/lumbergh/shared/` for access from any session.
- **Image Support:** View uploaded screenshots and images inline.
- **Save as Prompt:** Convert shared file content into a prompt template.

### 2.3 AI Features

- **Commit Message Generation:** AI-generated conventional commit messages from the current diff.
- **Prompt Name Generation:** AI-generated snake_case names for prompt templates.
- **Status Summaries:** 2-3 word AI-generated session status labels.
- **Multi-Provider:** Ollama (local), OpenAI, Anthropic, Google, OpenAI-compatible endpoints.
- **AI Prompt Management:** Customizable prompt templates for AI tasks (global + per-project).

### 2.4 Settings & Auth

- **Optional Password Protection:** Single shared password, cookie-based sessions (30-day).
- **Global Settings:** Repo search directory, git graph commit limit, AI provider config, default agent.
- **Version Check:** PyPI update detection.

## 3. Technical Constraints

- **Self-Contained:** No external enterprise databases. Runs on a standard dev machine.
- **Portable Data:** Metadata in TinyDB (JSON). User content in Markdown (file-system first).
- **Network:** Binds to `0.0.0.0`. Designed for Tailscale secure remote access with HTTPS/TLS support.
- **Performance:** Background diff/graph caching with git fingerprinting. ETag middleware for bandwidth-efficient polling.
- **PWA:** Installable web app with workbox caching for offline static assets.
- **Testing:** E2E API tests (httpx/pytest) + UI tests (Playwright/pytest-bdd) running in QEMU VMs.
