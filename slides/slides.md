---
theme: default
title: Lumbergh
info: Flight control for AI coding agents
highlighter: shiki
drawings:
  persist: false
transition: slide-left
mdc: true
fonts:
  sans: Inter
  mono: Fira Code
---

<div class="absolute inset-0">
  <img src="/images/title-bg.png" class="w-full h-full object-cover opacity-40" />
  <div class="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent"></div>
</div>

<div class="relative z-10 flex flex-col justify-end h-full pb-16 pl-12">
  <h1 class="text-6xl font-bold !mb-2">Lumbergh</h1>
  <div class="text-2xl text-gray-300 mt-2">
    Flight control for AI coding agents.
  </div>
  <div class="text-lg text-green-400 mt-1 italic">
    Don't give them autonomy. Give them rails.
  </div>
  <div class="text-sm text-gray-400 mt-8">
    lumbergh.dev
  </div>
</div>

<!--
Hi, I'm Jim. I've been running multiple Claude Code agents in parallel every day for months. When you do that, something unexpected breaks first — and it's not the agents. I built Lumbergh to fix it. It's flight control for AI coding agents.
-->

---

<div class="absolute inset-0">
  <img src="/images/bottleneck.png" class="w-full h-full object-cover opacity-35" />
  <div class="absolute inset-0 bg-gradient-to-r from-black/85 to-black/40"></div>
</div>

<div class="relative z-10 flex items-center justify-center h-full">
  <div class="text-4xl font-bold text-center leading-tight max-w-4xl">
    "When you run 3–5 agents in parallel,<br/>
    <span class="text-yellow-400">the hard part isn't the agents.</span>"
  </div>
</div>

<!--
When you run 3-5 agents in parallel, the hard part isn't the agents. It's you. Every session has different state, different progress, different problems. Every time you shift attention, you reload a mental model. It's cognitively brutal — same reason interruptions kill developer productivity, except you're voluntarily interrupting yourself across 5 parallel streams.
-->

---

# Context Switching Is Brutal

<div class="grid grid-cols-2 gap-10 mt-8 items-center">
  <div>
    <div class="text-xl leading-relaxed text-gray-300">
      Each session has different state.
      Different progress.
      Different problems.
    </div>
    <div class="mt-6 text-xl text-gray-300">
      Every time you shift attention, you
      <span class="text-yellow-400 font-bold">reload a mental model</span>.
    </div>
    <div class="mt-8 text-sm text-gray-400 italic border-l-2 border-yellow-400/40 pl-4">
      Kick off session 1 in the morning.
      Dive into session 3.
      End of day: "oh shit — session 1 has been idle for 6 hours."
    </div>
  </div>
  <div>
    <img src="/images/cat-laptop.jpg" class="rounded-xl shadow-2xl" />
  </div>
</div>

<!--
Each session has different state. Different progress. Different problems. Every time you shift attention, you reload a mental model. True story — I had 5 Claude Code sessions in tmux. Kicked one off in the morning, got deep into another, and at end of day saw session 1 had been idle for 6 hours. Wanted that work done today. Gone. And that's the NICE failure mode. The worse one: you check on a session and it's gone overboard, refactored half your codebase, time to git reset.
-->

---

# Two Approaches to the Problem

<div class="grid grid-cols-2 gap-8 mt-10">
  <div class="p-6 bg-gray-800/50 rounded-lg">
    <div class="text-xl font-bold text-yellow-400 mb-4">Gastown (Yegge)</div>
    <div class="space-y-2 text-sm text-gray-300">
      <div>You're the "Mayor"</div>
      <div>Delegate and trust the system</div>
      <div class="text-red-400 mt-4 font-bold">The problem today</div>
      <div class="text-gray-400">Too much abstraction between you and the work. You're responsible for output you didn't see happen.</div>
    </div>
  </div>
  <div class="p-6 bg-gray-800/50 rounded-lg border border-green-500/40">
    <div class="text-xl font-bold text-green-400 mb-4">Lumbergh</div>
    <div class="space-y-2 text-sm text-gray-300">
      <div>Visibility over abstraction</div>
      <div>Flight control, not delegation</div>
      <div class="text-green-400 mt-4 font-bold">What it gives you</div>
      <div class="text-gray-400">Live terminal streaming, real-time git diffs, session state at a glance. The mental model, externalized.</div>
    </div>
  </div>
