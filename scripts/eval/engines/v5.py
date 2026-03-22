"""Engine v5: System/user role separation + YAML structured output with smart parsing."""

import re

from .. import ollama_client
from ..preprocessing import apply_pipeline

VERSION = "v5"
DESCRIPTION = "System/user role split, YAML output with smart fence parsing"
PARENT = "v2"

MODEL = "llama3.2"
MAX_DIFF_CHARS = 64000
PREPROCESSING: list[str] = ["filter_lockfiles", "filter_generated", "prioritize_source"]

SYSTEM_PROMPT = """\
You are a commit message generator. You output ONLY a YAML block with the commit message fields. No other text.

Commit types (pick the one that matches what the diff DOES):
- feat: adds new functionality users can use
- fix: corrects broken behavior
- refactor: restructures code without changing behavior
- docs: only documentation/comments changed
- test: only test files changed
- chore: deps, config, build tooling
- style: formatting only, no logic change
- perf: measurable performance improvement

Output format (YAML only, inside a code fence):
```yaml
type: <type>
scope: <short area like ui, api, auth — omit if unclear>
description: <imperative mood, under 50 chars, no period>
body: <optional WHY explanation, omit if obvious>
```"""

USER_PROMPT = """\
Generate a conventional commit message for this diff:

```
{diff}
```"""


def _parse_yaml_response(text: str) -> str:
    """Parse YAML from response, looking for fenced blocks first."""
    # Try to find last ```yaml ... ``` block
    fences = re.findall(r"```ya?ml\s*\n(.*?)```", text, re.DOTALL)
    if fences:
        yaml_text = fences[-1].strip()
    else:
        # Try unfenced YAML-like content
        yaml_text = text.strip()
        # Strip any markdown fences
        yaml_text = re.sub(r"^```\w*\n?", "", yaml_text)
        yaml_text = re.sub(r"\n?```$", "", yaml_text)

    # Parse key: value pairs manually (avoid PyYAML dependency)
    fields: dict[str, str] = {}
    for line in yaml_text.splitlines():
        match = re.match(r"^(\w+):\s*(.+)$", line.strip())
        if match:
            fields[match.group(1)] = match.group(2).strip().strip("'\"")

    if not fields.get("type") or not fields.get("description"):
        # Fallback: return cleaned raw text
        return text.strip().splitlines()[0][:80]

    t = fields["type"]
    scope = fields.get("scope", "")
    desc = fields["description"].rstrip(".")
    body = fields.get("body", "")


    header = f"{t}({scope}): {desc}" if scope else f"{t}: {desc}"
    if body and body.lower() not in ("", "none", "n/a", "omit"):
        return f"{header}\n\n{body}"
    return header


def generate(diff: str, *, base_url: str = "http://localhost:11434") -> str:
    """Generate a commit message using system/user role split + YAML."""
    processed = apply_pipeline(diff, PREPROCESSING, MAX_DIFF_CHARS)

    response = ollama_client.generate(
        MODEL,
        USER_PROMPT.replace("{diff}", processed),
        system=SYSTEM_PROMPT,
        think=False,
        timeout=120,
        base_url=base_url,
    )
    return _parse_yaml_response(response)
