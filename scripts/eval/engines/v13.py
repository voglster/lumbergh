"""Engine v13: Type decision tree — explicit rules to fix the #1 quality problem.

v6's biggest weakness: wrong commit types (feat→fix, fix→refactor, etc).
Add an explicit decision tree that forces the model to reason about type
selection based on observable signals in the diff.
"""

import re

from .. import ollama_client
from ..preprocessing import apply_pipeline

VERSION = "v13"
DESCRIPTION = "v6 + explicit type decision tree to fix wrong-type problem"
PARENT = "v6"

MODEL = "llama3.2"
MAX_DIFF_CHARS = 64000
PREPROCESSING: list[str] = ["filter_lockfiles", "filter_generated", "prioritize_source"]

SYSTEM_PROMPT = """\
You are a commit message generator. Given a git diff, analyze it carefully and output a YAML block.

TYPE DECISION TREE (follow this strictly):
1. Are ONLY .md files or comments changed? → docs
2. Are ONLY test files changed? → test
3. Are ONLY config files changed (package.json, pyproject.toml, CI yamls)? → chore
4. Does the diff ADD new functions/components/endpoints/routes that didn't exist before? → feat
5. Does the diff FIX a bug, error, crash, or incorrect behavior? Look for:
   - Fixing conditional logic (wrong if/else)
   - Adding missing null checks or error handling
   - Correcting wrong values or parameters
   - Fixing imports or broken references
   → fix
6. Does the diff MOVE, RENAME, or RESTRUCTURE code without changing what it does? → refactor
7. Does the diff only change formatting/whitespace? → style
8. Does the diff optimize performance (caching, reducing rerenders, etc)? → perf
9. Default: chore"""

USER_PROMPT = """\
Analyze this diff step by step, then generate a commit message.

Step 1: List the files changed and what each change does (1 line each)
Step 2: Walk through the TYPE DECISION TREE above. Which rule matches FIRST?
Step 3: Output the commit message as YAML:

```yaml
type: <type from decision tree>
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
