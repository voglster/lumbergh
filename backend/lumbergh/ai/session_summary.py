"""
Session summary generation — "What happened?" AI-powered summaries.

Auto-generates a concise summary of session activity based on tmux
scrollback buffer content, with recency bias (recent lines matter more).
Uses cooldown + git fingerprint to avoid spamming the AI provider.
"""

import asyncio
import logging
import time
from datetime import UTC, datetime
from pathlib import Path

from lumbergh.ai.prompts import get_ai_prompt, render_prompt
from lumbergh.ai.providers import get_provider
from lumbergh.db_utils import get_session_data_db, session_data_lock
from lumbergh.diff_cache import _git_fingerprint
from lumbergh.tmux_pty import capture_scrollback

logger = logging.getLogger(__name__)

COOLDOWN_SECONDS = 180  # 3 minutes
SUMMARY_TABLE = "session_summary"
SCROLLBACK_LINES = 500  # Total lines to capture
RECENT_LINES = 80  # Last N lines get full inclusion

# Per-session locks to prevent duplicate concurrent generations
_locks: dict[str, asyncio.Lock] = {}


def _get_lock(session_name: str) -> asyncio.Lock:
    if session_name not in _locks:
        _locks[session_name] = asyncio.Lock()
    return _locks[session_name]


def _get_cached(session_name: str) -> dict | None:
    db = get_session_data_db(session_name)
    table = db.table(SUMMARY_TABLE)
    docs = table.all()
    if docs:
        return docs[0]
    return None


def _save_cached(session_name: str, data: dict) -> None:
    # Hold the file-level lock so this write cannot interleave with
    # idle_monitor's writes and corrupt the shared JSON file.
    with session_data_lock(session_name):
        db = get_session_data_db(session_name)
        table = db.table(SUMMARY_TABLE)
        table.truncate()
        table.insert(data)


async def get_or_generate_summary(
    session_name: str,
    workdir: Path,
    ai_settings: dict,
    settings: dict,
    idle_state: str = "unknown",
    force: bool = False,
) -> dict:
    """Get cached summary or generate a new one.

    Returns dict with: summary, generated_at, stale, available
    Pass force=True to bypass cooldown and regenerate.
    """
    lock = _get_lock(session_name)
    async with lock:
        return await _get_or_generate_locked(
            session_name, workdir, ai_settings, settings, idle_state, force
        )


async def _get_or_generate_locked(
    session_name: str,
    workdir: Path,
    ai_settings: dict,
    settings: dict,
    idle_state: str,
    force: bool = False,
) -> dict:
    # Check fingerprint
    fingerprint = await asyncio.to_thread(_git_fingerprint, workdir)
    fingerprint_str = str(fingerprint)

    cached = _get_cached(session_name)

    if cached and not force:
        age = time.time() - cached.get("generated_ts", 0)
        fp_match = cached.get("fingerprint") == fingerprint_str

        if fp_match:
            return {
                "summary": cached.get("summary", ""),
                "generated_at": cached.get("generated_at", ""),
                "stale": False,
                "available": True,
            }

        if age < COOLDOWN_SECONDS:
            return {
                "summary": cached.get("summary", ""),
                "generated_at": cached.get("generated_at", ""),
                "stale": True,
                "available": True,
            }

    # Generate new summary
    try:
        provider = get_provider(ai_settings, settings)
    except Exception:
        logger.debug("No AI provider configured for session summary")
        return {"summary": "", "generated_at": "", "stale": False, "available": False}

    try:
        # Capture scrollback from tmux
        scrollback = await asyncio.to_thread(capture_scrollback, session_name, SCROLLBACK_LINES)

        if not scrollback or not scrollback.strip():
            return {"summary": "", "generated_at": "", "stale": False, "available": True}

        prompt = _build_prompt(scrollback, idle_state, workdir)
        if not prompt:
            return {"summary": "", "generated_at": "", "stale": False, "available": True}

        summary_text = await provider.complete(prompt)
        now = datetime.now(UTC)

        cache_data = {
            "summary": summary_text.strip(),
            "generated_at": now.isoformat(),
            "generated_ts": time.time(),
            "fingerprint": fingerprint_str,
        }
        _save_cached(session_name, cache_data)

        return {
            "summary": summary_text.strip(),
            "generated_at": now.isoformat(),
            "stale": False,
            "available": True,
        }
    except Exception as e:
        logger.warning(f"Session summary generation failed: {e}")
        if cached:
            return {
                "summary": cached.get("summary", ""),
                "generated_at": cached.get("generated_at", ""),
                "stale": True,
                "available": True,
            }
        return {"summary": "", "generated_at": "", "stale": False, "available": False}


def _build_scrollback_with_recency(scrollback: str) -> str:
    """Apply recency bias: include all recent lines, summarize older ones.

    Keeps the last RECENT_LINES lines in full, and samples every 5th line
    from the older portion to give context without blowing up token count.
    """
    lines = scrollback.split("\n")
    # Strip trailing empty lines
    while lines and not lines[-1].strip():
        lines.pop()

    if len(lines) <= RECENT_LINES:
        return "\n".join(lines)

    older = lines[:-RECENT_LINES]
    recent = lines[-RECENT_LINES:]

    # Sample older lines (every 5th line, skip blank lines)
    sampled = [line for i, line in enumerate(older) if i % 5 == 0 and line.strip()]

    parts = []
    if sampled:
        parts.append("[Earlier activity — sampled]")
        parts.extend(sampled)
        parts.append("")
        parts.append("[Recent activity — full detail]")
    parts.extend(recent)
    return "\n".join(parts)


def _build_prompt(
    scrollback: str,
    idle_state: str,
    workdir: Path,
) -> str | None:
    """Build the summary prompt from scrollback content."""
    terminal_content = _build_scrollback_with_recency(scrollback)

    if not terminal_content.strip():
        return None

    template = get_ai_prompt("session_summary", workdir)
    if not template:
        return None

    return render_prompt(
        template,
        {
            "session_state": idle_state,
            "terminal_output": terminal_content,
        },
    )
