"""
Commit message generation helpers.

Preprocessing, adaptive prompt construction, and YAML response parsing
based on eval engine v17 findings.
"""

import re

# --- Diff preprocessing ---

LOCKFILE_PATTERNS = [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "uv.lock",
    "Pipfile.lock",
    "poetry.lock",
    "Gemfile.lock",
    "composer.lock",
    "Cargo.lock",
    "go.sum",
]

GENERATED_PATTERNS = [
    re.compile(r"\.min\.js$"),
    re.compile(r"\.min\.css$"),
    re.compile(r"^dist/"),
    re.compile(r"^build/"),
    re.compile(r"^vendor/"),
    re.compile(r"\.bundle\.js$"),
]

BINARY_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".webp",
    ".bmp",
    ".tiff",
    ".svg",
    ".pdf",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".otf",
    ".mp3",
    ".mp4",
    ".wav",
    ".ogg",
    ".webm",
    ".mov",
    ".avi",
    ".zip",
    ".tar",
    ".gz",
    ".br",
    ".zst",
    ".wasm",
    ".pyc",
    ".so",
    ".dll",
    ".dylib",
}

SOURCE_EXTENSIONS = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".rs",
    ".go",
    ".java",
    ".rb",
    ".swift",
    ".kt",
    ".c",
    ".cpp",
    ".h",
}

_DIFF_FILE_HEADER = re.compile(r"^diff --git a/(.*?) b/(.*?)$", re.MULTILINE)


def _split_hunks(diff: str) -> list[tuple[str, str]]:
    """Split a unified diff into (filename, hunk_text) pairs."""
    parts = _DIFF_FILE_HEADER.split(diff)
    hunks = []
    i = 1
    while i < len(parts) - 2:
        a_path = parts[i]
        b_path = parts[i + 1]
        content = parts[i + 2]
        filename = b_path if b_path != "/dev/null" else a_path
        header = f"diff --git a/{a_path} b/{b_path}"
        hunks.append((filename, header + content))
        i += 3
    return hunks


def _rejoin(hunks: list[tuple[str, str]]) -> str:
    return "".join(text for _, text in hunks)


def preprocess_diff(diff: str, max_chars: int) -> str:
    """Filter lockfiles/generated files, prioritize source, truncate."""
    hunks = _split_hunks(diff)

    # Filter lockfiles
    hunks = [(f, t) for f, t in hunks if not any(f.endswith(lock) for lock in LOCKFILE_PATTERNS)]

    # Filter generated/minified files
    hunks = [(f, t) for f, t in hunks if not any(p.search(f) for p in GENERATED_PATTERNS)]

    # Replace binary/asset file diffs with a short note
    def _maybe_summarize(filename: str, text: str) -> tuple[str, str]:
        ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext in BINARY_EXTENSIONS:
            return (
                filename,
                f"diff --git a/{filename} b/{filename}\n[binary/asset file changed]\n",
            )
        return (filename, text)

    hunks = [_maybe_summarize(f, t) for f, t in hunks]

    # Prioritize source code first
    source = []
    other = []
    for filename, text in hunks:
        ext = "." + filename.rsplit(".", 1)[-1] if "." in filename else ""
        if ext in SOURCE_EXTENSIONS:
            source.append((filename, text))
        else:
            other.append((filename, text))

    result = _rejoin(source + other)

    # Truncate
    if len(result) > max_chars:
        result = result[:max_chars] + "\n\n... [truncated]"

    return result


def extract_file_list(diff: str) -> tuple[list[str], int, int]:
    """Extract file list and line counts from a diff.

    Returns (file_list, total_added, total_removed).
    """
    hunks = _split_hunks(diff)
    files = []
    total_added = 0
    total_removed = 0
    for filename, text in hunks:
        added = text.count("\n+") - text.count("\n+++")
        removed = text.count("\n-") - text.count("\n---")
        total_added += added
        total_removed += removed
        files.append(filename)
    return files, total_added, total_removed


# --- Adaptive prompt construction ---

