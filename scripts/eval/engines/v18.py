"""Engine v18: Best combo — v6 CoT + v17 adaptive sizing + YAML comments for reasoning.

Combines:
- v6's step-by-step CoT (the quality winner at 7.4/10)
- v17's adaptive diff truncation (zero timeouts)
- YAML comments as inline reasoning (cheap CoT in the output itself)
- Default temperature (some randomness helps, v15 showed temp=0 hurts)
"""

import re

from .. import ollama_client
from ..preprocessing import apply_pipeline, extract_diff_metadata

VERSION = "v18"
DESCRIPTION = "v6 CoT + v17 adaptive sizing + YAML comments as reasoning"
PARENT = "v17"

MODEL = "llama3.2"
PREPROCESSING: list[str] = ["filter_lockfiles", "filter_generated", "prioritize_source"]

SYSTEM_PROMPT = """\
You are a commit message generator. Given a git diff, analyze it then output a YAML block.

Commit types:
- feat: adds new functionality users can use
- fix: corrects broken behavior
- refactor: restructures code without changing behavior
- docs: only documentation/comments changed
- test: only test files changed
- chore: deps, config, build tooling
- style: formatting only, no logic change
- perf: measurable performance improvement"""

SMALL_PROMPT = """\
Analyze this diff, then generate a commit message as YAML with comments explaining your reasoning.

```yaml
# Files changed: <list files>
# Purpose: <what this change does>
# Why this type: <reasoning>
type: <type>
scope: <short area like ui, api, auth — omit line if unclear>
description: <imperative mood, under 50 chars, no period>
```

Diff:
```
{diff}
```"""

LARGE_PROMPT = """\
This is a large diff ({file_count} files, +{added}/-{removed} lines). Large diffs are usually features or refactors.

CHANGED FILES:
{file_list}

Analyze the key changes, then generate a commit message as YAML with comments.

```yaml
# Purpose: <what this change does>
# Why this type: <reasoning>
type: <type>
scope: <short area — omit line if unclear>
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
            if re.match(r"^(#|\w+:)\s", stripped):
                yaml_lines.insert(0, stripped)
            elif yaml_lines and not stripped:
                continue  # skip blank lines within YAML
            elif yaml_lines:
                break
        yaml_text = "\n".join(yaml_lines) if yaml_lines else text.strip()

    # Strip YAML comments before parsing fields
    fields: dict[str, str] = {}
    for line in yaml_text.splitlines():
        line = line.strip()
        if line.startswith("#"):
            continue
        match = re.match(r"^(\w+):\s*(.+)$", line)
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

    # Parse metadata for large prompt
    meta_lines = metadata.splitlines()
    file_list = meta_lines[0] if meta_lines else ""
    stats = meta_lines[1] if len(meta_lines) > 1 else ""
    file_count = file_list.split("(")[1].split(")")[0] if "(" in file_list else "?"
    added = removed = "?"
    if "+" in stats and "-" in stats:
        parts = stats.replace("Lines: ", "").split()
        for p in parts:
            if p.startswith("+"):
                added = p[1:]
            elif p.startswith("-"):
                removed = p[1:]

    if raw_size > 10000:
        # Large: truncate aggressively, prepend file list
        processed = apply_pipeline(diff, PREPROCESSING, 10000)
        prompt = (
            LARGE_PROMPT.replace("{file_count}", file_count)
            .replace("{added}", added)
            .replace("{removed}", removed)
            .replace("{file_list}", file_list)
            .replace("{diff}", processed)
        )
    else:
        # Small/medium: full analysis
        processed = apply_pipeline(diff, PREPROCESSING, 64000)
        prompt = SMALL_PROMPT.replace("{diff}", processed)

    response = ollama_client.generate(
        MODEL,
        prompt,
        system=SYSTEM_PROMPT,
        think=False,
        timeout=120,
        base_url=base_url,
    )
    return _parse_yaml_response(response)
