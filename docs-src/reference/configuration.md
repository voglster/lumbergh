# Configuration

## Settings UI

Click the **gear icon** in the dashboard top-right corner to open settings.

### General

| Setting | Description | Default |
|---------|-------------|---------|
| Repository search directory | Root path Lumbergh scans to find git repos when creating sessions | Directory where `lumbergh` was launched |
| Git graph commits | Number of commits shown in the graph visualization (10--1000) | `100` |
| Default agent | Which AI coding agent to launch for new sessions | `claude-code` |
| Tab visibility | Toggle which tabs (Git, Files, Todos, Prompts, Shared) appear by default. Can also be overridden per-session. | All enabled |

### AI

See the [AI Providers](../guides/ai-providers.md) guide for details on configuring AI backends.

### Cloud

Connect to [Lumbergh Cloud](#lumbergh-cloud) for backup, prompt sharing, and community prompts.

| Setting | Description |
|---------|-------------|
| Connect / Disconnect | Authenticate via device code flow |
| Auto-backup | Enable automatic backup every 5 minutes |
| Include API keys | Whether to include provider API keys in backups |
| Encryption | Encrypt backups with a passphrase (AES-256) |

### Security

| Setting | Description | Default |
|---------|-------------|---------|
| Password | Optional password for authentication (leave blank to disable). Can also be set via `LUMBERGH_PASSWORD` env var. | *(none)* |

## CLI Arguments

```bash
lumbergh [OPTIONS]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--host`, `-H` | Bind address | `0.0.0.0` |
| `--port`, `-p` | Port number | `8420` |
| `--reload` | Enable auto-reload (development only) | off |
| `--tailscale-only` | Bind only to the Tailscale interface | off |
| `--tls-cert` | Path to TLS certificate file (for HTTPS) | *(none)* |
| `--tls-key` | Path to TLS private key file (for HTTPS) | *(none)* |

**Examples:**

```bash
# Start on a custom port, bind to localhost only
lumbergh -H 127.0.0.1 -p 9000

# Bind exclusively to your Tailscale IP (rejects non-Tailscale traffic)
lumbergh --tailscale-only
```

## Tailscale Integration

When Tailscale is installed and connected, Lumbergh automatically detects it on startup and prints the Tailscale URL:

```
Tailscale: http://machine.tail1234.ts.net:8420
```

Use `--tailscale-only` to bind exclusively to the Tailscale interface. This ensures Lumbergh is only accessible over your Tailscale network — useful for remote access without exposing the dashboard on all interfaces. If Tailscale isn't available, the flag exits with an error rather than silently falling back to `0.0.0.0`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LUMBERGH_DATA_DIR` | Override the data directory | `~/.config/lumbergh/` |
| `LUMBERGH_LAUNCH_DIR` | Override the default repo search directory (set automatically to CWD on startup) | CWD |
| `LUMBERGH_PASSWORD` | Set the authentication password (alternative to Settings UI) | *(none)* |

```bash
# Store data in a custom location
LUMBERGH_DATA_DIR=/data/lumbergh lumbergh
```

## Theme

Toggle between **dark** and **light** mode using the button in the top-right corner of the dashboard. Your preference is persisted to `localStorage` and restored on next visit.

## Lumbergh Cloud

Lumbergh Cloud is an optional companion service. The open-source app works fully offline without it. Cloud features include:

- **Backup & restore** -- auto-backup sessions, todos, prompts, and settings every 5 minutes. Supports AES-256 encryption with a passphrase. Restore from any machine.
- **Prompt sharing** -- share prompt templates via a short code. Recipients can install and receive auto-updates.
- **Community prompts** -- browse and install prompts shared by other users.
- **Free AI provider** -- use Lumbergh Cloud as an AI provider for status detection and commit summaries at no cost.

Connect via the **Cloud tab** in Settings using a device code flow (no API keys needed).
