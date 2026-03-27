---
title: Prompt Templates
---

# Prompt Templates

Prompt templates are reusable prompts you can fire at any session with a single click. Find them in the **Prompts** tab of the session detail right pane.

## Scopes

Templates exist at two levels:

| Scope | Visibility | Storage |
|-------|-----------|---------|
| **Project** | Only the current session/project | `~/.config/lumbergh/projects/{hash}.json` |
| **Global** | All sessions | `~/.config/lumbergh/global.json` |

!!! tip "Promote to global"
    Any project template can be promoted to global with one click -- handy when you write a prompt you want everywhere.

## Using Templates

Click a template to send it directly to the active terminal session. The prompt is typed into the terminal exactly as written.

## Variables

Templates support `@mention` variables that reference other templates by name. When a template containing `@other_template` is sent to the terminal, the referenced template's content is expanded inline.

## Edit Mode

Toggle edit mode to manage your templates:

- **Reorder** -- drag and drop to change the order
- **Move** -- shift templates between project and global scope
- **Delete** -- remove templates you no longer need

## Sharing & Community Prompts

With a [Lumbergh Cloud](../reference/configuration.md#lumbergh-cloud) connection, you can share and discover prompts:

- **Share** -- publish a prompt template via a short share code. Recipients can install it with one click.
- **Auto-update** -- when you update a shared prompt, users who installed it are notified and can pull the latest version.
- **Community browse** -- discover and install prompts shared by other Lumbergh users.
- **Linting** -- prompts are validated for syntax and variable references before sharing.

## Persistence

Templates persist across restarts. Project templates are stored in the per-project JSON file, and global templates live in `global.json`. No data is lost when you stop and restart Lumbergh.
