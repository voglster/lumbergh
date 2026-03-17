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
├── settings.json              # AI provider config, repo search path, git graph commits, password
├── global.json                # Global prompt templates and global AI prompts
└── shared/                    # Shared files accessible from all sessions
```

| File | Contents |
|------|----------|
| `sessions.json` | Session registry -- names, working directories, descriptions, agent provider, idle state, display names |
| `projects/<hash>.json` | Per-project todos, scratchpad notes, project-specific prompts, and AI prompt overrides. Keyed by repo path hash, so multiple sessions on the same repo share data. |
| `settings.json` | AI provider configuration, repo search path, git graph commit count, default agent, password |
| `global.json` | Global prompt templates and global AI prompt templates |
| `shared/` | Shared files (including images) accessible from every session |

## Format

All files are **human-readable JSON** stored via [TinyDB](https://tinydb.readthedocs.io/). You can safely inspect and hand-edit them with any text editor.

!!! warning
    Edit data files only while Lumbergh is stopped, or you risk write conflicts.

## Backup & Restore

Back up everything by copying the data directory:

```bash
cp -r ~/.config/lumbergh/ ~/lumbergh-backup/
```

To restore, copy the backup back to the same path (or point `LUMBERGH_DATA_DIR` at it).
