# Project Lumbergh: Implementation Roadmap

This roadmap focuses on a "Depth First" approach: get a single session working perfectly with the terminal and diffs before building the dashboard to manage multiple of them.

## Phase 1: The "Intern" MVP ✅

**Goal:** A React app that connects to a single tmux session in a specific directory.

- [x] **Backend Scaffold (FastAPI):**
  - [x] Setup `main.py` with FastAPI and libtmux.
  - [x] Create a WS `/api/session/{name}/stream` endpoint that spawns a pty attached to tmux session.
  - [x] Use `uv` + `pyproject.toml` for dependency management.

- [x] **Frontend Scaffold (React + Vite):**
  - [x] Initialize project with `npm create vite@latest frontend -- --template react-ts`.
  - [x] Install `@xterm/xterm`, `@xterm/addon-fit`, native WebSocket.
  - [x] Setup Tailwind CSS.

- [x] **The Terminal Component:**
  - [x] Build `<Terminal />` wrapper around xterm.js.
  - [x] Handle window resizing (manual Fit button for now).
  - [x] Verify: Type in browser, see it in tmux.

- [x] **Input Routing:**
  - [x] Add "Quick Input" text box (for mobile typing).
  - [ ] Add "Push-to-Talk" button (Web Speech API → Text → Backend). *(deferred)*

- [x] **Session Selection:**
  - [x] `GET /api/sessions` to list available tmux sessions.
  - [x] Dropdown to select which session to connect to.

## Phase 2: The "Supervisor" Pane 🚧

**Goal:** Add git diff viewer and file browser so you can review AI changes from mobile.

- [ ] **Backend Git/File API:**
  - [ ] `GET /api/git/status` - current repo status
  - [ ] `GET /api/git/diff` - staged + unstaged changes
  - [ ] `GET /api/files` - list files in repo
  - [ ] `GET /api/files/{path}` - read file contents

- [ ] **Frontend Diff Viewer:**
  - [ ] Create `<DiffViewer />` component with syntax highlighting
  - [ ] File list showing changed files
  - [ ] Expandable/collapsible diff per file

- [ ] **Layout:**
  - [ ] Tab-based navigation: Terminal | Diff | Files
  - [ ] Mobile-friendly layout

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
