# Product Requirements Document: "Project Lumbergh"

## 1. Product Overview

Lumbergh is a self-hosted, web-based orchestration dashboard designed to supervise a fleet of AI coding interns (Claude Code). It acts as the ultimate micromanager for developers who need to oversee multiple asynchronous coding tasks across different repositories without losing context.

### 1.1 Problem Statement

- **The "Herding Cats" Problem:** Managing 20 concurrent AI sessions in a terminal is mentally exhausting. Users lose track of which intern is doing what.
- **The "Did You Get The Memo?" Problem:** CLI Agents often drift off-task. They need a manager to review their work (Diffs) and correct their course (Voice/Text) in real-time.
- **Context Fragmentation:** The "Plan" usually lives in the user's head, while the "Code" lives in the terminal. When switching between tasks, the user forgets the plan.

### 1.2 Value Proposition

- **"Yeah... I'm gonna need you to come in on Saturday":** Utilizing tmux ensures that if the connection drops, the AI keeps working.
- **Mass Concurrency:** Run 10+ AI sessions in parallel. While Intern A runs tests, you are reviewing Intern B's code.
- **"Over-the-Shoulder" Supervision:** Live, auto-updating diffs allow you to spot hallucinations immediately.
- **The "Lumbergh" Experience:** Use voice-to-text or quick text inputs to bark corrections directly into the terminal or ask the "Manager" agent to research Jira tickets.

## 2. Core Features

### 2.1 The Office Floor (Dashboard)

**Cubicle Grid:** A bird's-eye view of all active tmux sessions.

**Status Indicators:**
- 🟢 Typing Furiously (Claude is generating)
- 🟡 Sipping Coffee (Idle/Waiting for input)
- 🔴 Jamming the Printer (Error/Crashed/Rate limited)
- 🔴 Asleep at the Desk (Stalled - working 10+ min without progress)
- ⚪ Called in Sick (Session offline)

**New Hire Orientation (Session Creation):**
- **Mode A (Desk Assignment):** Open in an existing repository.
- **Mode B (The Annex):** Auto-create a git worktree (e.g., `feat/login-page`) and spawn a fresh session there.

### 2.2 The Cubicle (Session View)

A unified interface for micromanaging a single "Intern".

#### Pane A: Terminal & Execution (The Intern)

- **Web Terminal:** xterm.js attached to a specific tmux window where Claude is running.
- **Intercom (Input):**
  - **Voice-to-Text:** "Push to Talk" button.
  - **Quick Text:** A dedicated input box to type commands/feedback without focusing the terminal cursor manually.
  - **Routing:** Toggle switch to send input to The Intern (Terminal) or The Manager (Pane C).
- **Micromanage Buttons:** Quick macros for `git status`, `ls`, `clear`.

#### Pane B: Diff Monitor (The Review)

- **Live Diffs:** Real-time visualization of `git diff` (unstaged changes).
- **Syntax Highlighting:** Visualizes code changes clearly (green/red).
- **Auto-Refresh:** Updates automatically when the file system changes.

#### Pane C: Context & Planning (The Manager)

**The Action Items (Todo List):**
- **Visual Task Board:** A dedicated view of high-level tasks parsed from `TODO.md` or `PLAN.md`.
- **Interactive State:** Checkboxes that sync bidirectionally (User clicks UI → updates MD file; Agent updates MD file → updates UI).
- **Agent Awareness:** The Manager AI reads this list to understand "Where are we?" and "What is next?".
- **Task Injection:** One-click button to "Assign to Intern" (Pastes the task text into the Terminal input).

**Knowledge Base:**
- **Multi-File Structure:** Support for a folder of Markdown files (e.g., `docs/`, `specs/`) and images.
- **File Browser:** Simple tree view to switch between context documents.

**The Manager Agent (AI Assistant):**
- **Capabilities:** A "Smart" agent with RAG (Retrieval-Augmented Generation) access to the Knowledge Base and Action Items.
- **Tools:**
  - **Jira/Ticket Tool:** Ability to fetch ticket details given an ID or URL.
  - **Codebase RAG:** Ability to answer questions about the current state of the code.
- **Chat Interface:**
  - Ask questions ("Why did Claude change the auth logic?").
  - Give instructions ("Update the Action Items based on this Jira ticket").
  - Generate feedback ("Draft a critique of the Intern's code for me to paste into the terminal").

## 3. Technical Constraints

- **Self-Contained:** No external enterprise databases. Runs on a standard dev machine.
- **Portable Data:** Metadata in JSON. User content in Markdown (File-system first).
- **Network:** Binds to Tailscale IP for secure remote access.
