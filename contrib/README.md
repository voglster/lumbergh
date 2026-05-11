# contrib

Community-maintained packaging and deployment helpers for lumbergh. Nothing in
here is required to run lumbergh — these are recipes for common deployment
shapes.

## `systemd/` — running lumbergh as a service

Two files:

| File | Purpose |
|------|---------|
| `lumbergh.service` | Template systemd unit. Installed as `/etc/systemd/system/lumbergh@.service` and instantiated per user (e.g. `lumbergh@mmegger.service`). |
| `lumbergh.env.example` | Annotated reference of every supported environment variable and CLI flag. Copy to `/etc/default/lumbergh`. |

### Prerequisites

- `tmux` and `git` on `PATH` for the target user.
- `lumbergh` installed for the target user (e.g. `uv tool install pylumbergh`,
  which symlinks the binary into `~/.local/bin`).
- Tailscale up — **only** if you plan to use `--tailscale-only`.

### Install

```bash
sudo cp contrib/systemd/lumbergh.service /etc/systemd/system/lumbergh@.service
sudo cp contrib/systemd/lumbergh.env.example /etc/default/lumbergh   # optional
sudo systemctl daemon-reload
sudo systemctl enable --now lumbergh@<your-username>.service
```

Replace `<your-username>` with the Linux user that owns `~/.config/lumbergh/`
and the tmux sessions you want to supervise. The unit is a template (note the
`@` in the filename), so the username becomes the instance — that's what
`%i` expands to inside the unit.

### Why a template unit?

Templates let one unit file serve any number of users on a host without
edits. If you only ever have one user, treat `lumbergh@mmegger` as the unit
name and move on — there is no functional downside.

### Configuring startup flags

Default install binds lumbergh to `0.0.0.0:8420`. To change that, edit
`/etc/default/lumbergh` and uncomment options in `LUMBERGH_ARGS`:

```bash
sudo $EDITOR /etc/default/lumbergh
sudo systemctl restart lumbergh@<your-username>.service
```

Common combinations are in the example file. The whole file is one big
discoverable reference — read through it to see what's available.

### Day-to-day operations

```bash
systemctl status lumbergh@<your-username>.service
systemctl restart lumbergh@<your-username>.service
systemctl stop lumbergh@<your-username>.service
journalctl -u lumbergh@<your-username>.service -f         # follow logs
systemctl show -p Environment lumbergh@<your-username>.service   # see loaded env
```

The startup log line tells you what's actually bound:

- `Uvicorn running on http://100.x.x.x:8420` → `--tailscale-only` is in effect.
- `Uvicorn running on http://0.0.0.0:8420` → not bound to tailscale.

### Gotchas

- **Auth.** Without `LUMBERGH_PASSWORD` (or a password set in Settings →
  Security), anyone who can reach the bind address can use the dashboard.
  Pair `--tailscale-only` with auth in any setup that matters.
- **`LUMBERGH_LAUNCH_DIR`** in the env file does nothing — lumbergh
  overwrites it from the process CWD at startup. Set
  `WorkingDirectory=` in the unit instead, or override the search dir in
  the Settings UI.
- **tmux socket sharing.** The unit deliberately omits `PrivateTmp=` so the
  service shares `/tmp/tmux-<uid>` with your interactive shells. Don't add
  it back unless you want lumbergh blind to sessions you start by hand.
- **`$HOME` is writable.** The unit deliberately omits `ProtectHome=`
  because lumbergh supervises agents that edit code throughout your home.
  If you sandbox `$HOME`, the whole tool stops working.
- **Tailscale ordering.** The unit has `After=tailscaled.service` /
  `Wants=tailscaled.service` but **not** `Requires=`, so the service is
  fine on hosts without Tailscale. If you set `--tailscale-only` on such
  a host, lumbergh exits at startup with a clear error.

### Uninstall

```bash
sudo systemctl disable --now lumbergh@<your-username>.service
sudo rm /etc/systemd/system/lumbergh@.service
sudo rm -f /etc/default/lumbergh
sudo systemctl daemon-reload
```

Data in `~/.config/lumbergh/` is left in place — remove it manually if you
want a clean slate.
