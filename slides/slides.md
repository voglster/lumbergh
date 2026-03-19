---
theme: default
title: Lumbergh
info: A self-hosted dashboard for supervising AI coding agents
highlighter: shiki
drawings:
  persist: false
transition: slide-left
mdc: true
---

<div class="flex items-center justify-center h-full">
<div class="text-center">

# Lumbergh

### *"Yeah, if you could just supervise all your AI agents from one dashboard... that'd be great."*

<img src="/images/lumbergh.jpg" class="mx-auto mt-6 rounded-xl shadow-2xl w-80" />

<p class="mt-6 text-sm opacity-60">Be Lumbergh. Micromanage all your AIs.</p>

</div>
</div>

<style>
h1 {
  font-size: 3.5em !important;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
</style>

<!--
Hi, I'm Jim. I've been running multiple Claude Code agents in parallel for months now, and I built a tool to keep them from going off the rails. It's called Lumbergh -- named after everyone's favorite micromanager.
-->

---
layout: image-right
image: /images/cat-laptop.jpg
---

# The Problem

You're running 5 Claude Code sessions in tmux.

<br>

- You kick off session 1 in the morning, dive deep into session 3
- End of the day: *"oh shit, session 1 has been sitting idle for 6 hours"*
- Meanwhile session 4 went overboard -- time to `git reset`
- You can't herd 5 cats when you can only see one at a time

<!--
True story. I had 5 Claude Code sessions running in tmux. I kicked one off in the morning, got deep into another session, and when I was logging off for the day I saw it -- just sitting there, idle, waiting for me. I wanted that work done today. Gone. And that's the nice failure mode -- the worse one is when you check on a session and it's gone way overboard, refactored half your codebase, and you're doing git resets. You can't herd 5 cats if you can only look at one at a time. tmux is great for persistence, but it doesn't help you see the big picture.
-->

---
layout: center
---

# Why Not Just Terminal Tabs?

<br>

- You can't see what 5 agents are doing **at once**
- You can't see their git diffs **without switching context**
- You can't send the next prompt **from your phone between sets at the gym**
- Rest periods are the perfect time to keep agents moving

<!--
The obvious question: just use terminal tabs. But tabs are sequential -- you can only look at one at a time. You can't glance at a dashboard and see all 5 agents at once. And here's the thing -- I work out during the day, and between lifting sets you've got 2-3 minutes of rest. That's the perfect window to pull out your phone, check which agents are idle, and fire off the next prompt. Keep all 5 moving while you're away from the desk. Terminal tabs can't do that.
-->

---

# The Solution

<img src="/images/screenshot-dashboard.png" class="rounded-lg shadow-xl mt-2 mx-auto" style="max-height: 440px" />

<!--
So I built this. One dashboard, all your sessions. Each card shows the session name, what it's working on, its current status, and the repo path. Green dot means active, yellow means waiting for input. You can click into any session to get the full view.
-->

---

# What You Get

<div class="grid grid-cols-4 gap-4 mt-6 px-4">
<div class="text-center">
<img src="/images/crop-terminal.png" class="rounded-xl shadow-xl mx-auto" style="max-height: 380px" />
<p class="text-sm mt-3 font-medium">Terminal</p>
</div>
<div class="text-center">
<img src="/images/crop-git.png" class="rounded-xl shadow-xl mx-auto" style="max-height: 380px" />
<p class="text-sm mt-3 font-medium">Git + Commits</p>
</div>
<div class="text-center">
<img src="/images/crop-todo.png" class="rounded-xl shadow-xl mx-auto" style="max-height: 380px" />
<p class="text-sm mt-3 font-medium">Todos & Notes</p>
</div>
<div class="text-center">
<img src="/images/crop-files.png" class="rounded-xl shadow-xl mx-auto" style="max-height: 380px" />
<p class="text-sm mt-3 font-medium">File Browser</p>
</div>
</div>

<!--
When you click into a session, you get four tabs. Terminal is a full xterm.js terminal over WebSocket -- you can type, scroll, everything. Git tab shows live diffs and a metro-style commit graph as the agent works. Todos let you track what each agent should be working on. And the file browser lets you browse the repo without leaving the dashboard.
-->

---
layout: center
---

# Batteries Included

<div class="grid grid-cols-3 gap-x-12 gap-y-10 mt-6 px-8">

<div class="text-center">
<div class="text-4xl mb-2">🌳</div>
<div class="font-bold">Worktrees</div>
<div class="text-sm opacity-70 mt-1">One-click isolated feature branches</div>
</div>

<div class="text-center">
<div class="text-4xl mb-2">🎯</div>
<div class="font-bold">Prompt Templates</div>
<div class="text-sm opacity-70 mt-1">Variables + one-click fire at any session</div>
</div>

<div class="text-center">
<div class="text-4xl mb-2">🔌</div>
<div class="font-bold">Pluggable AI</div>
<div class="text-sm opacity-70 mt-1">Anthropic, OpenAI, Google, Ollama</div>
</div>

<div class="text-center">
<div class="text-4xl mb-2">🚇</div>
<div class="font-bold">Git Graph</div>
<div class="text-sm opacity-70 mt-1">Metro-style commit visualization</div>
</div>

<div class="text-center">
<div class="text-4xl mb-2">📱</div>
<div class="font-bold">PWA + Tailscale</div>
<div class="text-sm opacity-70 mt-1">Install on phone, access from anywhere</div>
</div>

<div class="text-center">
<div class="text-4xl mb-2">🔗</div>
<div class="font-bold">Shared Context</div>
<div class="text-sm opacity-70 mt-1">Cross-session files for coordinating agents</div>
</div>

</div>

<!--
Quick feature tour. Worktrees: one click to spin up an isolated git branch for each agent so they don't step on each other. Prompt templates with variables -- write once, fire at any session. Pluggable AI provider for the manager chat. Git graph shows the commit history as a metro map. PWA so you can install it on your phone -- combine with Tailscale and you can check your agents from anywhere. And shared context files that all agents can read, so you can coordinate them.
-->

---

# Mobile-First

<div class="flex justify-center gap-8 mt-4">
<div class="text-center">
<img src="/images/screenshot-mobile-dashboard.png" class="rounded-lg shadow-xl" style="max-height: 380px" />
<p class="text-sm mt-2 opacity-70">Check on your agents</p>
</div>
<div class="text-center">
<img src="/images/screenshot-mobile-git.png" class="rounded-lg shadow-xl" style="max-height: 380px" />
<p class="text-sm mt-2 opacity-70">Review their code</p>
</div>
</div>

<!--
This is what it looks like on your phone. Left is the dashboard -- you can see all your sessions, their status, what they're working on. Right is the git tab from inside a session -- full diff view, commit graph, you can even commit and push from your phone. I use this constantly -- kick off a few agents, go make coffee, check on them from my phone.
-->

---
layout: center
---

# Architecture

<br>

```mermaid {scale: 0.72}
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#3730a3', 'primaryTextColor': '#e0e7ff', 'primaryBorderColor': '#6366f1', 'lineColor': '#818cf8', 'secondaryColor': '#4c1d95', 'tertiaryColor': '#1e1b4b', 'mainBkg': '#3730a3', 'clusterBkg': '#1e1b4b80', 'clusterBorder': '#6366f1', 'edgeLabelBackground': '#1e1b4b', 'nodeTextColor': '#e0e7ff', 'titleColor': '#c7d2fe' }, 'flowchart': { 'nodeSpacing': 60, 'rankSpacing': 80, 'curve': 'basis', 'padding': 20 }}}%%
graph LR
    subgraph Browser["Browser"]
        Term([Terminal])
        UI([Dashboard])
        Diff([Diff Viewer])
    end

    subgraph Python["FastAPI Backend"]
        WS([WebSocket])
        REST([REST API])
        DB[(TinyDB)]
    end

    subgraph System["Local System"]
        TMUX([tmux])
        GIT([git repos])
        FS([~/.config/lumbergh/])
    end

    Term <-->|WebSocket| WS
    UI -->|poll| REST
    Diff -->|poll| REST

    WS <-->|libtmux| TMUX
    REST -->|subprocess| GIT
    REST <--> DB
    DB -.->|JSON| FS

    style Browser rx:14,ry:14
    style Python rx:14,ry:14
    style System rx:14,ry:14
```

<p class="mt-8 text-center text-lg opacity-70">~5k lines of Python. No Postgres, no Redis, no Docker.</p>

<!--
The architecture is deliberately boring. React frontend talks to a FastAPI backend. Terminal streams over WebSocket -- the backend uses libtmux to attach to tmux sessions and pipe the PTY data. Everything else is REST polling -- git diffs, file listings, session metadata. TinyDB for persistence -- just JSON files in ~/.config/lumbergh. No Postgres, no Redis, no Docker, no message queue. About 5k lines of Python total. The whole thing runs as two processes: backend and frontend dev server.
-->

---

# The Interesting Bit

```python
# The whole terminal -- a WebSocket, a PTY, and asyncio
@app.websocket("/ws/terminal/{session}/{pane}")
async def terminal_ws(websocket: WebSocket, session: str, pane: str):
    await websocket.accept()
    pty = session_manager.attach(session, pane)

    async for data in pty.stream():
        await websocket.send_bytes(data)

# Live diffs -- just shell out to git
@app.get("/api/diff/{session}")
async def get_diff(session: str):
    result = subprocess.run(
        ["git", "diff", "--stat", "--patch"],
        capture_output=True, cwd=session_path
    )
    return parse_diff(result.stdout)
```

<div class="mt-4 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20 text-center">
FastAPI makes the async plumbing almost invisible.
</div>

<!--
Here's what the core looks like. The terminal endpoint is 6 lines -- accept a WebSocket, attach to the tmux pane via libtmux, stream the bytes. That's it. The diff endpoint is even simpler -- just shell out to git and parse the output. FastAPI's async support makes this almost trivial. The session_manager handles PTY pooling so multiple browser tabs can watch the same session without spawning extra processes.
-->

---

# Under the Hood: PTY Pooling & State Detection

<div class="grid grid-cols-2 gap-6 mt-2">
<div>

```python
# One PTY per session, many viewers
class SessionManager:
    async def register_client(self, name, ws):
        async with self._lock:
            if name not in self._sessions:
                pty = TmuxPtySession(name)
                pty.spawn()
                self._sessions[name] = ManagedSession(
                    pty=pty, clients={ws}
                )
            else:
                self._sessions[name].clients.add(ws)
```

</div>
<div>

```python
# Regex-based agent state detection
class IdleDetector:
    WORKING_PATTERNS = [
        re.compile(r"⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏"),
        re.compile(r"Running…|Executing"),
    ]
    IDLE_PATTERNS = [
        re.compile(r"\u276f"),  # Agent prompt
        re.compile(r"Do you want to proceed\?"),
    ]
    ERROR_PATTERNS = [
        re.compile(r"rate limit|429", re.I),
    ]
```

</div>
</div>

<div class="mt-4 p-3 bg-indigo-500/10 rounded-lg border border-indigo-500/20 text-center">
No polling APIs, no agent plugins — just read the terminal output and pattern-match.
</div>

<!--
Two pieces of Python I'm proud of. On the left: PTY pooling. When you open a session in your browser, we attach to the tmux pane via libtmux and create one PTY process. If you open a second tab, or your teammate opens the same URL, they share that same PTY -- no extra processes. An asyncio lock prevents race conditions. When the last viewer disconnects, we clean up.

On the right: idle detection. The dashboard shows green/yellow/red status dots for each agent. How? We just read the last 10 lines of terminal output and pattern-match. Spinner characters mean working. The prompt character means idle. Rate limit messages mean error. No special API, no agent plugins -- just regex on terminal output. It works with Claude Code, Cursor, any CLI agent.
-->

---

# Lumbergh Cloud: What's Next

<div class="grid grid-cols-2 gap-8 mt-6">

<div>

```mermaid {scale: 0.7}
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#3730a3', 'primaryTextColor': '#e0e7ff', 'primaryBorderColor': '#6366f1', 'lineColor': '#818cf8', 'secondaryColor': '#4c1d95', 'tertiaryColor': '#1e1b4b', 'mainBkg': '#3730a3', 'nodeTextColor': '#e0e7ff' }, 'flowchart': { 'curve': 'basis', 'padding': 12 }}}%%
graph LR
    Local["Your Machine<br/>+ Lumbergh"] -->|"WSS tunnel"| Cloud["Lumbergh Cloud<br/>FastAPI + MongoDB"]
    Cloud -.->|"relay"| Local
    Phone["Your Phone"] -->|"HTTPS"| Cloud
```

</div>

<div class="flex flex-col justify-center">

**What the cloud does**
- Share & import prompt templates
- Sync settings across machines
- Mobile access — no port forwarding

**Thinking about...**
- Push notifications when agents idle
- Team workspaces for shared sessions
- Hosted VMs — no local box needed

</div>
</div>

<div class="mt-4 p-3 bg-purple-500/10 rounded-lg border border-purple-500/20 text-center">
The app works 100% offline. Cloud is just a companion I'm building — all FastAPI + Motor on the other side too.
</div>

<!--
So what's next? I'm building a companion cloud server. The interesting bit: your local app opens an outbound WebSocket to the cloud -- no port forwarding, no firewall holes. The cloud relays requests back through that tunnel. It's FastAPI on both sides -- the cloud uses Motor for async MongoDB.

What it does today: prompt sharing so you can publish templates and import others'. Settings sync across machines. And mobile access -- check your agents from your phone without needing Tailscale.

Things I'm thinking about: push notifications when an agent needs input so you don't have to keep checking. Team workspaces so you can pair on sessions. Maybe hosted VMs eventually.

But really -- this is all open source, I'd love contributions. Try it, break it, file issues. If you have ideas for features, the roadmap is completely open. It's about 5k lines of Python -- very approachable codebase.
-->

---
layout: center
class: text-center
---

# Demo Time

<img src="/images/milton.png" class="mx-auto rounded-xl shadow-2xl w-96 mt-4" />

<p class="mt-4 text-2xl italic opacity-70">"I was told there would be a live demo."</p>

<div class="mt-4 grid grid-cols-3 gap-6 text-sm opacity-50 max-w-lg mx-auto">
<div>WiFi works: <span class="text-green-500 font-bold">TBD</span></div>
<div>tmux alive: <span class="text-green-500 font-bold">TBD</span></div>
<div>Agents behaving: <span class="text-red-500 font-bold">lol</span></div>
</div>

<!--
Alright, let's see if this actually works. I've got a few agents running right now -- let me switch over to the dashboard and walk you through it live.

DEMO PLAN:
1. Show dashboard with active sessions
2. Click into a session, show terminal tab
3. Switch to Git tab -- show live diff
4. Show the commit graph
5. Quick look at mobile view if time permits
6. Fire a prompt template at a session
-->

---
layout: center
class: text-center
---

# Try It Tonight

<div class="mt-4">

```bash
uv tool install pylumbergh && lumbergh
```

</div>

<p class="mt-4 opacity-70">One command. Installs from PyPI, starts on localhost:8420.<br>No Docker. No database. No config files.</p>

<p class="mt-4 text-sm opacity-60">Try it, break it, file issues. PRs welcome — it's all Python & React. The whole roadmap is open.</p>

<div class="mt-8 flex justify-center gap-12">

<div class="text-center">
<img src="/images/qr-github.png" class="w-36 mx-auto rounded-lg shadow-xl" />
<p class="text-sm mt-2 opacity-70">github.com/voglster/lumbergh</p>
</div>

</div>

<style>
h1 {
  font-size: 3em !important;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  padding-bottom: 0.2em;
}
</style>

<!--
One command. Install from PyPI with uv or pip, run lumbergh, open localhost:8420. No Docker, no database migrations, no config files to create. Just needs tmux and git on your system. If you're already running Claude Code in tmux, it picks up your existing sessions automatically.

Star the repo, file issues, PRs welcome. Thanks!
-->
