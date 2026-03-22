"""Engine v8: Two-pass CoT + YAML (v4 approach but with YAML and 7s budget).

Now that TIME_BUDGET is 7s, two-pass is viable again. Combines best ideas:
- Pass 1: Free-form summary (cheap, fast)
- Pass 2: YAML output from summary (structured, parseable)
"""

import re

from .. import ollama_client
from ..preprocessing import apply_pipeline

VERSION = "v8"
DESCRIPTION = "Two-pass CoT + YAML output (7s budget makes 2-pass viable)"
PARENT = "v6"

MODEL = "llama3.2"
MAX_DIFF_CHARS = 64000
PREPROCESSING: list[str] = ["filter_lockfiles", "filter_generated", "prioritize_source"]

SUMMARIZE_PROMPT = """\
Briefly analyze this git diff:

1. List files changed and what each does (1 line per file)
2. One sentence: what is the overall purpose?
3. Is this: adding new functionality (feat), fixing broken behavior (fix), \
reorganizing code (refactor), updating docs (docs), changing tests (test), \
or maintenance (chore)?

Diff:
```
{diff}
```

Be concise."""

GENERATE_PROMPT = """\
Based on this analysis of a git diff, output a conventional commit message as YAML.

Analysis:
{summary}

Rules:
- type must be one of: feat, fix, refactor, docs, test, chore, style, perf
- description: imperative mood ("add" not "added"), under 50 chars, no period
- scope: short area (ui, api, auth) or omit if unclear

```yaml
type: ...
scope: ...
description: ...
```

Output ONLY the YAML block above."""


def _parse_yaml_response(text: str) -> str:
    """Parse YAML from response."""
    fences = re.findall(r"```ya?ml\s*\n(.*?)```", text, re.DOTALL)
    if fences:
        yaml_text = fences[-1].strip()
    else:
        yaml_text = text.strip()
        yaml_text = re.sub(r"^```\w*\n?", "", yaml_text)
        yaml_text = re.sub(r"\n?```$", "", yaml_text)

    fields: dict[str, str] = {}
    for line in yaml_text.splitlines():
        match = re.match(r"^(\w+):\s*(.+)$", line.strip())
        if match:
            fields[match.group(1)] = match.group(2).strip().strip("'\"")

    if not fields.get("type") or not fields.get("description"):
        return text.strip().splitlines()[-1][:80] if text.strip() else "chore: unknown change"

    t = fields["type"]
    scope = fields.get("scope", "")
    desc = fields["description"].rstrip(".")
    body = fields.get("body", "")


    header = f"{t}({scope}): {desc}" if scope else f"{t}: {desc}"
    if body and body.lower() not in ("", "none", "n/a", "omit"):
        return f"{header}\n\n{body}"
    return header


def generate(diff: str, *, base_url: str = "http://localhost:11434") -> str:
    """Two-pass: summarize then YAML commit message."""
    processed = apply_pipeline(diff, PREPROCESSING, MAX_DIFF_CHARS)

    # Pass 1: Summarize
    summary = ollama_client.generate(
        MODEL,
        SUMMARIZE_PROMPT.replace("{diff}", processed),
        think=False,
        timeout=60,
        base_url=base_url,
    )

    # Pass 2: YAML commit message from summary
    response = ollama_client.generate(
        MODEL,
        GENERATE_PROMPT.replace("{summary}", summary),
        think=False,
        timeout=60,
        base_url=base_url,
    )
    return _parse_yaml_response(response)
