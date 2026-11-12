import json
import re
from datetime import datetime
from pathlib import Path

from lumbergh.activity.adapter import AgentAdapter
from lumbergh.activity.events import ConversationEvent
from lumbergh.session_identity import read as read_identity

# Harness-injected wrappers that get dropped from the feed entirely — they are
# background context, not something the user typed or the agent said.
_DROP_PREFIXES = (
    "<local-command-caveat>",
    "<local-command-stdout>",
    "<command-message>",
    "<command-args>",
    "<system-reminder>",
    "<task-notification>",
    "[SYSTEM NOTIFICATION",
)
# Injected blocks stripped out of otherwise-real user text (e.g. a reminder or a
# background-task event appended to something the user actually typed).
_INJECTED_BLOCK_RE = re.compile(r"<(system-reminder|task-notification)>.*?</\1>", re.DOTALL)
_COMMAND_NAME_RE = re.compile(r"<command-name>\s*(.*?)\s*</command-name>", re.DOTALL)
_SKILL_BODY_RE = re.compile(r"^Base directory for this skill:\s*(\S+)")


def _classify_user_text(text: str) -> tuple[str, str | None]:
    """Sort a user text block into ('user', cleaned) | ('status', chip) | ('drop', None).

    Claude Code injects harness content (skill bodies, slash-command wrappers,
    system reminders) into the user turn. Rendering that raw makes the feed look
    like the user pasted walls of XML, so recognized noise is dropped and useful
    signals (a /command ran, a skill loaded) collapse to a one-line status chip.
    """
    stripped = text.strip()
    if not stripped:
        return ("drop", None)

    command = _COMMAND_NAME_RE.search(stripped)
    if command:
        return ("status", f"↪ {command.group(1)}")

    skill = _SKILL_BODY_RE.search(stripped)
    if skill:
        return ("status", f"loaded skill: {skill.group(1).rstrip('/').split('/')[-1]}")

    if stripped.startswith(_DROP_PREFIXES):
        return ("drop", None)

    cleaned = _INJECTED_BLOCK_RE.sub("", stripped).strip()
    if not cleaned:
        return ("drop", None)
    return ("user", cleaned)