</div>

<div class="mt-8 text-base text-gray-400 text-center italic max-w-3xl mx-auto">
  As models get smarter, the abstraction layer gets thinner. Maybe in a year the trust catches up. Today, you need to see what they're doing.
</div>

<!--
Steve Yegge proposed "Gastown" — you're the Mayor, delegating to agent workers. The problem today: too much abstraction between you and the work. You're responsible for output you didn't see happen. Tesla autopilot problem at scale.

I took the opposite approach. Visibility over abstraction. Flight control, not delegation. That's Lumbergh.

Honest hedge — models get smarter, the abstraction layer gets thinner. Maybe in a year Gastown's approach wins. But today? You need visibility. Build for today. Stay flexible.
-->

---

# Optimize the Human

<div class="mt-12 flex flex-col items-center">
  <div class="inline-block text-left">
    <div class="flex items-center gap-5 text-3xl mb-6">
      <span class="text-green-400 font-mono font-bold">1.</span>
      <span><strong>Spec</strong> <span class="text-gray-400 text-xl">— tell it what to do</span></span>
    </div>
    <div class="flex items-center gap-5 text-3xl mb-6">
      <span class="text-blue-400 font-mono font-bold">2.</span>
      <span><strong>Review</strong> <span class="text-gray-400 text-xl">— check what it did</span></span>
    </div>
  </div>
</div>

<div class="mt-10 text-xl text-gray-400 text-center max-w-3xl mx-auto">
  Everything between those two points is the
  <span class="text-yellow-400 font-bold">agent's problem, not yours.</span>
</div>

<div class="mt-4 text-lg text-gray-500 text-center">
  Build the tools that make these two things fast.
</div>

<!--
That's the whole job now. Spec — tell it what to do. Review — check what it did. Everything between is the agent's problem. So if the bottleneck is context switching between agents, optimize THAT. Make switching between "which agent needs a spec" and "which agent needs a review" nearly instant. That's what Lumbergh does.
-->

---
layout: fact
---

# The Dashboard

<img src="/images/screenshot-dashboard.png" class="rounded-lg shadow-2xl mt-6 mx-auto" style="max-height: 440px" />

<div class="mt-4 text-lg text-gray-400 italic">The mental model, externalized.</div>

<!--
One dashboard, all your sessions. Each card shows the session, what it's working on, its current status. Green dot means working. Yellow means waiting for input. Red means error. You glance at this and instantly know which agents need attention — no context switching required.
-->

---

# Inside a Session

<div class="grid grid-cols-4 gap-4 mt-6 px-4">
  <div class="text-center">
    <img src="/images/crop-terminal.png" class="rounded-xl shadow-xl mx-auto" style="max-height: 360px" />
    <p class="text-sm mt-3 font-medium">Terminal</p>
    <p class="text-xs text-gray-400 mt-1">Full xterm.js over WebSocket</p>
  </div>
  <div class="text-center">
    <img src="/images/crop-git.png" class="rounded-xl shadow-xl mx-auto" style="max-height: 360px" />
    <p class="text-sm mt-3 font-medium">Git + Diffs</p>
    <p class="text-xs text-gray-400 mt-1">Review as the agent works</p>
  </div>
  <div class="text-center">
    <img src="/images/crop-todo.png" class="rounded-xl shadow-xl mx-auto" style="max-height: 360px" />
    <p class="text-sm mt-3 font-medium">Todos & Scratchpad</p>
    <p class="text-xs text-gray-400 mt-1">Specs for the next loop</p>
  </div>
  <div class="text-center">
    <img src="/images/crop-files.png" class="rounded-xl shadow-xl mx-auto" style="max-height: 360px" />
    <p class="text-sm mt-3 font-medium">Files</p>
    <p class="text-xs text-gray-400 mt-1">Browse without switching</p>
  </div>
</div>

<div class="mt-8 text-center text-lg text-gray-400">
  Spec → Review loop in one view.
</div>

<!--
Click into a session and you get four tabs. Terminal — full xterm.js over WebSocket, type and scroll like native. Git — live diffs and a metro-style commit graph updating as the agent works. Todos and scratchpad — your specs for the next loop. Files — browse the repo without opening another tab. The spec-review cycle all in one view.
-->

---

# Review From Anywhere

