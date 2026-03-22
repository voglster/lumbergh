"""Engine v3: Structured JSON output — force type/scope/description fields."""

import json
import re

from .. import ollama_client
from ..preprocessing import apply_pipeline

VERSION = "v3"
DESCRIPTION = "Structured JSON output via Ollama format param"
PARENT = "v2"

MODEL = "llama3.2"
MAX_DIFF_CHARS = 64000
PREPROCESSING: list[str] = ["filter_lockfiles", "filter_generated", "prioritize_source"]

# JSON schema enforced by Ollama's constrained decoding
OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {
            "type": "string",
            "enum": ["feat", "fix", "refactor", "docs", "test", "chore", "style", "perf"],
        },
        "scope": {
            "type": "string",
            "description": "Optional short scope like ui, api, auth. Empty string if none.",
        },
        "description": {
            "type": "string",
            "description": "Imperative mood, under 50 chars, no period at end.",
        },
        "body": {
            "type": "string",
            "description": "Optional body explaining WHY. Empty string if not needed.",
        },
    },
    "required": ["type", "scope", "description", "body"],
}

PROMPT = """\
Analyze this git diff and generate a commit message.

Pick the correct type based on what the diff ACTUALLY does:
- feat: adds new functionality users can use
- fix: corrects broken behavior
- refactor: restructures code without changing behavior
- docs: only documentation/comments changed
- test: only test files changed
- chore: deps, config, build tooling
- style: formatting only, no logic change
- perf: measurable performance improvement

Respond as JSON with these fields:
- "type": one of the types above
- "scope": short area like "ui", "api", "auth" (or "" if unclear)
- "description": imperative mood summary, under 50 chars, no period
- "body": explain WHY if complex (or "" if obvious)

Diff:
```
{diff}
```"""


def _assemble_message(data: dict) -> str:
    """Assemble conventional commit message from structured fields."""
    t = data.get("type", "chore")
    scope = data.get("scope", "")
    desc = data.get("description", "unknown change")
    body = data.get("body", "")

    # Clean up description
    desc = desc.strip().rstrip(".")

    header = f"{t}({scope}): {desc}" if scope else f"{t}: {desc}"

    if body and body.strip():
        return f"{header}\n\n{body.strip()}"
    return header


def generate(diff: str, *, base_url: str = "http://localhost:11434") -> str:
    """Generate a commit message from a diff using structured output."""
    processed = apply_pipeline(diff, PREPROCESSING, MAX_DIFF_CHARS)
    prompt = PROMPT.replace("{diff}", processed)

    response = ollama_client.generate(
        MODEL,
        prompt,
        think=False,
        format=OUTPUT_SCHEMA,
        timeout=120,
        base_url=base_url,
    )

    try:
        data = json.loads(response)
        return _assemble_message(data)
    except (json.JSONDecodeError, KeyError):
        # Fallback: return raw response cleaned up
        return response.strip()
