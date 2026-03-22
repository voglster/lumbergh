"""Engine v19: v6 exact prompt + adaptive truncation for large diffs.

Don't fix what isn't broken. v6's prompt scored 7.4/10 quality on small diffs.
Just add v17's adaptive truncation to handle large diffs without timeouts.
"""

import re

from .. import ollama_client
from ..preprocessing import apply_pipeline, extract_diff_metadata

VERSION = "v19"
DESCRIPTION = "v6 exact prompt + adaptive truncation (10k cap for large diffs)"
PARENT = "v6"

MODEL = "llama3.2"
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

# Large diffs get file list prepended and the same prompt
LARGE_PREFIX = """\
NOTE: This is a large diff ({file_count} files). Here are all the files changed:
{file_list}

"""


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

    if raw_size > 10000:
        # Large diff: truncate to 10k but give full file list for context
        metadata = extract_diff_metadata(diff)
        file_line = metadata.splitlines()[0] if metadata else ""
        files = file_line.split(": ", 1)[1] if ": " in file_line else ""
        file_count = file_line.split("(")[1].split(")")[0] if "(" in file_line else "many"

        processed = apply_pipeline(diff, PREPROCESSING, 10000)
        prefix = LARGE_PREFIX.replace("{file_count}", file_count).replace(
            "{file_list}", files
        )
        prompt = prefix + USER_PROMPT.replace("{diff}", processed)
    else:
        # Small/medium: full v6 treatment
        processed = apply_pipeline(diff, PREPROCESSING, 64000)
        prompt = USER_PROMPT.replace("{diff}", processed)

    response = ollama_client.generate(
        MODEL,
        prompt,
        system=SYSTEM_PROMPT,
        think=False,
        timeout=120,
        base_url=base_url,
    )
    return _parse_yaml_response(response)
