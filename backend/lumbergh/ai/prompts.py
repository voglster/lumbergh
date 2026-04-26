"""
AI prompt template management.

Stores and retrieves AI system prompts with support for:
- Global default prompts
- Per-project overrides
"""

from pathlib import Path

from lumbergh.db_utils import (
    get_global_db,
    get_project_db,
    get_single_document_items,
    save_single_document_items,
)

# Default prompt for commit message generation
# NOTE: This is only used when user hasn't customized the prompt.
# The actual generation logic uses build_commit_prompt() from commit_message.py
# which handles adaptive sizing and preprocessing.
DEFAULT_COMMIT_MESSAGE_PROMPT = """You are a commit message generator. Analyze the diff briefly, then output a YAML block.

Analyze this diff step by step, then generate a commit message.

Step 1: List the files changed and what each change does (1 line each)
Step 2: Identify the overall purpose — is this adding something new (feat), fixing something broken (fix), or reorganizing (refactor)?
Step 3: Output the commit message as YAML:

Types: feat, fix, refactor, docs, test, chore, style, perf

```yaml
type: <type>
scope: <short area like ui, api, auth — omit if unclear>
description: <imperative mood, under 50 chars, no period>
```

{{#if user_messages}}
User instructions that led to these changes:
{{user_messages}}
{{/if}}

Diff:
```
{{git_diff}}
```"""

# Prompt for summarizing a todo into a short status
STATUS_SUMMARY_PROMPT = """Summarize this task in 2-3 words maximum.
Examples: "fixing auth", "adding tests", "refactoring API"
Task: {text}"""

# Default prompt for session summary ("What happened?")
# Based on tmux scrollback with recency bias — recent lines are full,
# older lines are sampled every 5th line.
DEFAULT_SESSION_SUMMARY_PROMPT = """You are summarizing a coding agent's terminal session. The output below is from its tmux scrollback buffer. Recent lines (at the bottom) are more important than older lines.

Current agent state: {{session_state}}

Terminal output:
```
{{terminal_output}}
```

Respond with a short markdown summary (no headings, just bullets):
- First bullet: what the agent is doing RIGHT NOW (based on the last few lines)
- Then 2-4 bullets covering what it did before that (key actions, files changed, tests run, errors hit)
- Keep it under 80 words total
- Be specific (name files, functions, errors) — not vague
- Skip noise (blank lines, progress bars, ANSI artifacts)"""

# Table name for AI prompts
AI_PROMPTS_TABLE = "ai_prompts"


def get_default_ai_prompts() -> list[dict]:
    """Return the built-in default AI prompts."""
    return [
        {
            "id": "commit_message",
            "task": "commit_message",
            "name": "Default Commit Message",
            "template": DEFAULT_COMMIT_MESSAGE_PROMPT,
            "isDefault": True,
        },
        {
            "id": "session_summary",
            "task": "session_summary",
            "name": "Session Summary",
            "template": DEFAULT_SESSION_SUMMARY_PROMPT,
            "isDefault": True,
        },
    ]


def get_global_ai_prompts() -> list[dict]:
    """Get AI prompts from global config, with defaults merged in."""
    db = get_global_db()
    table = db.table(AI_PROMPTS_TABLE)
    stored = get_single_document_items(table)

    # Merge with defaults - stored prompts override defaults by task
    defaults = get_default_ai_prompts()
    stored_tasks = {p["task"] for p in stored}

    # Add defaults for any tasks not in stored
    result = list(stored)
    result.extend(default for default in defaults if default["task"] not in stored_tasks)

    return result


def save_global_ai_prompts(prompts: list[dict]) -> list[dict]:
    """Save AI prompts to global config."""
    db = get_global_db()
    table = db.table(AI_PROMPTS_TABLE)
    return save_single_document_items(table, prompts)


def get_project_ai_prompts(project_path: Path) -> list[dict]:
    """Get AI prompts for a specific project (overrides only)."""
    db = get_project_db(project_path)
    table = db.table(AI_PROMPTS_TABLE)
    return get_single_document_items(table)


def save_project_ai_prompts(project_path: Path, prompts: list[dict]) -> list[dict]:
    """Save AI prompts for a specific project."""
    db = get_project_db(project_path)
    table = db.table(AI_PROMPTS_TABLE)
    return save_single_document_items(table, prompts)


def get_ai_prompt(task: str, project_path: Path | None = None) -> str | None:
    """
    Get the AI prompt template for a specific task.

    Resolution order:
    1. Project-specific override (if project_path provided)
    2. Global custom prompt
    3. Built-in default

    Args:
        task: The task identifier (e.g., "commit_message")
        project_path: Optional project path for project-specific overrides

    Returns:
        The prompt template string, or None if not found
    """
    # Check project-specific first
    if project_path:
        project_prompts = get_project_ai_prompts(project_path)
        for prompt in project_prompts:
            if prompt.get("task") == task:
                return prompt.get("template")

    # Check global prompts (includes defaults)
    global_prompts = get_global_ai_prompts()
    for prompt in global_prompts:
        if prompt.get("task") == task:
            return prompt.get("template")

    return None


def render_prompt(template: str, variables: dict) -> str:
    """
    Simple template rendering with {{variable}} syntax.

    Also supports {{#if variable}}...{{/if}} blocks.

    Args:
        template: The template string with {{variable}} placeholders
        variables: Dict of variable names to values

    Returns:
        The rendered prompt string
    """
    result = template

    # Handle {{#if var}}...{{/if}} blocks
    import re

    if_pattern = re.compile(r"\{\{#if\s+(\w+)\}\}(.*?)\{\{/if\}\}", re.DOTALL)

    def replace_if(match):
        var_name = match.group(1)
        content = match.group(2)
        if variables.get(var_name):
            return content
        return ""

    result = if_pattern.sub(replace_if, result)

    # Handle simple {{variable}} substitutions
    for key, value in variables.items():
        result = result.replace(f"{{{{{key}}}}}", str(value))

    return result
