# Project Lumbergh: Implementation Roadmap

This roadmap focuses on a "Depth First" approach: get a single session working perfectly with the terminal and diffs before building the dashboard to manage multiple of them.

## Phase 1: The "Intern" MVP

**Goal:** A React app that connects to a single tmux session in a specific directory.

- [ ] **Backend Scaffold (FastAPI):**
  - [ ] Setup `main.py` with FastAPI and libtmux.
  - [ ] Create a WS `/api/stream` endpoint that spawns a pty attached to a hardcoded tmux session (e.g., `lumbergh_dev`).

- [ ] **Frontend Scaffold (React + Vite):**
  - [ ] Initialize project with `npm create vite@latest client -- --template react-ts`.
  - [ ] Install `xterm.js`, `xterm-addon-fit`, and `socket.io-client` (or native WS).

- [ ] **The Terminal Component:**
  - [ ] Build `<Terminal />` wrapper around xterm.js.
  - [ ] Handle window resizing (frontend → backend).
  - [ ] Verify: Type `ls` in browser, see it in local tmux window.

- [ ] **Input Routing:**
  - [ ] Add "Quick Input" text box (for mobile typing).
  - [ ] Add "Push-to-Talk" button (Web Speech API → Text → Backend).

## Phase 2: The "Supervisor" Pane

**Goal:** Add the "Over-the-Shoulder" monitoring view for that single session.

- [ ] **Backend Diff Logic:**
  - [ ] Create endpoint `GET /api/diff` that runs `git diff HEAD` in the target directory.
  - [ ] Return parsed JSON: `{ files: [...], additions: 10, deletions: 2, raw: "..." }`.

- [ ] **Frontend Polling:**
  - [ ] Install `@tanstack/react-query`.
  - [ ] Create `<DiffMonitor />` component that polls every 3s.
  - [ ] Render diffs using a syntax highlighter (e.g., `react-diff-view` or `prismjs`).

- [ ] **Layout:**
  - [ ] Implement the Split-Pane layout (Terminal on Left/Top, Diffs on Right/Bottom).

## Phase 3: The "Office Floor"

**Goal:** Scale from one hardcoded session to a Dashboard managing many.

- [ ] **Persistence Layer (TinyDB):**
  - [ ] Implement `db.py` to save Session Metadata (ID, Path, Name, Status).

- [ ] **Session Management API:**
  - [ ] `GET /api/sessions`: List active sessions (sync DB with actual `tmux ls`).
  - [ ] `POST /api/sessions`:
    - [ ] Accept `repo_url` or `path`.
    - [ ] (Optional) Create git worktree.
    - [ ] Spawn new named tmux session.

- [ ] **Dashboard UI:**
  - [ ] Create `Dashboard.tsx` (Grid view of sessions).
  - [ ] Create `NewSessionModal.tsx`.
  - [ ] Add routing (`react-router-dom`) to navigate between `/` (Dashboard) and `/session/:id`.

## Phase 4: The "Manager" & Context

**Goal:** The "Brain" pane with Notes, Todos, and AI Chat.

- [ ] **File System API:**
  - [ ] `GET /api/context`: Read `PLAN.md` and `docs/*.md`.
  - [ ] `POST /api/context`: Save changes to Markdown files.

- [ ] **The "Memo" UI:**
  - [ ] Create `<MarkdownEditor />` (e.g., using Milkdown or simple textarea with preview).
  - [ ] Implement "Action Items" (Todo list) parsing from Markdown.

- [ ] **The Manager Agent (Backend):**
  - [ ] Integrate `anthropic` or `openai` SDK.
  - [ ] Construct the "Context Packet" (Plan + Diff + User Query).
  - [ ] Create Chat Endpoint (`POST /api/chat`).

- [ ] **The Manager Agent (Frontend):**
  - [ ] Build Chat UI in the third pane.
  - [ ] Add "Review Code" button that sends the current Diff to the LLM.

## Phase 5: Polish & Mobile

**Goal:** Make it usable on a phone.

- [ ] **Responsive Design:** Ensure Terminal/Diff/Notes stack correctly on portrait.
- [ ] **Virtual Keyboard Handling:** Prevent the keyboard from covering the input box.
- [ ] **PWA Config:** Add `manifest.json` so it can be installed to the home screen.
