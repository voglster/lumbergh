"""Engine v17: Adaptive strategy based on diff size.

Small diffs (<5k): full analysis with v6 prompt
Medium diffs (5k-15k): truncate to 12k, hint it's likely a feature
Large diffs (>15k): aggressive truncate to 8k, file list summary prepended,
    strong hint toward feat/refactor

This avoids wasting time on huge diffs while giving small diffs full attention.
"""

import re

from .. import ollama_client
from ..preprocessing import apply_pipeline, extract_diff_metadata

VERSION = "v17"
DESCRIPTION = "Adaptive: small=full analysis, large=truncated+type hints"
PARENT = "v15"

MODEL = "llama3.2"
PREPROCESSING: list[str] = ["filter_lockfiles", "filter_generated", "prioritize_source"]

SYSTEM_PROMPT = "You generate conventional commit messages from git diffs. Analyze briefly, then output YAML."

SMALL_PROMPT = """\
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

Diff:
```
{diff}
```"""

LARGE_PROMPT = """\
This is a LARGE diff across many files. It is most likely a feature addition or major refactor.

CHANGE SUMMARY:
{metadata}

Analyze the key changes, then generate a commit message as YAML.

Types: feat (most likely for large changes), refactor, fix, chore

```yaml
type: <type>
scope: <short area like ui, api, auth — omit if unclear>
description: <imperative mood, under 50 chars, no period>
```

Diff (truncated):
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
    raw_size = len(diff)
    metadata = extract_diff_metadata(diff)

    if raw_size > 15000:
        # Large: aggressive truncate, prepend file summary, hint feat/refactor
        processed = apply_pipeline(diff, PREPROCESSING, 8000)
        prompt = LARGE_PROMPT.replace("{metadata}", metadata).replace("{diff}", processed)
    elif raw_size > 5000:
        # Medium: moderate truncate with large hint
        processed = apply_pipeline(diff, PREPROCESSING, 12000)
        prompt = LARGE_PROMPT.replace("{metadata}", metadata).replace("{diff}", processed)
    else:
        # Small: full analysis
        processed = apply_pipeline(diff, PREPROCESSING, 64000)
        prompt = SMALL_PROMPT.replace("{diff}", processed)

    response = ollama_client.generate(
        MODEL,
        prompt,
        system=SYSTEM_PROMPT,
        think=False,
        temperature=0.0,
        timeout=120,
        base_url=base_url,
    )
    return _parse_yaml_response(response)