# Threshold for "large" diffs (raw char count before preprocessing)
LARGE_DIFF_THRESHOLD = 10000

SYSTEM_INSTRUCTION = (
    "You are a commit message generator. Analyze the diff briefly, then output a YAML block."
)

SMALL_DIFF_PROMPT = """\
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

{{#if user_messages}}
User instructions that led to these changes:
{{user_messages}}
{{/if}}

Diff:
```
{{git_diff}}
```"""

LARGE_DIFF_PROMPT = """\
This is a LARGE diff ({{file_count}} files). It is most likely a feature addition or major refactor.

CHANGED FILES:
{{file_list}}

Analyze the key changes, then generate a commit message as YAML.

Types: feat (most likely for large changes), refactor, fix, chore

```yaml
type: <type>
scope: <short area like ui, api, auth — omit if unclear>
description: <imperative mood, under 50 chars, no period>
```

{{#if user_messages}}
User instructions that led to these changes:
{{user_messages}}
{{/if}}

Diff (truncated):
```
{{git_diff}}
```"""


def build_commit_prompt(
    diff: str,
    *,
    file_summary: str = "",  # noqa: ARG001 — kept for API compatibility
    user_messages: str = "",
) -> str:
    """Build the commit message prompt with adaptive sizing.

    Uses the raw diff size to choose between small/large strategies,
    then preprocesses and truncates accordingly.
    """
    from lumbergh.ai.prompts import render_prompt

    raw_size = len(diff)

    if raw_size > LARGE_DIFF_THRESHOLD:
        files, _added, _removed = extract_file_list(diff)
        processed = preprocess_diff(diff, max_chars=10000)
        template = SYSTEM_INSTRUCTION + "\n\n" + LARGE_DIFF_PROMPT
        variables = {
            "git_diff": processed,
            "file_count": str(len(files)),
            "file_list": ", ".join(files),
            "user_messages": user_messages,
        }
    else:
        processed = preprocess_diff(diff, max_chars=64000)
        template = SYSTEM_INSTRUCTION + "\n\n" + SMALL_DIFF_PROMPT
        variables = {
            "git_diff": processed,
            "user_messages": user_messages,
        }

    return render_prompt(template, variables)


# --- Response parsing ---


def _extract_yaml_text(text: str) -> str:
    """Extract YAML content from a response — fenced block or trailing key:value lines."""
    fences = re.findall(r"```ya?ml\s*\n(.*?)```", text, re.DOTALL)
    if fences:
        return fences[-1].strip()

    # Try to find YAML-like key: value lines at the end
    lines = text.splitlines()
    yaml_lines: list[str] = []
    for line in reversed(lines):
        stripped = line.strip()
        if re.match(r"^\w+:\s+.+$", stripped):
            yaml_lines.insert(0, stripped)
        elif yaml_lines:
            break
    return "\n".join(yaml_lines)


def _assemble_from_fields(fields: dict[str, str]) -> str:
    """Assemble a conventional commit message from parsed YAML fields."""
    t = fields["type"]
    scope = fields.get("scope", "")
    desc = fields["description"].rstrip(".")
    body = fields.get("body", "")
    header = f"{t}({scope}): {desc}" if scope else f"{t}: {desc}"
    if body and body.lower() not in ("", "none", "n/a", "omit"):
        return f"{header}\n\n{body}"
    return header


def parse_commit_response(text: str) -> str:
    """Parse a commit message from an AI response.

    Looks for YAML blocks first, falls back to cleaning raw text.
    """
    text = text.strip()
    yaml_text = _extract_yaml_text(text)

    if yaml_text:
        fields: dict[str, str] = {}
        for line in yaml_text.splitlines():
            match = re.match(r"^(\w+):\s*(.+)$", line.strip())
            if match:
                fields[match.group(1)] = match.group(2).strip().strip("'\"")

        if fields.get("type") and fields.get("description"):
            return _assemble_from_fields(fields)

    # Fallback: clean up raw text (strip markdown fences)
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    return text
