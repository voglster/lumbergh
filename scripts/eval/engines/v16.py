"""Engine v16: Minimal prompt — strip v6 to bare essentials.

Every token in the prompt is a token the model can get confused by.
Lean prompt = faster + less noise.
"""

import re

from .. import ollama_client
from ..preprocessing import apply_pipeline

VERSION = "v16"
DESCRIPTION = "Minimal prompt — stripped to essentials + temp=0"
PARENT = "v15"

MODEL = "llama3.2"
MAX_DIFF_CHARS = 64000
PREPROCESSING: list[str] = ["filter_lockfiles", "filter_generated", "prioritize_source"]

SYSTEM_PROMPT = "You generate conventional commit messages from git diffs. Output YAML only."

USER_PROMPT = """\
What does this diff do? Then write a commit message as YAML.

Types: feat (new feature), fix (bug fix), refactor (restructure), docs, test, chore, style, perf

```yaml
type: <type>
scope: <area>
description: <imperative, under 50 chars>
```

```
{diff}
```"""


def _parse_yaml_response(text: str) -> str:
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
    processed = apply_pipeline(diff, PREPROCESSING, MAX_DIFF_CHARS)
    response = ollama_client.generate(
        MODEL,
        USER_PROMPT.replace("{diff}", processed),
        system=SYSTEM_PROMPT,
        think=False,
        temperature=0.0,
        timeout=120,
        base_url=base_url,
    )
    return _parse_yaml_response(response)
