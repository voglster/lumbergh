"""Engine v10: qwen3.5:4b with proper thinking suppression.

v9 failed because qwen3.5 was still thinking despite think=False.
Fix: strip <think> tags from output + /no_think prefix in prompt.
Uses v6 prompt (single-pass CoT + YAML) which scored 69.3 with llama3.2.
"""

import re

from .. import ollama_client
from ..preprocessing import apply_pipeline

VERSION = "v10"
DESCRIPTION = "qwen3.5:4b with think tags stripped + /no_think prefix"
PARENT = "v9"

MODEL = "qwen3.5:4b"
MAX_DIFF_CHARS = 64000
PREPROCESSING: list[str] = ["filter_lockfiles", "filter_generated", "prioritize_source"]

SYSTEM_PROMPT = """\
You are a commit message generator. Given a git diff, you FIRST analyze it briefly, THEN output a YAML block.

Commit types:
- feat: adds new functionality users can use
- fix: corrects broken behavior
- refactor: restructures code without changing behavior
- docs: only documentation/comments changed
- test: only test files changed
- chore: deps, config, build tooling
- style: formatting only, no logic change
- perf: measurable performance improvement"""

USER_PROMPT = """\
/no_think
Analyze this diff step by step, then generate a commit message.

Step 1: List the files changed and what each change does (1 line each)
Step 2: Identify the overall purpose — is this adding something new (feat), fixing something broken (fix), or reorganizing (refactor)?
Step 3: Output the commit message as YAML:

```yaml
type: <type>
scope: <short area like ui, api, auth — omit if unclear>
description: <imperative mood, under 50 chars, no period>
```

Diff:
```
{diff}
```"""


def _strip_think_tags(text: str) -> str:
    """Remove <think>...</think> blocks from model output."""
    # Remove complete think blocks
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    # Remove incomplete/dangling think tags
    text = re.sub(r"</?think>", "", text)
    return text.strip()


def _parse_yaml_response(text: str) -> str:
    """Parse YAML from response, looking for the last fenced block."""
    text = _strip_think_tags(text)

    fences = re.findall(r"```ya?ml\s*\n(.*?)```", text, re.DOTALL)
    if fences:
        yaml_text = fences[-1].strip()
    else:
        lines = text.strip().splitlines()
        yaml_lines = []
        for line in reversed(lines):
            stripped = line.strip()
            if re.match(r"^\w+:\s+.+$", stripped):
                yaml_lines.insert(0, stripped)
            elif yaml_lines:
                break
        yaml_text = "\n".join(yaml_lines) if yaml_lines else text.strip()

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
    """Single-pass CoT + YAML with qwen3.5:4b (thinking suppressed)."""
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
