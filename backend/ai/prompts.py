"""
AI prompt template management.

Stores and retrieves AI system prompts with support for:
- Global default prompts
- Per-project overrides
"""

from pathlib import Path

from db_utils import (
    get_global_db,
    get_project_db,
    get_single_document_items,
    save_single_document_items,
)

# Default prompt for commit message generation
DEFAULT_COMMIT_MESSAGE_PROMPT = """Generate a git commit message following the Conventional Commits specification.

FORMAT:
<type>(<scope>): <description>

[optional body]

TYPES (pick one):
- feat: new feature or capability
- fix: bug fix
- refactor: code change that neither fixes a bug nor adds a feature
- docs: documentation only
- test: adding or updating tests
- chore: maintenance tasks (deps, config, build)
- style: formatting, whitespace (no logic change)
- perf: performance improvement

RULES:
- Subject line MUST be under 50 characters (hard limit)
- Use imperative mood: "add" not "added" or "adds"
- Scope is optional but helpful (e.g., api, ui, auth)
- No period at end of subject line
- Body is optional; use for complex changes to explain WHY

EXAMPLES:
- feat(ai): add commit message generation
- fix: prevent crash on empty diff
- refactor(providers): extract base class for AI providers
- chore: update dependencies

{{#if file_summary}}
Files changed:
{{file_summary}}
{{/if}}

Diff:
```
{{git_diff}}
```

Respond with ONLY the commit message. No markdown, no explanation."""

# Prompt for summarizing a todo into a short status
STATUS_SUMMARY_PROMPT = """Summarize this task in 2-3 words maximum.
Examples: "fixing auth", "adding tests", "refactoring API"
Task: {text}"""

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
        }
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
    for default in defaults:
        if default["task"] not in stored_tasks:
            result.append(default)

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
