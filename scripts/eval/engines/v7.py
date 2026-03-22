"""Engine v7: Few-shot examples + YAML output.

Research shows few-shot is ~80% more effective than zero-shot. Uses generic
examples that won't leak into outputs (different domain/scope than test data).
"""

import re

from .. import ollama_client
from ..preprocessing import apply_pipeline

VERSION = "v7"
DESCRIPTION = "Few-shot examples (generic, non-leaky) + YAML output"
PARENT = "v6"

MODEL = "llama3.2"
MAX_DIFF_CHARS = 64000
PREPROCESSING: list[str] = ["filter_lockfiles", "filter_generated", "prioritize_source"]

SYSTEM_PROMPT = """\
You are a commit message generator. Analyze the diff, then output YAML.

Commit types:
- feat: adds new functionality
- fix: corrects broken behavior
- refactor: restructures without behavior change
- docs: documentation only
- test: test files only
- chore: deps, config, build
- style: formatting only
- perf: performance improvement"""

USER_PROMPT = """\
Here are examples of good commit messages for diffs:

Example 1 — Adding a new database migration:
```yaml
type: feat
scope: db
description: add user preferences table migration
```

Example 2 — Fixing a null pointer crash:
```yaml
type: fix
scope: api
description: handle null user in auth middleware
body: Request crashes when session token references deleted user
```

Example 3 — Renaming variables for clarity:
```yaml
type: refactor
description: rename handler params for clarity
```

Example 4 — Updating CI config:
```yaml
type: chore
scope: ci
description: pin node version to 20 in workflow
```

Now analyze this diff and generate a commit message as YAML:

```
{diff}
```

Output ONLY the YAML block:
```yaml
type: ...
scope: ...
description: ...
```"""


def _parse_yaml_response(text: str) -> str:
    """Parse YAML from response, looking for the last fenced block."""
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
    """Few-shot + YAML output."""
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
