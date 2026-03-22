"""Engine v14: Recent git log — include 5 real commits as style context.

Research shows commit history context improves quality. Instead of generic
few-shot examples (which v7 showed can leak), use REAL recent commits from
the same repo as style guidance.
"""

import re
import subprocess

from .. import ollama_client
from ..preprocessing import apply_pipeline

VERSION = "v14"
DESCRIPTION = "v6 + 5 recent real commits from repo as style context"
PARENT = "v6"

MODEL = "llama3.2"
MAX_DIFF_CHARS = 64000
PREPROCESSING: list[str] = ["filter_lockfiles", "filter_generated", "prioritize_source"]

# Cache the git log so we don't call it 18 times
_RECENT_COMMITS_CACHE: str | None = None


def _get_recent_commits() -> str:
    global _RECENT_COMMITS_CACHE
    if _RECENT_COMMITS_CACHE is not None:
        return _RECENT_COMMITS_CACHE
    try:
        result = subprocess.run(
            ["git", "log", "--oneline", "-10", "--format=%s"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        lines = result.stdout.strip().splitlines()[:5]
        _RECENT_COMMITS_CACHE = "\n".join(f"- {line}" for line in lines)
    except Exception:
        _RECENT_COMMITS_CACHE = ""
    return _RECENT_COMMITS_CACHE


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
Here are recent commits from this project (for style reference only):
{recent_commits}

Analyze this diff step by step, then generate a commit message IN THE SAME STYLE as the commits above.

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
    recent = _get_recent_commits()
    processed = apply_pipeline(diff, PREPROCESSING, MAX_DIFF_CHARS)
    prompt = USER_PROMPT.replace("{recent_commits}", recent).replace("{diff}", processed)
    response = ollama_client.generate(
        MODEL,
        prompt,
        system=SYSTEM_PROMPT,
        think=False,
        timeout=120,
        base_url=base_url,
    )
    return _parse_yaml_response(response)
