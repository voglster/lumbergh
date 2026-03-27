---
title: AI Providers
---

# AI Providers

Lumbergh uses AI for lightweight analysis tasks:

- **Commit message generation** -- AI-generated conventional commit messages from the current diff
- **Session status summaries** -- 2-3 word AI-generated labels describing what each session is doing
- **Prompt name generation** -- auto-generate snake_case names for prompt templates from their content

Configure your provider in **Settings --> AI**.

!!! tip "Use a fast, cheap model"
    These are short summary tasks, not complex reasoning. A small model like `gpt-4o-mini` or a local Ollama model works great and keeps costs near zero.

## Supported Providers

### Ollama (Local)

Run AI entirely on your machine with no API keys.

| Setting | Default |
|---------|---------|
| Base URL | `http://localhost:11434` |
| Model | `gemma3:latest` |

Models are auto-discovered from your Ollama installation -- any model you've pulled will appear in the dropdown.

### OpenAI

| Setting | Notes |
|---------|-------|
| API Key | Required |
| Models | `gpt-4o` (default), `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo` |

### Anthropic

| Setting | Notes |
|---------|-------|
| API Key | Required |
| Models | `claude-sonnet-4-20250514` (default), `claude-opus-4-20250514`, `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022` |

### Google AI

| Setting | Notes |
|---------|-------|
| API Key | Required |
| Models | `gemini-3-flash-preview` (default, 1M context), `gemini-2.5-flash`, `gemini-2.5-flash-lite` |

### OpenAI Compatible

Use any endpoint that implements the OpenAI API format.

| Setting | Notes |
|---------|-------|
| Base URL | Required |
| API Key | Optional (depends on the endpoint) |

This works with local servers like LM Studio, text-generation-webui, or any hosted OpenAI-compatible API.

### Lumbergh Cloud (Free)

No API key needed. Connect your Lumbergh Cloud account in **Settings --> Cloud** using the device code flow, then select "Lumbergh Cloud" as your AI provider. Models are loaded dynamically from the cloud service.

## AI Prompt Templates

Lumbergh uses customizable prompt templates for each AI task. You can edit these in **Settings > AI Prompts** at both the global and per-project level. This lets you tune the commit message style, status summary format, etc. to match your preferences.

!!! note "Idle detection is not AI"
    Session status detection (working, idle, error, stalled) uses **pattern matching** on terminal output, not AI. It runs every 2 seconds and works without any AI provider configured. The AI is only used for the optional status *summary* labels on dashboard cards.
