---
title: File Browser
---

# File Browser

The file browser lives in the **Files** tab of the session detail right pane. It lets you browse and preview files in the project's working directory without leaving Lumbergh.

## Browsing

Navigate the project file tree by clicking directories to expand them and files to view their contents. The browser respects `.gitignore` rules, so generated files and `node_modules` stay out of your way.

## Code Preview

Files open inline with syntax highlighting. Lumbergh detects the language from the file extension and renders the code with proper formatting.

## Markdown Preview

Markdown files (`.md`) open in a rendered preview by default, so you can read documentation and notes comfortably. Toggle back to the raw source view if you need to see the markup.

## Sending Context to the Terminal

Select a block of code in the preview, then send it to the terminal as context. This is useful when you want to point the AI at a specific function or section of a file without copy-pasting manually.