<div class="grid grid-cols-2 gap-10 mt-4 items-center">
  <div class="flex gap-4 justify-center">
    <img src="/images/screenshot-mobile-dashboard.png" class="rounded-lg shadow-xl" style="max-height: 400px" />
    <img src="/images/screenshot-mobile-git.png" class="rounded-lg shadow-xl" style="max-height: 400px" />
  </div>
  <div>
    <div class="text-xl text-gray-300 leading-relaxed">
      PWA + Tailscale = agents you can steer from your phone.
    </div>
    <div class="mt-6 p-5 bg-green-900/20 rounded-lg border border-green-500/30">
      <p class="text-base italic text-gray-200">"Being able to code anywhere is a real game changer. Before, I had to lug around my laptop — now I just pull out my phone."</p>
      <p class="mt-3 text-xs text-gray-400">— @jcamierpy24</p>
    </div>
    <div class="mt-4 text-sm text-gray-500">
      Rest periods between sets at the gym become the perfect time to fire off the next prompt.
    </div>
  </div>
</div>

<!--
This is what it looks like on a phone. Dashboard on the left — see every agent at a glance. Git tab on the right — full diff view, commit graph, you can even commit from your phone. Real user: "Being able to code anywhere is a real game changer. Before, I had to lug my laptop. Now I just pull out my phone." I'll admit — rest periods between lifting sets are my favorite window to keep 5 agents moving.
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
<div class="text-sm opacity-70 mt-1">Cross-session files to coordinate agents</div>
</div>

</div>

<!--
Quick feature tour. Worktrees — one click spins up an isolated git branch per agent so they don't step on each other. Prompt templates with variables — write once, fire at any session. Pluggable AI provider for the Manager chat. Git graph shows commit history as a metro map. PWA so you can install on your phone — combined with Tailscale, access from anywhere, zero port forwarding. Shared context files that all agents can read, so you can coordinate them.
-->

---

<div class="absolute inset-0">
  <img src="/images/build-your-own.png" class="w-full h-full object-cover opacity-30" />
  <div class="absolute inset-0 bg-gradient-to-r from-black/80 to-black/40"></div>
</div>

<div class="relative z-10 flex flex-col items-center justify-center h-full">
  <div class="text-4xl font-bold text-center leading-tight text-white max-w-4xl">
    "Lumbergh isn't the point.<br/>
    <span class="text-green-400">Lumbergh is proof of the point.</span>"
  </div>
  <div class="mt-10 text-lg text-gray-300">
    Purpose-built tools for YOUR workflow — fast enough to build, cheap enough to keep.
  </div>
  <div class="mt-6 text-sm text-gray-400">
    8 daily active users. Zero marketing. They watched me use it and asked for access.
  </div>
</div>

<!--
Lumbergh isn't the point. Lumbergh is proof of the point. The point is: it's now fast enough to build purpose-driven tools that solve YOUR specific workflow problems. Not generic SaaS. Tools shaped exactly to how you work, built in days instead of months. 8 daily active users, zero marketing — they saw me use it and asked for access. That's the signal.
-->

---
layout: center
---

# Try It Tonight

<div class="mt-4">

```bash
uv tool install pylumbergh && lumbergh
```

</div>

<p class="mt-4 opacity-70">One command. Installs from PyPI, starts on localhost:8420.<br>No Docker. No database. No config files.</p>

<p class="mt-2 text-sm opacity-60">MIT licensed · tmux + git required · PRs welcome</p>

<div class="mt-10 flex justify-center gap-12 items-center">

<div class="text-center">
<img src="/images/qr-github.png" class="w-36 mx-auto rounded-lg shadow-xl" />
<p class="text-sm mt-2 opacity-70">github.com/voglster/lumbergh</p>
</div>

<div class="text-left max-w-sm">
<div class="text-xl text-green-400 font-bold mb-3">Build the rails that fit your track.</div>
<div class="text-sm text-gray-400">Go use it. Break it. Tell me how to make it better.</div>
<div class="text-xs text-gray-500 mt-3">jim@gravitate.energy · lumbergh.dev</div>
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
One command. Install from PyPI, run lumbergh, open localhost:8420. No Docker, no database, no config files. Just needs tmux and git. If you're already running Claude Code in tmux, it picks up your existing sessions automatically.

Agents don't need autonomy. They need rails. And now you can build the rails fast enough and cheap enough that it's worth doing for problems only you have.

Star the repo, file issues, PRs welcome. Thanks!
-->