def _parse_ts(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except ValueError:
        return None


def _summarize_tool(name: str, tool_input: dict) -> str:
    tool_input = tool_input or {}
    if name in ("Read", "Edit", "Write", "NotebookEdit"):
        return str(tool_input.get("file_path", ""))
    if name == "Bash":
        return str(tool_input.get("command", ""))
    if name in ("Grep", "Glob"):
        return str(tool_input.get("pattern") or tool_input.get("query") or "")
    if name in ("Task", "Agent"):
        return str(tool_input.get("description", ""))
    return ""


def _stringify_content(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts)
    return ""


class ClaudeCodeAdapter(AgentAdapter):
    def __init__(self, transcript_path: Path, root: Path | None = None):
        self.path = Path(transcript_path)
        self.root = Path(root) if root else None
        self._offset = 0

    @classmethod
    def for_cwd(cls, cwd: Path) -> "ClaudeCodeAdapter | None":
        encoded_cwd = re.sub(r"[^a-zA-Z0-9]", "-", str(cwd))
        project_dir = Path.home() / ".claude" / "projects" / encoded_cwd
        if not project_dir.is_dir():
            return None
        candidates = sorted(
            project_dir.glob("*.jsonl"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            return None
        return cls(candidates[0], root=cwd)

    @classmethod
    def resolve(cls, session_name: str, cwd: Path | None) -> "ClaudeCodeAdapter | None":
        """Locate the transcript authoritatively (hook identity), else guess by cwd."""
        ident = read_identity(session_name)
        if ident and ident.transcript_path and Path(ident.transcript_path).exists():
            root = Path(ident.cwd) if ident.cwd else cwd
            return cls(Path(ident.transcript_path), root=root)
        if cwd is not None:
            return cls.for_cwd(cwd)
        return None

    def _rel(self, text: str) -> str:
        """Show project-relative paths for files under the session root, absolute otherwise.

        Only whole-string absolute paths are rewritten, so command lines and search
        patterns (which merely contain a path fragment) pass through untouched.
        """
        if not self.root or not text:
            return text
        candidate = Path(text)
        if not candidate.is_absolute():
            return text
        try:
            return str(candidate.relative_to(self.root))
        except ValueError:
            return text

    def _clean_command(self, command: str) -> str:
        """Tidy a leading `cd` in a Bash command.

        `cd <project-root> &&|; rest` drops to just `rest` (pure navigation noise),
        and `cd <root>/subdir &&|; rest` relativizes to `cd subdir && rest`. A cd to
        somewhere outside the project keeps its full path.
        """
        if not self.root:
            return command
        match = re.match(r"^cd\s+('[^']*'|\"[^\"]*\"|\S+)\s*(&&|;)\s*(.*)$", command, re.DOTALL)
        if not match:
            return command
        target, sep, rest = match.group(1).strip("'\""), match.group(2), match.group(3)
        path = Path(target)
        if not path.is_absolute():
            return command
        if path == self.root:
            return rest
        try:
            rel = path.relative_to(self.root)
        except ValueError:
            return command
        joiner = " && " if sep == "&&" else "; "
        return f"cd {rel}{joiner}{rest}"

    def _source_signature(self) -> tuple[int, float]:
        try:
            st = self.path.stat()
            return (st.st_size, st.st_mtime)
        except OSError:
            return (-1, -1.0)

    def read_new(self) -> list[ConversationEvent]:
        try:
            with self.path.open("rb") as f:
                f.seek(self._offset)
                data = f.read()
        except OSError:
            return []

        events: list[ConversationEvent] = []
        consumed = 0
        for raw in data.splitlines(keepends=True):
            if not raw.endswith(b"\n"):
                break  # partial trailing line; wait for the rest
            consumed += len(raw)
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            events.extend(self._events_from_line(obj))
        self._offset += consumed
        return events

    def _events_from_line(self, obj: dict) -> list[ConversationEvent]:
        kind = obj.get("type")
        ts = _parse_ts(obj.get("timestamp"))
        message = obj.get("message") or {}
        if kind == "user" and obj.get("isCompactSummary"):
            return [
                ConversationEvent(type="status", id=self._eid(), timestamp=ts, text="compacted")
            ]
        if kind == "user":
            return self._user_events(message, ts)
        if kind == "assistant":
            return self._assistant_events(message, ts)
        return []

    def _user_text_event(self, text: str, ts) -> ConversationEvent | None:
        kind, value = _classify_user_text(text)
        if kind == "status":
            return ConversationEvent(type="status", id=self._eid(), timestamp=ts, text=value)
        if kind == "user":
            return ConversationEvent(type="user_message", id=self._eid(), timestamp=ts, text=value)
        return None

    def _user_events(self, message: dict, ts) -> list[ConversationEvent]:
        content = message.get("content")
        if isinstance(content, str):
            event = self._user_text_event(content, ts)
            return [event] if event else []

        events: list[ConversationEvent] = []
        for block in content or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                event = self._user_text_event(block.get("text", ""), ts)
                if event:
                    events.append(event)
            elif block.get("type") == "tool_result":
                events.append(
                    ConversationEvent(
                        type="tool_result",
                        id=self._eid(),
                        timestamp=ts,
                        tool_use_id=block.get("tool_use_id"),
                        status="error" if block.get("is_error") else "ok",
                        text=_stringify_content(block.get("content")),
                    )
                )
        return events

    def _assistant_events(self, message: dict, ts) -> list[ConversationEvent]:
        events: list[ConversationEvent] = []
        for block in message.get("content") or []:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "thinking":
                events.append(
                    ConversationEvent(
                        type="thinking",
                        id=self._eid(),
                        timestamp=ts,
                        text=block.get("thinking", ""),
                    )
                )
            elif btype == "text":
                events.append(
                    ConversationEvent(
                        type="agent_message",
                        id=self._eid(),
                        timestamp=ts,
                        text=block.get("text", ""),
                    )
                )
            elif btype == "tool_use":
                name = block.get("name", "")
                tool_input = block.get("input") or {}
                summary = _summarize_tool(name, tool_input)
                summary = self._clean_command(summary) if name == "Bash" else self._rel(summary)
                events.append(
                    ConversationEvent(
                        type="tool_call",
                        id=self._eid(),
                        timestamp=ts,
                        tool_name=name,
                        tool_summary=summary,
                        tool_detail=json.dumps(tool_input, indent=2),
                        tool_use_id=block.get("id"),
                    )
                )
        return events

    def _eid(self) -> str:
        self._counter = getattr(self, "_counter", 0) + 1
        return f"ev_{self._counter}"
