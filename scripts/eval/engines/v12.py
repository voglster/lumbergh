"""Engine v12: Diff metadata — prepend file list + stats before the diff.

Give the model a birds-eye view before it sees the raw diff. This helps
especially on large diffs where the model loses track of what changed.
"""

import re

from .. import ollama_client
from ..preprocessing import apply_pipeline, extract_diff_metadata

VERSION = "v12"
DESCRIPTION = "v6 + diff metadata (file list, line stats) prepended"
PARENT = "v6"

MODEL = "llama3.2"
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
Here is a summary of the changes, followed by the full diff.

CHANGE SUMMARY:
{metadata}

Analyze this diff step by step, then generate a commit message.

Step 1: Based on the file list and diff, what does each change do? (1 line each)
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


def _parse_yaml_response(text: str) -> str:
    fences = re.findall(r"```ya?ml\s*\n(.*?)```", text, re.DOTALL)
    yaml_text = fences[-1].strip() if fences else text.strip()
    if not fences:
        lines = text.strip().splitlines()
        yaml_lines = []
        for line in reversed(lines):
            stripped = line.strip()
            if re.match(r"^\w+:\s+.+$", stripped):
                yaml_lines.insert(0, stripped)
            elif yaml_lines:
                break
        if yaml_lines:
            yaml_text = "\n".join(yaml_lines)

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
    header = f"{t}({scope}): {desc}" if scope else f"{t}: {desc}"
    body = fields.get("body", "")
    if body and body.lower() not in ("", "none", "n/a", "omit"):
        return f"{header}\n\n{body}"
    return header


def generate(diff: str, *, base_url: str = "http://localhost:11434") -> str:
    metadata = extract_diff_metadata(diff)
    processed = apply_pipeline(diff, PREPROCESSING, MAX_DIFF_CHARS)
    prompt = USER_PROMPT.replace("{metadata}", metadata).replace("{diff}", processed)
    response = ollama_client.generate(
        MODEL,
        prompt,
        system=SYSTEM_PROMPT,
        think=False,
        timeout=120,
        base_url=base_url,
    )
    return _parse_yaml_response(response)
