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
  - [x] Handle window resizing (auto-fit on resize).
  - [x] Stable session management (PTY pooling to handle React StrictMode).
  - [x] Configurable font sizing.

- [x] **Input Routing:**
  - [x] Add "Quick Input" text box (for mobile typing).
  - [x] `POST /api/session/{name}/send` for sending text to terminal.
  - [ ] Add "Push-to-Talk" button (Web Speech API → Text → Backend). *(deferred)*

- [x] **Session Selection:**
  - [x] `GET /api/sessions` to list available tmux sessions.
  - [x] Dropdown to select which session to connect to.

## Phase 2: The "Supervisor" Pane ✅

**Goal:** Add git diff viewer and file browser so you can review AI changes from mobile.

- [x] **Backend Git/File API:**
  - [x] `GET /api/git/status` - current repo status
  - [x] `GET /api/git/diff` - staged + unstaged changes (including untracked files)
  - [x] `GET /api/git/log` - recent commit history
  - [x] `GET /api/git/commit/{hash}` - diff for a specific commit
  - [x] `POST /api/git/commit` - stage all and commit
  - [x] `GET /api/files` - list files in repo
  - [x] `GET /api/files/{path}` - read file contents with language detection

- [x] **Frontend Diff Viewer:**
  - [x] Create `<DiffViewer />` component with syntax highlighting
  - [x] `<FileList />` showing changed files
  - [x] `<FileDiff />` for expandable/collapsible diff per file
  - [x] `<CommitList />` for viewing commit history
  - [x] Quick commit functionality with message input

- [x] **File Browser:**
  - [x] `<FileBrowser />` component with tree view
  - [x] File content viewing with syntax highlighting

- [x] **Layout:**
  - [x] `<ResizablePanes />` for desktop side-by-side split
  - [x] Tab-based navigation: Terminal | Diff | Files | Todo | Prompts
  - [x] Mobile-friendly tabbed layout
  - [x] Diff stats badge showing file count and +/- lines

## Phase 3: The "Office Floor" ✅

**Goal:** Scale from one hardcoded session to a Dashboard managing many.

- [x] **Persistence Layer (TinyDB):**
  - [x] TinyDB setup in `~/.config/lumbergh/sessions.json`
  - [x] Session-scoped storage in `~/.config/lumbergh/session_data/{name}.json`
  - [x] Global storage for cross-project data (`~/.config/lumbergh/global.json`)

- [x] **Session Management API:**
  - [x] `GET /api/sessions`: List existing tmux sessions (merged live + stored state)
  - [x] `POST /api/sessions`: Create new session
    - [x] Accept `name`, `workdir`, `description`
    - [x] Spawn new named tmux session
    - [x] Auto-launch Claude Code in new session
  - [x] `DELETE /api/sessions/{name}`: Kill session and remove metadata

- [x] **Session-Scoped APIs:**
  - [x] `GET /api/sessions/{name}/git/status`
  - [x] `GET /api/sessions/{name}/git/diff`
  - [x] `GET /api/sessions/{name}/git/log`
  - [x] `GET /api/sessions/{name}/git/commit/{hash}`
  - [x] `POST /api/sessions/{name}/git/commit`
  - [x] `GET/POST /api/sessions/{name}/todos`
  - [x] `GET/POST /api/sessions/{name}/scratchpad`

- [x] **Dashboard UI:**
  - [x] Create `Dashboard.tsx` (Grid view of sessions)
  - [x] Create `CreateSessionModal.tsx`
  - [x] Add routing (`react-router-dom`) to navigate between `/` (Dashboard) and `/session/:name`
  - [x] Session status indicators (green dot for alive, attached/orphan badges)

## Phase 4: The "Manager" & Context ⏳

**Goal:** The "Brain" pane with Notes, Todos, and AI Chat.

- [x] **Notes & Planning UI:**
  - [x] `<TodoList />` component with add/edit/delete/reorder
  - [x] `<Scratchpad />` component for free-form notes
  - [x] `<PromptTemplates />` for reusable prompts
    - [x] Project-specific templates
    - [x] Global templates (shared across projects)
    - [x] Copy between project/global
    - [x] Send to terminal functionality
  - [x] `<VerticalResizablePanes />` for splitting Todo/Scratchpad

- [x] **Notes API:**
  - [x] `GET/POST /api/todos` - Todo list persistence
  - [x] `GET/POST /api/scratchpad` - Scratchpad persistence
  - [x] `GET/POST /api/prompts` - Project prompt templates
  - [x] `GET/POST /api/global/prompts` - Global prompt templates
  - [x] Copy endpoints between project/global

- [ ] **The Manager Agent (Backend):**
  - [ ] Integrate `anthropic` or `openai` SDK
  - [ ] Construct the "Context Packet" (Plan + Diff + User Query)
  - [ ] Create Chat Endpoint (`POST /api/chat`)

- [ ] **The Manager Agent (Frontend):**
  - [ ] Build Chat UI in a new pane/tab
  - [ ] Add "Review Code" button that sends the current Diff to the LLM

## Phase 5: Polish & Mobile ⏳

**Goal:** Make it usable on a phone.

- [x] **Responsive Design:** Terminal/Diff/Notes stack correctly via tabs on mobile
- [x] **Resizable Panes:** Persistent split positions via localStorage
- [ ] **Virtual Keyboard Handling:** Prevent the keyboard from covering the input box
- [x] **PWA Config:** VitePWA fully configured with manifest, icons, and workbox caching
