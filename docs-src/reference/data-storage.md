# Data Storage

All Lumbergh data lives in a single directory. No database server required.

## Data Directory

Default location: `~/.config/lumbergh/`

Override with the `LUMBERGH_DATA_DIR` environment variable.

## File Layout

```
~/.config/lumbergh/
├── sessions.json              # Session registry (names, workdirs, descriptions, agent, idle state)
├── projects/
│   └── <repo-hash>.json       # Per-project data (todos, scratchpad, prompts, AI prompts)
├── session_data/
│   └── <session-name>.json    # Per-session runtime data (idle state, status)
├── settings.json              # AI provider config, repo search path, git graph commits, password
├── global.json                # Global prompt templates and global AI prompts
└── shared/                    # Shared files accessible from all sessions
```

| File | Contents |
|------|----------|
| `sessions.json` | Session registry -- names, working directories, descriptions, agent provider, idle state, display names |
| `projects/<hash>.json` | Per-project todos, scratchpad notes, project-specific prompts, and AI prompt overrides. Keyed by repo path hash, so multiple sessions on the same repo share data. |
| `session_data/<name>.json` | Per-session runtime data (idle state, status tracking). One file per session. |
| `settings.json` | AI provider configuration, repo search path, git graph commit count, default agent, tab visibility, cloud connection, password |
| `global.json` | Global prompt templates and global AI prompt templates |
| `shared/` | Shared files (including images) accessible from every session |

## Format

All files are **human-readable JSON** stored via [TinyDB](https://tinydb.readthedocs.io/). You can safely inspect and hand-edit them with any text editor.

!!! warning
    Edit data files only while Lumbergh is stopped, or you risk write conflicts.

## Backup & Restore

### Manual Backup

Back up everything by copying the data directory:

```bash
cp -r ~/.config/lumbergh/ ~/lumbergh-backup/
```

To restore, copy the backup back to the same path (or point `LUMBERGH_DATA_DIR` at it).

### Cloud Backup

With a [Lumbergh Cloud](configuration.md#lumbergh-cloud) connection, you can enable automatic cloud backup in **Settings --> Cloud**. Backups run every 5 minutes when changes are detected and include sessions, todos, prompts, scratchpads, shared markdown files, and settings (with secrets stripped by default). Backups support optional AES-256 encryption with a passphrase. Restore from the Cloud tab to pull your data to any machine.
