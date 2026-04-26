# Troubleshooting

Common issues and how to fix them.

---

### Terminal not connecting?

Make sure tmux mouse mode is enabled:

```bash
tmux set -g mouse on
```

The bootstrap script does this automatically. If you skipped bootstrap, run it again.

---

### Port already in use?

The default port is **8420**. Pick a different one with:

```bash
lumbergh -p 9000
```

!!! note
    In dev mode, the backend runs on port **8420** and the Vite frontend on **5420**.

---

### Dependencies not installing?

Run `./bootstrap.sh` again -- it tells you what's missing.

For Node issues, make sure nvm is loaded first:

```bash
source ~/.nvm/nvm.sh
```

---

### Session shows as inactive?

The session's tmux session may have been killed externally. Click **Reset** on the session card to restart it.

---

### Git diff not updating?

- Make sure the session's working directory is a valid git repository.
- Check that `git` is installed and accessible from the shell.
- Diffs are cached in the background every 5 seconds. If you just made a change, wait a moment for the cache to refresh.

---

### Locked out after setting a password?

If you set a password and can't log in:

1. Stop Lumbergh
2. Edit `~/.config/lumbergh/settings.json` and clear the `"password"` field (set it to `""`)
3. Restart Lumbergh

Alternatively, unset the `LUMBERGH_PASSWORD` environment variable if that's how you configured it.

---

### AI status not working?

Configure an AI provider in **Settings > AI** tab.

For Ollama, make sure the server is running:

```bash
ollama serve
```

---

### Mobile can't connect?

Lumbergh binds to `0.0.0.0` by default, so it should be accessible from any device on your local network. If it's not:

- Check your firewall rules (e.g., `ufw`, `iptables`).
- For remote access outside your LAN, use [Tailscale](https://tailscale.com/).

---

### PWA not installable?

PWA installation requires HTTPS. Use Tailscale Serve for automatic TLS certificates:

```bash
tailscale serve --bg 8420
```

---

### Windows: `psmux` not found?

Lumbergh checks for `tmux` (Linux/macOS) or `psmux` (Windows) on startup and
exits with a hint if it's missing. Install psmux:

```powershell
uv tool install psmux
```

Then re-run `lumbergh`. If `psmux` is installed but still not found, make sure
the `uv` shims directory is on your `PATH` (run `uv tool dir --bin`).

---

### Windows: terminal session never appears?

If you see "Session not found" inside the dashboard but the session was just
created, this usually means `psmux`'s session listing returned an unexpected
format. Try:

1. Stop Lumbergh
2. Run `psmux kill-server` to clear any stale state
3. Restart Lumbergh and re-create the session

If it persists, check the backend log for a `psmux fallback` warning and
[file an issue](https://github.com/voglster/lumbergh/issues) with the
`psmux list-sessions` output.

---

### Terminal feels laggy?

Lumbergh runs a permanent watchdog that records any time the asyncio event
loop is blocked for more than 200ms. If the UI feels janky:

```bash
cat /tmp/lumbergh-lag.log
```

Each entry shows the offending thread stacks at the time of the stall.
Common causes: synchronous TinyDB writes, corrupt session JSON files in
`~/.config/lumbergh/session_data/`, or thread-pool exhaustion from too many
concurrent pane captures. Clear the log with `> /tmp/lumbergh-lag.log` to
validate a fix.
