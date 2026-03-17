---
title: Shared Files
---

# Shared Files

The **Shared** tab in the session detail right pane gives every session access to a common set of files. Use it to share context, instructions, or reference material across projects.

## Storage

Shared files live in:

```
~/.config/lumbergh/shared/
```

## Adding Files

There are two ways to add shared files:

- **Upload** -- use the upload button in the Shared tab
- **Manual** -- drop files directly into the `~/.config/lumbergh/shared/` directory

## Image Support

Uploaded images (screenshots, diagrams, etc.) are displayed inline in the Shared tab. This is useful for sharing visual context like mockups or error screenshots across sessions.

## Save as Prompt

Any shared file can be converted into a **prompt template** with one click. This is handy for turning a shared instruction document into a reusable prompt you can fire at any session.

## Use Cases

!!! example "Common shared files"
    - **CLAUDE.md instructions** -- keep a master set of coding conventions available to every session
    - **Screenshots** -- share error screenshots or design mockups across sessions
    - **Reference docs** -- API specs, style guides, architecture notes
    - **Cross-project context** -- share decisions or findings from one project with others

Shared files are available to all sessions immediately -- no restart required.
