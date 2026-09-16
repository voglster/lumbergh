"""
Git utilities for the Lumbergh backend using GitPython.
"""

import hashlib
import json
import logging
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Prevent git from prompting for credentials in the terminal.
# HTTP repos that require auth will fail fast instead of blocking the server.
os.environ.setdefault("GIT_TERMINAL_PROMPT", "0")

from git import InvalidGitRepositoryError, Repo
from git.exc import BadName, GitCommandError, NoSuchPathError

from lumbergh.git_identity import Identity, owns_ref

logger = logging.getLogger(__name__)

# Commit hashes in the graph payload are abbreviated. They are random hex, so
# gzip cannot compress them: every byte shipped is a byte on the wire, and the
# graph sends two or more per commit. 12 chars stays collision-free well past
# any repo this renders, and git resolves an abbreviated hash anywhere it is
# handed back to us.
GRAPH_HASH_LEN = 12


def _sanitize(text: str) -> str:
    """Replace surrogate characters that can't be encoded as UTF-8."""
    return text.encode("utf-8", errors="surrogateescape").decode("utf-8", errors="replace")


# Safety limits for diff generation — prevents blocking on huge untracked
# files (e.g. node_modules, binaries, model weights).
MAX_DIFF_FILE_BYTES = 1_000_000  # 1 MB
MAX_DIFF_TOTAL_FILES = 500


def _read_if_small(path: Path) -> str | None:
    """Read a file's text content, returning None if it's too large or unreadable."""
    try:
        size = path.stat().st_size
    except OSError:
        return None
    if size > MAX_DIFF_FILE_BYTES:
        return None
    try:
        return path.read_text(errors="replace")
    except Exception:
        return None


def gravatar_url(email: str, size: int = 40) -> str:
    """Generate a Gravatar URL for an email address. Uses d=blank so missing gravatars return a transparent PNG."""
    md5 = hashlib.md5(email.strip().lower().encode()).hexdigest()
    return f"https://www.gravatar.com/avatar/{md5}?s={size}&d=blank"


@dataclass
class DiffStats:
    """Statistics for a diff."""

    additions: int = 0
    deletions: int = 0


@dataclass
class FileDiff:
    """A single file's diff content."""

    path: str
    diff: str


def get_repo(cwd: Path) -> Repo:
    """Get a Repo object for the given path."""
    return Repo(cwd, search_parent_directories=True)


def get_current_branch(cwd: Path) -> str:
    """Get the current git branch name."""
    try:
        repo = get_repo(cwd)
        if repo.head.is_detached:
            return f"HEAD detached at {repo.head.commit.hexsha[:7]}"
        return repo.active_branch.name
    except (InvalidGitRepositoryError, TypeError):
        return "unknown"


def _get_diff_status(diff, *, staged: bool = True) -> str:
    """Determine the status string for a git diff object."""
    if staged:
        if diff.new_file:
            return "added"
        if diff.renamed:
            return "renamed"
    if diff.deleted_file:
        return "deleted"
    return "modified"


def get_porcelain_status(cwd: Path) -> list[dict]:
    """
    Get git status parsed into a list of file status dicts.

    Returns:
        List of dicts with 'path' and 'status' keys
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return []

    files = []
    seen_paths: set[str] = set()

    # Staged changes (index vs HEAD)
    if repo.head.is_valid():
        for diff in repo.index.diff(repo.head.commit):
            path = diff.b_path or diff.a_path or ""
            files.append({"path": path, "status": _get_diff_status(diff, staged=True)})
            seen_paths.add(path)

    # Unstaged changes (working tree vs index)
    for diff in repo.index.diff(None):
        path = diff.a_path or diff.b_path or ""
        if path not in seen_paths:
            files.append({"path": path, "status": _get_diff_status(diff, staged=False)})

    # Untracked files
    files.extend({"path": path, "status": "untracked"} for path in repo.untracked_files)

    return files


def _parseable_diff(repo: Repo, *revs: str) -> str:
    """Diff text this module can parse, whatever the user has configured.

    `diff.mnemonicPrefix` renames the header prefixes to c/ and w/, `diff.noprefix`
    removes them, and `diff.external` replaces the diff wholesale — each of which
    hides the path parse_diff_output reads out of `diff --git a/... b/...`.
    """
    git = repo.git(c=["diff.mnemonicPrefix=false", "diff.noprefix=false"])
    return git.diff(*revs, no_ext_diff=True)


def parse_diff_output(diff_text: str) -> tuple[list[FileDiff], DiffStats]:
    """
    Parse git diff output into per-file chunks with stats.

    Args:
        diff_text: Raw git diff output

    Returns:
        Tuple of (list of FileDiff objects, DiffStats)
    """
    files = []
    stats = DiffStats()
    current_file = None
    current_diff_lines: list[str] = []

    for line in diff_text.split("\n"):
        if line.startswith("diff --git"):
            if current_file:
                files.append(FileDiff(path=current_file, diff="\n".join(current_diff_lines)))
            parts = line.split(" b/")
            current_file = parts[-1] if len(parts) > 1 else "unknown"
            current_diff_lines = [line]
        elif current_file:
            current_diff_lines.append(line)
            if line.startswith("+") and not line.startswith("+++"):
                stats.additions += 1
            elif line.startswith("-") and not line.startswith("---"):
                stats.deletions += 1

    if current_file:
        files.append(FileDiff(path=current_file, diff="\n".join(current_diff_lines)))

    return files, stats


def generate_untracked_file_diff(workdir: Path, path: str) -> tuple[FileDiff | None, DiffStats]:
    """
    Generate a pseudo-diff for an untracked file.

    Args:
        workdir: Working directory containing the file
        path: Relative path to the untracked file

    Returns:
        Tuple of (FileDiff or None if unreadable, DiffStats)
    """
    full_path = workdir / path
    stats = DiffStats()

    if not full_path.is_file():
        return None, stats

    content = _read_if_small(full_path)
    if content is None:
        return None, stats

    lines = content.split("\n")
    diff_lines = [
        f"diff --git a/{path} b/{path}",
        "new file mode 100644",
        "--- /dev/null",
        f"+++ b/{path}",
        f"@@ -0,0 +1,{len(lines)} @@",
    ]
    for content_line in lines:
        diff_lines.append(f"+{content_line}")
        stats.additions += 1

    return FileDiff(path=path, diff="\n".join(diff_lines)), stats


def get_file_content_at_ref(repo: Repo, ref: str, path: str) -> str | None:
    """Get file content at a specific git ref (commit, HEAD, etc.)."""
    try:
        return _sanitize(repo.git.show(f"{ref}:{path}"))
    except GitCommandError:
        return None


def get_full_diff_with_untracked(cwd: Path) -> dict:
    """
    Get git diff for all changed files, including untracked files.

    Returns:
        Dict with 'files' (list of file diffs with old/new content) and 'stats'
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"files": [], "stats": {"additions": 0, "deletions": 0}}

    files: list[dict] = []
    total_stats = DiffStats()
    workdir = Path(repo.working_dir)

    # Get diff of working tree against HEAD
    if repo.head.is_valid():
        try:
            diff_text = _sanitize(_parseable_diff(repo, "HEAD"))
            if diff_text:
                parsed_files, stats = parse_diff_output(diff_text)
                for f in parsed_files:
                    if len(files) >= MAX_DIFF_TOTAL_FILES:
                        break
                    old_content = get_file_content_at_ref(repo, "HEAD", f.path)
                    new_content = _read_if_small(workdir / f.path)
                    files.append(
                        {
                            "path": f.path,
                            "diff": f.diff,
                            "oldContent": old_content,
                            "newContent": new_content,
                        }
                    )
                total_stats.additions += stats.additions
                total_stats.deletions += stats.deletions
        except GitCommandError:
            pass

    # Add untracked files (new files - no old content)
    for untracked_path in repo.untracked_files:
        if len(files) >= MAX_DIFF_TOTAL_FILES:
            break
        file_diff, stats = generate_untracked_file_diff(workdir, untracked_path)
        if file_diff:
            new_content = _read_if_small(workdir / untracked_path)
            files.append(
                {
                    "path": file_diff.path,
                    "diff": file_diff.diff,
                    "oldContent": None,
                    "newContent": new_content,
                }
            )
            total_stats.additions += stats.additions

    return {
        "files": files,
        "stats": {"additions": total_stats.additions, "deletions": total_stats.deletions},
    }


def _classify_ref(name: str) -> tuple[str, str]:
    """Classify a git ref, returning (cleaned_name, kind).

    Takes a ref's full path. Anything under ``refs/`` that is not a head, a
    remote or a tag — ``refs/original/`` from a filter-branch, ``refs/notes/``,
    ``refs/bisect/`` — is "other": GitPython shortens those to names that read
    like branches (``refs/original/refs/heads/x`` becomes ``refs/heads/x``) and
    resolve to nothing, so callers must not treat them as refs to walk.
    """
    if name.startswith("refs/heads/"):
        return name[11:], "local"
    if name.startswith("refs/remotes/"):
        return name[13:], "remote"
    if name.startswith("refs/tags/"):
        return name[10:], "tag"
    if name.startswith("refs/"):
        return name, "other"
    if name.startswith("origin/"):
        return name, "remote"
    return name, "local"


def _build_raw_refs(repo: Repo) -> dict[str, list[tuple[str, str]]]:
    """Build hash -> [(name, kind)] map from all repo refs."""
    from git import TagReference

    raw_refs: dict[str, list[tuple[str, str]]] = {}
    for ref in repo.refs:
        if isinstance(ref, TagReference):
            name, kind = ref.name, "tag"
        else:
            name, kind = _classify_ref(ref.path)
        if kind == "other" or name == "origin/HEAD":
            continue
        try:
            hexsha = ref.commit.hexsha
        except Exception:  # noqa: S112 - skip refs that can't resolve
            continue
        raw_refs.setdefault(hexsha, []).append((name, kind))
    return raw_refs


def _build_branch_lookups(
    raw_refs: dict[str, list[tuple[str, str]]],
) -> tuple[dict[str, str], dict[str, str]]:
    """Build local and remote branch-name -> hash lookups."""
    local: dict[str, str] = {}
    remote: dict[str, str] = {}
    for hexsha, entries in raw_refs.items():
        for name, kind in entries:
            if kind == "remote" and name.startswith("origin/"):
                remote[name[7:]] = hexsha
            elif kind == "local" and name != "HEAD":
                local[name] = hexsha
    return local, remote


def _enrich_ref_entry(
    name: str,
    kind: str,
    hexsha: str,
    commit_seen: set[str],
    local_branch_hash: dict[str, str],
    remote_branch_hash: dict[str, str],
) -> dict | None:
    """Convert a raw ref entry into an enriched ref dict, or None to skip."""
    if kind == "tag":
        return {"name": name, "local": False, "remote": False, "tag": True}
    if name == "HEAD" or name.startswith("HEAD -> "):
        return None
    if kind == "remote":
        if not name.startswith("origin/"):
            return None
        branch_name = name[7:]
        if branch_name == "HEAD" or branch_name in commit_seen:
            return None
        commit_seen.add(branch_name)
        # When a local branch of the same name sits on a *different* commit,
        # labelling both of them "dev" reads as the branch head failing to
        # update. Keep the remote's prefix so the two are told apart. A branch
        # that exists only on the remote keeps its bare name — there is nothing
        # for it to be confused with.
        local_hash = local_branch_hash.get(branch_name)
        diverged = local_hash is not None and local_hash != hexsha
        return {
            "name": f"origin/{branch_name}" if diverged else branch_name,
            "local": local_hash == hexsha,
            "remote": True,
        }

    # Local branch
    if name in commit_seen:
        return None
    commit_seen.add(name)
    return {"name": name, "local": True, "remote": remote_branch_hash.get(name) == hexsha}


def _build_ref_map(
    raw_refs: dict[str, list[tuple[str, str]]],
    local_branch_hash: dict[str, str],
    remote_branch_hash: dict[str, str],
) -> dict[str, list[dict]]:
    """Build hash -> [enriched ref dicts] map."""
    ref_map: dict[str, list[dict]] = {}
    seen_per_commit: dict[str, set[str]] = {}
    for hexsha, entries in raw_refs.items():
        commit_seen = seen_per_commit.setdefault(hexsha, set())
        enriched = [
            e
            for name, kind in entries
            if (
                e := _enrich_ref_entry(
                    name, kind, hexsha, commit_seen, local_branch_hash, remote_branch_hash
                )
            )
        ]
        if enriched:
            ref_map.setdefault(hexsha, []).extend(enriched)
    return ref_map


def _get_unpushed_commits(repo: Repo, head_branch: str | None) -> set[str]:
    """Determine which commits on the current branch haven't been pushed."""
    if not head_branch or repo.head.is_detached:
        return set()
    try:
        tracking = repo.active_branch.tracking_branch()
        tracking_ref = tracking.name if tracking else None

        if not tracking_ref:
            tracking_ref = f"origin/{head_branch}"
            try:
                repo.git.rev_parse("--verify", tracking_ref)
            except GitCommandError:
                tracking_ref = None

        if tracking_ref:
            output = repo.git.rev_list(f"{tracking_ref}..{head_branch}").strip()
        else:
            output = repo.git.rev_list(head_branch).strip()

        return set(output.splitlines()) if output else set()
    except GitCommandError:
        return set()


def _collect_stash_entries(repo: Repo) -> tuple[set[str], list[dict]]:
    """Collect stash entries and their internal commit hashes."""
    stash_hashes: set[str] = set()
    stash_entries: list[dict] = []
    try:
        stash_list_output = repo.git.stash("list", "--format=%H %gd %gs")
    except GitCommandError:
        return stash_hashes, stash_entries

    for line in stash_list_output.strip().splitlines():
        if not line:
            continue
        parts = line.split(" ", 2)
        stash_hash = parts[0]
        stash_hashes.add(stash_hash)
        try:
            stash_commit = repo.commit(stash_hash)
            for parent in stash_commit.parents[1:]:
                stash_hashes.add(parent.hexsha)
            stash_entries.append(
                {
                    "hash": stash_hash,
                    "ref": parts[1].rstrip(":") if len(parts) > 1 else "stash",
                    "message": parts[2] if len(parts) > 2 else "",
                    "parent": stash_commit.parents[0].hexsha if stash_commit.parents else None,
                    "date": stash_commit.committed_datetime.isoformat(),
                    "author": stash_commit.author.name,
                    "authorEmail": stash_commit.author.email or "",
                }
            )
        except Exception:  # noqa: S110 - skip malformed stash entries
            pass

    return stash_hashes, stash_entries


def _stash_entry_to_node(entry: dict) -> dict:
    """Convert a stash entry dict into a commit-like node for the graph."""
    email = entry["authorEmail"]
    return {
        "hash": entry["hash"][:GRAPH_HASH_LEN],
        "message": entry["message"],
        "author": entry["author"],
        "authorEmail": email,
        "authorGravatar": gravatar_url(email) if email else None,
        "relativeDate": entry["date"],
        "parents": [entry["parent"][:GRAPH_HASH_LEN]] if entry["parent"] else [],
        "refs": [{"name": entry["ref"], "local": True, "remote": False, "stash": True}],
        "pushed": True,
        "stash": True,
    }


def _build_graph_worktrees(cwd: Path, session_paths: dict[str, str] | None) -> list[dict]:
    """Structural worktree annotations for the graph — no live agent state.

    ``headHash`` is a 7-char short hash, so it matches the leading characters of
    a commit node's abbreviated ``hash``.
    """
    try:
        cwd_resolved = str(Path(cwd).resolve())
    except (OSError, ValueError):
        cwd_resolved = str(cwd)

    entries = []
    for wt in list_worktrees(cwd):
        try:
            wt_resolved = str(Path(wt.path).resolve())
        except (OSError, ValueError):
            wt_resolved = wt.path
        entries.append(
            {
                "branch": wt.branch,
                "headHash": wt.commit,
                "path": wt.path,
                "isMain": wt.is_main,
                "isCurrent": wt_resolved == cwd_resolved,
                "sessionName": (session_paths or {}).get(wt_resolved),
            }
        )
    return entries


def _trunk_ref_names(cwd: Path, repo: Repo) -> set[str]:
    """Refs that act as the repo's spine, so a filtered graph keeps its shape.

    Without the trunk, the surviving branches float with no common ancestor and
    every merge-base is invisible.
    """
    names: set[str] = set()
    base = default_base_ref(cwd)
    if base != "HEAD":
        names.add(base)
        if base.startswith("origin/"):
            names.add(base[7:])

    names |= {b.name for b in repo.branches} & {"main", "master", "dev"}
    return {name for name in names if _ref_exists(cwd, name)}


def _mine_ref_names(cwd: Path, repo: Repo, identity: Identity, head_branch: str | None) -> set[str]:
    """The refs a "just my work" graph is drawn from.

    Worktree branches are kept unconditionally — you are standing in them, so
    they are yours regardless of who wrote the commits.
    """
    trunk = _trunk_ref_names(cwd, repo)
    kept = set(trunk)
    kept.add(head_branch or "HEAD")
    kept.update(wt.branch for wt in list_worktrees(cwd) if wt.branch)

    for ref in repo.refs:
        name, kind = _classify_ref(ref.path)
        if kind in ("tag", "other") or name == "origin/HEAD":
            continue
        try:
            tip = ref.commit.hexsha
        except Exception:  # noqa: S112 - skip refs that can't resolve
            continue
        if owns_ref(cwd, name, tip, identity, frozenset(trunk)):
            kept.add(name)

    return kept


def get_graph_log(
    cwd: Path,
    limit: int = 100,
    session_paths: dict[str, str] | None = None,
    identity: Identity | None = None,
    mine_only: bool = False,
) -> dict:
    """Get commit graph data for metro-style visualization.

    ``session_paths`` maps a resolved worktree path to the owning session name; it
    is supplied by the caller so this module stays free of session-store coupling.

    ``mine_only`` narrows the walk to the operator's own refs plus the trunk, so
    the ``limit`` budget is spent on their work instead of the whole repo's. It
    needs an ``identity`` to mean anything; without one the graph is unfiltered,
    which is the safe way to be wrong.
    """
    empty: dict = {"commits": [], "branches": [], "head": None, "worktrees": []}
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return empty

    if not repo.head.is_valid():
        return empty

    # Build ref maps
    raw_refs = _build_raw_refs(repo)
    local_branch_hash, remote_branch_hash = _build_branch_lookups(raw_refs)
    ref_map = _build_ref_map(raw_refs, local_branch_hash, remote_branch_hash)

    # HEAD info
    head_hash = repo.head.commit.hexsha[:GRAPH_HASH_LEN]
    head_branch = None
    if not repo.head.is_detached:
        try:
            head_branch = repo.active_branch.name
        except TypeError:
            pass

    unpushed_set = _get_unpushed_commits(repo, head_branch)
    stash_hashes, stash_entries = _collect_stash_entries(repo)

    filtering = bool(mine_only and identity)
    # rev-list takes any number of refs; GitPython's annotation only admits one.
    rev: Any = "--all"
    if identity and filtering:
        rev = sorted(_mine_ref_names(cwd, repo, identity, head_branch))

    # Collect commits
    commits = [
        {
            "hash": commit.hexsha[:GRAPH_HASH_LEN],
            "message": commit.summary,
            "author": commit.author.name,
            "authorEmail": commit.author.email or "",
            "authorGravatar": gravatar_url(commit.author.email or "")
            if commit.author.email
            else None,
            "relativeDate": commit.committed_datetime.isoformat(),
            "parents": [p.hexsha[:GRAPH_HASH_LEN] for p in commit.parents],
            "refs": ref_map.get(commit.hexsha, []),
            "pushed": commit.hexsha not in unpushed_set,
        }
        for commit in repo.iter_commits(rev=rev, max_count=limit, topo_order=True)
        if commit.hexsha not in stash_hashes
    ]

    # Insert stash nodes just above their parent commits (date-ordered)
    for entry in stash_entries:
        stash_node = _stash_entry_to_node(entry)
        parent_idx = next(
            (
                i
                for i, c in enumerate(commits)
                if entry["parent"] and c["hash"] == entry["parent"][:GRAPH_HASH_LEN]
            ),
            None,
        )
        if parent_idx is not None:
            commits.insert(parent_idx, stash_node)
        else:
            # Parent not in visible commits — insert by date so stash
            # appears in chronological position instead of at the top.
            stash_date = entry["date"]
            insert_idx = next(
                (i for i, c in enumerate(commits) if c["relativeDate"] <= stash_date),
                len(commits),
            )
            commits.insert(insert_idx, stash_node)

    branches = [
        {
            "name": branch.name,
            "hash": branch.commit.hexsha[:GRAPH_HASH_LEN],
            "current": not repo.head.is_detached and branch.name == head_branch,
        }
        for branch in repo.branches
    ]

    working_changes = None
    if repo.is_dirty(untracked_files=True):
        status = get_porcelain_status(cwd)
        working_changes = {
            "files": len(status),
            "staged": sum(
                1 for f in status if f["status"] in ("added", "modified", "renamed", "deleted")
            ),
            "unstaged": sum(1 for f in status if f["status"] == "untracked"),
        }

    payload = {
        "commits": commits,
        "branches": branches,
        "head": {"hash": head_hash, "branch": head_branch},
        "workingChanges": working_changes,
        "worktrees": _build_graph_worktrees(cwd, session_paths),
        "mine": {"available": bool(identity), "active": filtering},
    }
    payload["version"] = graph_version(payload)
    return payload


def graph_version(payload: dict) -> str:
    """A token identifying exactly this graph payload.

    Hashing the content rather than stamping a time is what makes incremental
    updates safe: git history is not append-only, and a rebase or amend rewrites
    commits that carry older timestamps than the client's cursor.  A content
    hash cannot miss those — the version simply stops matching.

    Equal versions therefore guarantee equal bytes, which is what lets the
    server answer "unchanged" without re-sending anything.
    """
    body = {k: v for k, v in payload.items() if k != "version"}
    return hashlib.md5(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()[:16]


def get_commit_log(cwd: Path, limit: int = 20) -> list[dict]:
    """
    Get recent commit history.

    Args:
        cwd: Repository working directory
        limit: Maximum number of commits to return

    Returns:
        List of commit dicts with hash, shortHash, message, author, relativeDate
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return []

    if not repo.head.is_valid():
        return []

    return [
        {
            "hash": commit.hexsha,
            "shortHash": commit.hexsha[:7],
            "message": commit.summary,
            "author": commit.author.name,
            "relativeDate": commit.committed_datetime.isoformat(),
        }
        for commit in repo.iter_commits(max_count=limit)
    ]


_SHA_RE = re.compile(r"^[0-9a-fA-F]{4,40}$")


def _commit_named_by(repo, text: str):
    """The commit this text names, if it names one.

    ``git log --grep`` searches messages, and a sha is precisely the thing that
    does not appear in the message of the commit it identifies — so searching by
    id found nothing at all without this. Four characters is git's own minimum
    abbreviation; below it a hex string ("cafe", "beef") is almost certainly a
    word, and resolving it would hijack an ordinary text search.
    """
    if not _SHA_RE.match(text):
        return None
    try:
        return repo.commit(repo.git.rev_parse("--verify", f"{text}^{{commit}}"))
    except (GitCommandError, BadName, ValueError):
        return None


def search_commits(
    cwd: Path,
    text: str = "",
    author: str | None = None,
    file: str | None = None,
    limit: int = 100,
) -> list[dict]:
    """Search the whole of history, not just the window the graph has loaded.

    Searches every ref, so a commit on a branch the graph is not showing is
    still findable.  Criteria combine with AND, matching what the client-side
    filter does over the loaded payload.
    """
    if not text and author is None and file is None:
        return []

    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return []

    if not repo.head.is_valid():
        return []

    kwargs: dict = {"all": True, "max_count": limit, "regexp_ignore_case": True}
    if text:
        kwargs["grep"] = text
    if author is not None:
        kwargs["author"] = author

    paths = [file] if file else []

    def described(commit) -> dict:
        return {
            "hash": commit.hexsha,
            "shortHash": commit.hexsha[:7],
            "message": commit.summary,
            "author": commit.author.name,
            "authorEmail": commit.author.email,
            "relativeDate": commit.committed_datetime.isoformat(),
        }

    # A sha names one commit directly. Keep the grep results alongside it, so
    # searching a short sha still turns up the commits whose messages cite it
    # (a revert, a "fixes" line) as well as the commit it identifies.
    named = _commit_named_by(repo, text) if text and author is None and file is None else None

    try:
        commits = repo.iter_commits(paths=paths, **kwargs)
        found = [
            {
                "hash": commit.hexsha,
                "shortHash": commit.hexsha[:7],
                "message": commit.summary,
                "author": commit.author.name,
                "authorEmail": commit.author.email,
                "relativeDate": commit.committed_datetime.isoformat(),
            }
            for commit in commits
        ]
    except GitCommandError:
        found = []

    if named and all(c["hash"] != named.hexsha for c in found):
        found.insert(0, described(named))
    return found


def get_commit_info(cwd: Path, commit_hash: str) -> dict | None:
    """
    Get metadata for a specific commit.

    Returns:
        Dict with hash, message, author, relativeDate, or None if not found
    """
    try:
        repo = get_repo(cwd)
        commit = repo.commit(commit_hash)
        return {
            "hash": commit.hexsha,
            "message": commit.summary,
            "author": commit.author.name,
            "relativeDate": commit.committed_datetime.isoformat(),
        }
    except Exception:
        return None


def get_commit_diff(cwd: Path, commit_hash: str) -> dict | None:
    """
    Get diff for a specific commit.

    Returns:
        Dict with commit info, files (with old/new content), and stats, or None if not found
    """
    try:
        repo = get_repo(cwd)
        commit = repo.commit(commit_hash)
    except Exception:
        return None

    commit_info = {
        "hash": commit.hexsha,
        "message": commit.summary,
        "author": commit.author.name,
        "relativeDate": commit.committed_datetime.isoformat(),
    }

    # Determine parent ref for getting old content
    parent_ref = f"{commit_hash}^" if commit.parents else None

    # Get the diff
    try:
        if commit.parents:
            diff_text = _sanitize(_parseable_diff(repo, f"{commit_hash}^..{commit_hash}"))
        else:
            # First commit - show all files as added
            diff_text = repo.git.show(commit_hash, format="")
    except GitCommandError:
        diff_text = ""

    files = []
    stats = DiffStats()

    if diff_text:
        parsed_files, parsed_stats = parse_diff_output(diff_text)
        for f in parsed_files:
            # Get old content from parent commit (if exists)
            old_content = get_file_content_at_ref(repo, parent_ref, f.path) if parent_ref else None
            # Get new content from this commit
            new_content = get_file_content_at_ref(repo, commit_hash, f.path)
            files.append(
                {
                    "path": f.path,
                    "diff": f.diff,
                    "oldContent": old_content,
                    "newContent": new_content,
                }
            )
        stats = parsed_stats

    return {
        **commit_info,
        "files": files,
        "stats": {"additions": stats.additions, "deletions": stats.deletions},
    }


def _commit_summary(commit) -> dict:
    return {
        "hash": commit.hexsha,
        "shortHash": commit.hexsha[:7],
        "message": commit.summary,
        "author": commit.author.name,
        "relativeDate": commit.committed_datetime.isoformat(),
    }


def _order_by_ancestry(repo: Repo, first, second) -> tuple:
    """The pair as (older, newer), so click order never flips the diff's sign."""
    if repo.is_ancestor(first, second):
        return first, second
    if repo.is_ancestor(second, first):
        return second, first
    return tuple(sorted((first, second), key=lambda c: c.committed_datetime))


def get_range_diff(cwd: Path, from_hash: str, to_hash: str) -> dict | None:
    """
    Get the cumulative diff between two commits.

    The pair is ordered by ancestry (falling back to commit date for commits on
    divergent branches), so selecting them in either order gives the same answer.

    Returns:
        Dict shaped like get_commit_diff plus a `range` block, or None if either
        commit is unknown.
    """
    try:
        repo = get_repo(cwd)
        base, head = _order_by_ancestry(repo, repo.commit(from_hash), repo.commit(to_hash))
    except Exception:
        return None

    try:
        diff_text = _sanitize(_parseable_diff(repo, f"{base.hexsha}..{head.hexsha}"))
    except GitCommandError:
        diff_text = ""

    try:
        commit_count = sum(1 for _ in repo.iter_commits(f"{base.hexsha}..{head.hexsha}"))
    except GitCommandError:
        commit_count = 0

    files = []
    stats = DiffStats()

    if diff_text:
        parsed_files, stats = parse_diff_output(diff_text)
        files = [
            {
                "path": f.path,
                "diff": f.diff,
                "oldContent": get_file_content_at_ref(repo, base.hexsha, f.path),
                "newContent": get_file_content_at_ref(repo, head.hexsha, f.path),
            }
            for f in parsed_files
        ]

    return {
        **_commit_summary(head),
        "range": {
            "from": _commit_summary(base),
            "to": _commit_summary(head),
            "commitCount": commit_count,
        },
        "files": files,
        "stats": {"additions": stats.additions, "deletions": stats.deletions},
    }


def stage_all_and_commit(cwd: Path, message: str) -> dict:
    """
    Stage all changes and create a commit.

    Returns:
        Dict with status, hash, and message
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    # Check if there are any changes
    if not repo.is_dirty(untracked_files=True):
        return {"status": "nothing_to_commit", "message": "No changes to commit"}

    try:
        # Stage all changes
        repo.git.add("-A")

        # Create commit
        commit = repo.index.commit(message)

        return {
            "status": "committed",
            "hash": commit.hexsha[:7],
            "message": message,
        }
    except GitCommandError as e:
        return {"error": f"git commit failed: {e}"}


def amend_commit(cwd: Path, message: str | None = None) -> dict:
    """
    Amend the last commit, staging all current changes.

    If message is provided, use it as the new commit message.
    If message is None, keep the previous commit message (--no-edit).

    Returns:
        Dict with status, hash, and message on success, or error on failure
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    if not repo.head.is_valid():
        return {"error": "No commits to amend"}

    try:
        repo.git.add("-A")
        if message:
            repo.git.commit("--amend", "-m", message)
        else:
            repo.git.commit("--amend", "--no-edit")

        commit = repo.head.commit
        return {
            "status": "amended",
            "hash": commit.hexsha[:7],
            "message": commit.summary,
        }
    except GitCommandError as e:
        return {"error": f"git commit --amend failed: {e}"}


def git_force_push(cwd: Path) -> dict:
    """
    Force push with lease to the remote repository.

    Returns:
        Dict with status, remote, branch, and message on success, or error on failure
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    if repo.head.is_detached:
        return {"error": "Cannot push: HEAD is detached"}

    branch = repo.active_branch

    tracking = branch.tracking_branch()
    if tracking:
        remote_name = tracking.remote_name
    else:
        try:
            remote_name = "origin"
            repo.remote(remote_name)
        except ValueError:
            return {"error": "No remote configured"}

    try:
        repo.git.push("--force-with-lease", remote_name, branch.name)
        return {
            "status": "force_pushed",
            "remote": remote_name,
            "branch": branch.name,
            "message": f"Force pushed {branch.name} to {remote_name}",
        }
    except GitCommandError as e:
        error_msg = str(e)
        if "stale info" in error_msg or "rejected" in error_msg:
            return {"error": "Force push rejected: remote has newer changes. Fetch first."}
        if "Authentication failed" in error_msg or "could not read Username" in error_msg:
            return {
                "error": "Force push failed: HTTP remote requires credentials. Switch to SSH or configure a credential helper."
            }
        return {"error": f"Force push failed: {e}"}


def git_stash(cwd: Path) -> dict:
    """
    Stash all changes (including untracked files).

    Returns:
        Dict with status and message on success, or error on failure
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    if not repo.is_dirty(untracked_files=True):
        return {"error": "No changes to stash"}

    try:
        repo.git.stash("push", "-u")
        return {
            "status": "stashed",
            "message": "Changes stashed",
        }
    except GitCommandError as e:
        return {"error": f"git stash failed: {e}"}


def git_stash_pop(cwd: Path, ref: str | None = None) -> dict:
    """
    Pop a stash entry.

    Args:
        cwd: Working directory
        ref: Optional stash ref (e.g. "stash@{2}"), defaults to most recent

    Returns:
        Dict with status and message on success, or error on failure
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    try:
        # Check if there are any stashes
        stash_list = repo.git.stash("list")
        if not stash_list:
            return {"error": "No stashes to pop"}

        args = ["pop"]
        if ref:
            args.append(ref)
        repo.git.stash(*args)
        return {
            "status": "popped",
            "message": f"Stash popped ({ref or 'latest'})",
        }
    except GitCommandError as e:
        error_msg = str(e)
        if "conflict" in error_msg.lower():
            return {"error": "Stash pop had conflicts. Resolve them manually."}
        return {"error": f"git stash pop failed: {e}"}


def git_stash_drop(cwd: Path, ref: str | None = None) -> dict:
    """
    Drop (delete) a stash entry without applying it.

    Args:
        cwd: Working directory
        ref: Optional stash ref (e.g. "stash@{2}"), defaults to most recent

    Returns:
        Dict with status and message on success, or error on failure
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    try:
        stash_list = repo.git.stash("list")
        if not stash_list:
            return {"error": "No stashes to drop"}

        args = ["drop"]
        if ref:
            args.append(ref)
        repo.git.stash(*args)
        return {
            "status": "dropped",
            "message": f"Stash dropped ({ref or 'latest'})",
        }
    except GitCommandError as e:
        return {"error": f"git stash drop failed: {e}"}


def get_branches(cwd: Path) -> dict:
    """
    Get local and remote branches.

    Returns:
        Dict with current, local, remote branches and clean status
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"current": "unknown", "local": [], "remote": [], "clean": True}

    current_branch = get_current_branch(cwd)

    # Local branches
    local_branches = [
        {
            "name": branch.name,
            "current": branch.name == current_branch,
        }
        for branch in repo.branches
    ]

    # Remote branches
    remote_branches = []
    try:
        for ref in repo.remote().refs:
            if not ref.name.endswith("/HEAD"):
                parts = ref.name.split("/", 1)
                remote_branches.append(
                    {
                        "name": ref.name,
                        "remote": parts[0] if len(parts) > 1 else None,
                    }
                )
    except ValueError:
        # No remote configured
        pass

    # Clean status
    clean = not repo.is_dirty(untracked_files=True)

    return {
        "current": current_branch,
        "local": local_branches,
        "remote": remote_branches,
        "clean": clean,
    }


_WORKTREE_CONFLICT = re.compile(r"is already used by worktree at '(?P<path>[^']+)'")


def _clean_git_stderr(raw: str) -> str:
    """Peel GitPython's packaging off git's own message.

    ``GitCommandError.stderr`` is not bare stderr: it arrives as
    ``"\n  stderr: 'fatal: ...'"``, and ``str(e)`` adds the exit code and command
    line on top. Strip exactly one layer of that wrapper, then git's own
    ``fatal:``/``error:`` prefix, and leave the rest alone — the inner quoting is
    load-bearing, since the branch and the worktree path are quoted inside it.
    """
    text = raw.strip()
    if text.startswith("stderr:"):
        text = text[len("stderr:") :].strip()
        if len(text) >= 2 and text.startswith("'") and text.endswith("'"):
            text = text[1:-1]
    for prefix in ("fatal: ", "error: "):
        if text.startswith(prefix):
            text = text[len(prefix) :]
            break
    return text.strip()


def _git_error(e: GitCommandError) -> dict:
    """Turn a GitCommandError into something worth showing a person.

    When git reports the branch is held by a worktree, return that path as its
    own field: it names where the branch actually is, which is the only thing
    that lets someone act on the failure.
    """
    message = _clean_git_stderr(e.stderr or str(e))
    match = _WORKTREE_CONFLICT.search(message)
    if match:
        return {"error": message, "worktree_path": match.group("path")}
    return {"error": message}


def checkout_branch(cwd: Path, branch: str, reset_to: str | None = None) -> dict:
    """
    Checkout a branch if the working directory is clean.
    If reset_to is provided, reset the branch to that commit after checkout.

    Returns:
        Dict with status, branch, and message
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    # Safety check: ensure working directory is clean
    if repo.is_dirty(untracked_files=False):
        return {"error": "Working directory has pending changes. Commit or stash changes first."}

    try:
        repo.git.checkout(branch)
        if reset_to:
            repo.git.reset("--hard", reset_to)
        current_branch = get_current_branch(cwd)
        return {
            "status": "success",
            "branch": current_branch,
            "message": f"Switched to branch '{current_branch}'"
            + (f" and reset to {reset_to[:7]}" if reset_to else ""),
        }
    except GitCommandError as e:
        return _git_error(e)


def delete_branch(
    cwd: Path,
    branch: str,
    delete_remote: bool = False,
    remote_only: bool = False,
) -> dict:
    """
    Delete a branch locally and/or on the remote.

    Refuses to delete the currently checked-out branch.
    When remote_only=True, only the remote tracking branch is deleted.
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    message = ""

    if remote_only:
        # Strip origin/ prefix if present for the push --delete command
        remote_name = branch.removeprefix("origin/")
        try:
            repo.git.push("origin", "--delete", remote_name)
            message = f"Deleted remote branch 'origin/{remote_name}'"
        except GitCommandError as e:
            return {"error": f"Failed to delete remote branch: {e}"}
        return {"status": "success", "message": message}

    current = get_current_branch(cwd)
    if branch == current:
        return {"error": f"Cannot delete the current branch '{branch}'."}

    try:
        repo.git.branch("-D", branch)
        message = f"Deleted local branch '{branch}'"
    except GitCommandError as e:
        return {"error": f"Failed to delete local branch: {e}"}

    if delete_remote:
        try:
            repo.git.push("origin", "--delete", branch)
            message += f" and remote 'origin/{branch}'"
        except GitCommandError as e:
            return {"status": "partial", "message": f"{message}, but remote delete failed: {e}"}

    return {"status": "success", "message": message}


def get_reflog(cwd: Path, limit: int = 50) -> list[dict]:
    """Recent HEAD movements, newest first.

    This is the undo history the commit graph cannot show: after a hard reset or
    an abandoned rebase the commit you want is unreachable, so `git log` — which
    only walks what is still reachable — is exactly the wrong place to look for
    it. Every entry here is a commit HEAD once pointed at, recoverable by
    branching from it or resetting back to it.
    """
    try:
        repo = get_repo(cwd)
    except (InvalidGitRepositoryError, NoSuchPathError):
        return []

    # --date=relative makes %gd read "HEAD@{2 hours ago}", which says when but is
    # no longer a selector git will take back. Keep it for the human timestamp and
    # rebuild the real selector from the position, which is what HEAD@{n} means.
    unit = chr(31)
    try:
        output = str(
            repo.git.reflog("--date=relative", f"--format=%H{unit}%gd{unit}%gs", f"-{limit}")
        )
    except GitCommandError:
        return []

    entries = []
    for index, line in enumerate(output.splitlines()):
        parts = line.split(unit)
        if len(parts) != 3:
            continue
        hexsha, dated_selector, message = parts
        _, _, when = dated_selector.partition("@{")
        entries.append(
            {
                "hash": hexsha,
                "shortHash": hexsha[:7],
                "selector": f"HEAD@{{{index}}}",
                # "commit", "reset", "rebase", "checkout"... — what moved HEAD.
                # Just the verb: git qualifies some of them ("commit (initial)",
                # "merge feat/x") and that detail belongs in the message.
                "action": message.split(":", 1)[0].split(" ", 1)[0].strip(),
                "message": message,
                "relativeDate": when.rstrip("}"),
            }
        )
    return entries


def list_remote_tags(cwd: Path, remote: str = "origin") -> list[str]:
    """The tags ``remote`` has, newest-first as git reports them.

    Git keeps no local record of which tags it pushed — ``refs/tags`` is one flat
    namespace — so the only way to know whether deleting a tag affects anyone else
    is to ask the remote. Callers should cache this: it is a network round trip.
    Returns an empty list for a repo with no such remote rather than raising.
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return []
    if remote not in [r.name for r in repo.remotes]:
        return []
    try:
        output = str(repo.git.ls_remote("--tags", "--refs", remote))
    except GitCommandError:
        return []
    tags = []
    for line in output.splitlines():
        _, _, ref = line.partition("\t")
        if ref.startswith("refs/tags/"):
            tags.append(ref[len("refs/tags/") :])
    return tags


def delete_tag(cwd: Path, tag: str, delete_remote: bool = False) -> dict:
    """Delete a tag locally, and on origin when ``delete_remote`` is set."""
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    try:
        repo.git.tag("-d", tag)
    except GitCommandError as e:
        return {"error": f"Failed to delete tag: {e}"}
    message = f"Deleted tag '{tag}'"

    if delete_remote:
        try:
            repo.git.push("origin", "--delete", f"refs/tags/{tag}")
        except GitCommandError as e:
            return {"status": "partial", "message": f"{message}, but remote delete failed: {e}"}
        message += " on origin too"

    return {"status": "success", "message": message}


def reset_to_head(cwd: Path) -> dict:
    """
    Reset all changes to HEAD (discard all uncommitted changes).

    This performs:
    - git reset --hard HEAD (discard staged and unstaged changes)
    - git clean -fd (remove untracked files and directories)

    Returns:
        Dict with status and message
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    # Check if there are any changes to reset
    if not repo.is_dirty(untracked_files=True):
        return {"status": "nothing_to_reset", "message": "No changes to reset"}

    try:
        # Reset tracked files to HEAD
        repo.git.reset("--hard", "HEAD")

        # Remove untracked files and directories
        repo.git.clean("-fd")

        return {
            "status": "reset",
            "message": "All changes have been reverted to last commit",
        }
    except GitCommandError as e:
        return {"error": f"git reset failed: {e}"}


def revert_file(cwd: Path, file_path: str) -> dict:
    """Revert a single file to its HEAD state, or remove it if untracked."""
    # Validate path: reject absolute paths and traversal
    if file_path.startswith("/") or ".." in file_path.split("/"):
        return {"error": "Invalid file path"}

    resolved = (cwd / file_path).resolve()
    if not str(resolved).startswith(str(cwd.resolve())):
        return {"error": "Path escapes repository root"}

    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    try:
        # Check if file is untracked
        if file_path in repo.untracked_files:
            repo.git.clean("-f", "--", file_path)
        else:
            # Unstage first (in case it's staged), then restore from HEAD
            repo.git.reset("HEAD", "--", file_path)
            repo.git.checkout("HEAD", "--", file_path)

        return {
            "status": "reverted",
            "message": f"Reverted: {file_path}",
        }
    except GitCommandError as e:
        return {"error": f"Failed to revert file: {e}"}


def _check_http_auth_warning(repo: "Repo", remote_name: str) -> str | None:
    """Check if a remote uses HTTP(S) without embedded credentials or a credential helper."""
    try:
        remote = repo.remote(remote_name)
        url = remote.url
    except (ValueError, AttributeError):
        return None

    if not url.startswith(("http://", "https://")):
        return None

    # URL has embedded credentials (e.g. https://user:token@host) — no warning
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.username:
        return None

    # Check if a credential helper is configured for this repo
    try:
        helper = repo.config_reader().get_value("credential", "helper", default="")
        if helper:
            return None
    except Exception:  # noqa: S110 - credential check is best-effort
        pass

    return (
        "This repo uses an HTTP remote without stored credentials. "
        "Push/pull/fetch will fail. Switch to SSH or configure a credential helper."
    )


def _resolve_tracking_info(repo: Repo, branch) -> dict | tuple[str, str]:
    """Resolve tracking ref and remote name for a branch.

    Returns a dict (early-return error/result) or a (tracking_ref, remote_name) tuple.
    """
    tracking = branch.tracking_branch()
    if tracking:
        return (tracking.name, tracking.remote_name)

    # No tracking branch — check if origin has a matching branch
    try:
        repo.remote("origin")
    except ValueError:
        return {"error": "No remote configured", "ahead": 0, "behind": 0}

    remote_ref = f"origin/{branch.name}"
    try:
        repo.git.rev_parse("--verify", remote_ref)
    except GitCommandError:
        result = {
            "branch": branch.name,
            "remote": "origin",
            "ahead": 0,
            "behind": 0,
            "noTracking": True,
            "noRemoteBranch": True,
        }
        warning = _check_http_auth_warning(repo, "origin")
        if warning:
            result["httpAuthWarning"] = warning
        return result

    return (remote_ref, "origin")


def _fetch_remote(repo: Repo, remote_name: str) -> tuple[bool, str | None]:
    """Fetch from remote, returning (fetch_failed, http_warning_override).

    Prunes, because a plain fetch only ever adds remote-tracking refs.  Every
    branch squash-merged and auto-deleted on the forge leaves one behind
    permanently, and the graph draws them all — on repos with a bot opening
    dependency PRs they end up outnumbering the live branches.  Pruning drops
    only the local bookkeeping for branches the remote no longer has; local
    branches and commits are not its business.

    Forces tags for the mirror-image reason: git will not overwrite a tag ref it
    already has, so a tag that moves upstream freezes at whatever commit this clone
    first saw.  Rolling release tags do exactly that — CI deletes and recreates
    ``alpha`` at each new build — and the graph then badges an old commit as the
    current release indefinitely.  Tags are deliberately *not* pruned: ``--prune-tags``
    would delete every tag the user made locally, which is not ours to do.
    """
    try:
        repo.remote(remote_name).fetch(prune=True, tags=True, force=True)
        return (False, None)
    except GitCommandError as e:
        error_msg = str(e)
        if "Authentication failed" in error_msg or "could not read Username" in error_msg:
            return (
                True,
                "Authentication failed for HTTP remote. "
                "Switch to SSH or configure a credential helper.",
            )
        return (True, None)


def get_remote_status(cwd: Path, fetch: bool = True) -> dict:
    """Get ahead/behind status relative to remote tracking branch."""
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    if repo.head.is_detached:
        return {"error": "HEAD is detached", "ahead": 0, "behind": 0}

    branch = repo.active_branch
    tracking_info = _resolve_tracking_info(repo, branch)
    if isinstance(tracking_info, dict):
        return tracking_info
    tracking_ref, remote_name = tracking_info

    http_warning = _check_http_auth_warning(repo, remote_name)

    fetch_failed = False
    if fetch:
        fetch_failed, warning_override = _fetch_remote(repo, remote_name)
        if warning_override:
            http_warning = warning_override

    try:
        ahead = int(repo.git.rev_list("--count", f"{tracking_ref}..{branch.name}"))
        behind = int(repo.git.rev_list("--count", f"{branch.name}..{tracking_ref}"))
    except GitCommandError:
        ahead = 0
        behind = 0

    result = {
        "branch": branch.name,
        "remote": remote_name,
        "tracking": tracking_ref,
        "ahead": ahead,
        "behind": behind,
    }
    if http_warning:
        result["httpAuthWarning"] = http_warning
    if fetch_failed:
        result["fetchFailed"] = True
    return result


def _classify_push_error(e: GitCommandError) -> str:
    """Turn a push GitCommandError into a user-friendly message."""
    error_msg = str(e)
    if "Could not read from remote repository" in error_msg:
        return "Push failed: Could not connect to remote repository"
    if "Authentication failed" in error_msg or "Permission denied" in error_msg:
        return "Push failed: Authentication error. Switch to SSH or configure a credential helper."
    if "could not read Username" in error_msg:
        return "Push failed: HTTP remote requires credentials. Switch to SSH or configure a credential helper."
    return f"Push failed: {e}"


def _check_push_info(push_info) -> str | None:
    """Check push info flags for errors. Returns error message or None."""
    for info in push_info:
        if info.flags & info.ERROR:
            return f"Push failed: {info.summary}"
        if info.flags & info.REJECTED:
            return "Push rejected: non-fast-forward update. Pull first."
        if info.flags & info.REMOTE_REJECTED:
            return f"Push rejected by remote: {info.summary}"
    return None


def git_push(cwd: Path) -> dict:
    """Push commits to the remote repository."""
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    if repo.head.is_detached:
        return {"error": "Cannot push: HEAD is detached"}

    branch = repo.active_branch
    tracking = branch.tracking_branch()
    if tracking:
        remote_name = tracking.remote_name
    else:
        try:
            remote_name = "origin"
            repo.remote(remote_name)
        except ValueError:
            return {"error": "No remote configured"}

    try:
        push_info = repo.remote(remote_name).push(branch.name)
        error = _check_push_info(push_info)
        if error:
            return {"error": error}
        return {
            "status": "pushed",
            "remote": remote_name,
            "branch": branch.name,
            "message": f"Pushed {branch.name} to {remote_name}",
        }
    except GitCommandError as e:
        return {"error": _classify_push_error(e)}


def _classify_pull_error(e: GitCommandError) -> str:
    """Turn a pull GitCommandError into a user-friendly message."""
    error_msg = str(e)
    if "Could not read from remote repository" in error_msg:
        return "Pull failed: Could not connect to remote repository"
    if "Authentication failed" in error_msg or "Permission denied" in error_msg:
        return "Pull failed: Authentication error. Switch to SSH or configure a credential helper."
    if "could not read Username" in error_msg:
        return "Pull failed: HTTP remote requires credentials. Switch to SSH or configure a credential helper."
    return f"Pull failed: {e}"


def _is_conflict_error(e: GitCommandError) -> bool:
    """Check if a pull/rebase error is due to conflicts."""
    msg = str(e).lower()
    return "conflict" in msg or "could not apply" in msg


def _safe_stash_pop(repo: Repo) -> None:
    """Best-effort stash pop."""
    try:
        repo.git.stash("pop")
    except GitCommandError:
        pass


def _handle_pull_conflict(repo: Repo, stashed: bool) -> dict:
    """Abort rebase and restore stash after a conflict."""
    try:
        repo.git.rebase("--abort")
    except GitCommandError:
        pass
    if stashed:
        _safe_stash_pop(repo)
    return {"error": "Rebase conflicts detected. Aborting rebase and restoring state."}


def _restore_stash_after_pull(repo: Repo, branch_name: str, remote_name: str) -> dict:
    """Pop the stash after a successful pull, handling conflicts."""
    try:
        repo.git.stash("pop")
    except GitCommandError:
        return {
            "status": "pulled",
            "stashConflict": True,
            "message": "Pulled successfully but stash pop had conflicts. Resolve manually with 'git stash pop'.",
        }
    return {
        "status": "pulled",
        "stashed": True,
        "message": f"Pulled and rebased {branch_name} from {remote_name}",
    }


def _auto_stash_if_dirty(repo: Repo) -> tuple[bool, str | None]:
    """Stash changes if working directory is dirty. Returns (stashed, error_msg)."""
    if not repo.is_dirty(untracked_files=True):
        return (False, None)
    try:
        repo.git.stash("push", "-u", "-m", "lumbergh-auto-stash")
        return (True, None)
    except GitCommandError as e:
        return (False, f"Failed to stash changes: {e}")


def git_pull_rebase(cwd: Path) -> dict:
    """Pull changes from remote with rebase. Aborts on conflicts."""
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    if repo.head.is_detached:
        return {"error": "Cannot pull: HEAD is detached"}

    branch = repo.active_branch
    tracking = branch.tracking_branch()
    if tracking:
        remote_name = tracking.remote_name
    else:
        try:
            remote_name = "origin"
            repo.remote(remote_name)
        except ValueError:
            return {"error": "No remote configured"}

    stashed, stash_err = _auto_stash_if_dirty(repo)
    if stash_err:
        return {"error": stash_err}

    try:
        repo.git.pull("--rebase")
    except GitCommandError as e:
        if _is_conflict_error(e):
            return _handle_pull_conflict(repo, stashed)
        if stashed:
            _safe_stash_pop(repo)
        return {"error": _classify_pull_error(e)}

    if stashed:
        return _restore_stash_after_pull(repo, branch.name, remote_name)

    return {
        "status": "pulled",
        "stashed": False,
        "message": f"Pulled and rebased {branch.name} from {remote_name}",
    }


def git_fast_forward(cwd: Path, source_branch: str) -> dict:
    """Fast-forward current branch to match source branch (--ff-only)."""
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    if repo.head.is_detached:
        return {"error": "Cannot fast-forward: HEAD is detached"}

    current_branch = repo.active_branch.name

    try:
        repo.commit(source_branch)
    except Exception:
        return {"error": f"Branch '{source_branch}' not found"}

    if repo.is_dirty(untracked_files=False):
        return {"error": "Cannot fast-forward: working directory has uncommitted changes"}

    try:
        repo.git.merge("--ff-only", source_branch)
    except GitCommandError:
        return {
            "error": f"Cannot fast-forward {current_branch} to {source_branch}. "
            f"Rebase {source_branch} onto {current_branch} first."
        }

    return {
        "status": "fast-forwarded",
        "message": f"Fast-forwarded {current_branch} to {source_branch}",
        "hash": repo.head.commit.hexsha[:7],
    }


def _handle_rebase_error(
    e: GitCommandError, repo: Repo, stashed: bool, current: str, target: str
) -> dict:
    """Handle a rebase failure: abort on conflicts and restore stash."""
    if _is_conflict_error(e):
        try:
            repo.git.rebase("--abort")
        except GitCommandError:
            pass
        if stashed:
            _safe_stash_pop(repo)
        return {
            "error": f"Rebase conflicts between {current} and {target}. "
            "Resolve manually in the terminal."
        }
    if stashed:
        _safe_stash_pop(repo)
    return {"error": f"Rebase failed: {e}"}


def _restore_stash_after_op(repo: Repo, result: dict[str, str | bool]) -> None:
    """Pop stash after a successful git operation, flagging conflicts."""
    try:
        repo.git.stash("pop")
    except GitCommandError:
        result["stashConflict"] = True
        result["message"] = str(result["message"]) + " (stash conflicts — resolve manually)"


def git_rebase_onto(cwd: Path, target_branch: str) -> dict:
    """Rebase current branch onto target branch."""
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    if repo.head.is_detached:
        return {"error": "Cannot rebase: HEAD is detached"}

    current_branch = repo.active_branch.name

    try:
        repo.commit(target_branch)
    except Exception:
        return {"error": f"Branch '{target_branch}' not found"}

    stashed, stash_err = _auto_stash_if_dirty(repo)
    if stash_err:
        return {"error": stash_err}

    try:
        repo.git.rebase(target_branch)
    except GitCommandError as e:
        return _handle_rebase_error(e, repo, stashed, current_branch, target_branch)

    result: dict[str, str | bool] = {
        "status": "rebased",
        "message": f"Rebased {current_branch} onto {target_branch}",
        "hash": repo.head.commit.hexsha[:7],
    }

    if stashed:
        _restore_stash_after_op(repo, result)

    return result


def git_cherry_pick(cwd: Path, commit_hash: str) -> dict:
    """Cherry-pick a commit onto the current branch."""
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    if repo.head.is_detached:
        return {"error": "Cannot cherry-pick: HEAD is detached"}

    try:
        commit = repo.commit(commit_hash)
    except Exception:
        return {"error": f"Commit '{commit_hash}' not found"}

    stashed, stash_err = _auto_stash_if_dirty(repo)
    if stash_err:
        return {"error": stash_err}

    try:
        repo.git.cherry_pick(commit.hexsha)
    except GitCommandError as e:
        # Abort the cherry-pick on conflict
        try:
            repo.git.cherry_pick("--abort")
        except GitCommandError:
            pass
        if stashed:
            _restore_stash_after_op(repo, {})
        msg = str(e.stderr or e.stdout or e).strip()
        return {"error": f"Cherry-pick failed (conflict): {msg}"}

    result: dict[str, str | bool] = {
        "status": "cherry-picked",
        "message": f"Cherry-picked {commit.hexsha[:7]} onto {repo.active_branch.name}",
        "hash": repo.head.commit.hexsha[:7],
    }

    if stashed:
        _restore_stash_after_op(repo, result)

    return result


# --- Git Worktree Utilities ---


def sanitize_branch_for_path(branch: str) -> str:
    """
    Sanitize a branch name for use in a filesystem path.

    Converts `feat/login` → `feat-login`, `fix/bug#123` → `fix-bug-123`, etc.
    """
    import re

    # Replace slashes and other special chars with hyphens
    sanitized = re.sub(r"[/\\#@:~^]", "-", branch)
    # Remove any other non-alphanumeric chars except hyphen and underscore
    sanitized = re.sub(r"[^a-zA-Z0-9_-]", "", sanitized)
    # Collapse multiple hyphens
    sanitized = re.sub(r"-+", "-", sanitized)
    # Strip leading/trailing hyphens
    return sanitized.strip("-")


def get_worktree_container_path(repo_path: Path) -> Path:
    """
    Get the container directory for worktrees of a repo.

    For `/home/user/src/my-app`, returns `/home/user/src/my-app-worktrees/`
    """
    return repo_path.parent / f"{repo_path.name}-worktrees"


@dataclass
class WorktreeInfo:
    """Information about a git worktree."""

    path: str
    branch: str
    commit: str
    is_main: bool = False


def _parse_worktree_entry(entry: dict[str, str], repo_path: Path) -> WorktreeInfo | None:
    """Convert a parsed worktree dict into a WorktreeInfo, or None if invalid."""
    path = entry.get("path")
    if not path:
        return None
    return WorktreeInfo(
        path=path,
        branch=entry.get("branch", "HEAD"),
        commit=entry.get("commit", "")[:7],
        is_main=path == str(repo_path),
    )


def _parse_worktree_line(line: str, current: dict[str, str]) -> None:
    """Parse a single line from `git worktree list --porcelain` into current dict."""
    if line.startswith("worktree "):
        current["path"] = line[9:]
    elif line.startswith("HEAD "):
        current["commit"] = line[5:]
    elif line.startswith("branch "):
        branch_ref = line[7:]
        current["branch"] = branch_ref.removeprefix("refs/heads/")


def list_worktrees(repo_path: Path) -> list[WorktreeInfo]:
    """
    List all worktrees for a repository.

    Returns:
        List of WorktreeInfo objects
    """
    try:
        repo = get_repo(repo_path)
    except InvalidGitRepositoryError:
        return []

    try:
        output = repo.git.worktree("list", "--porcelain")
    except GitCommandError:
        return []

    worktrees = []
    current: dict[str, str] = {}

    for line in output.split("\n"):
        if line == "":
            wt = _parse_worktree_entry(current, repo_path)
            if wt:
                worktrees.append(wt)
            current = {}
        else:
            _parse_worktree_line(line, current)

    # Don't forget the last entry (no trailing blank line)
    wt = _parse_worktree_entry(current, repo_path)
    if wt:
        worktrees.append(wt)

    return worktrees


def validate_branch_for_worktree(repo_path: Path, branch: str) -> dict:
    """
    Check if a branch can be used for a new worktree.

    A branch cannot be used if it's already checked out in another worktree.

    Returns:
        Dict with 'valid' bool and optional 'error' message
    """
    existing_worktrees = list_worktrees(repo_path)
    for wt in existing_worktrees:
        if wt.branch == branch:
            return {
                "valid": False,
                "error": f"Branch '{branch}' is already checked out in worktree: {wt.path}",
            }
    return {"valid": True}


def _classify_worktree_error(e: GitCommandError, branch: str) -> str:
    """Turn a GitCommandError into a user-friendly message."""
    error_str = str(e)
    if "already exists" in error_str:
        return f"Branch '{branch}' already exists"
    if "is not a valid branch name" in error_str:
        return f"Invalid branch name: {branch}"
    return f"Failed to create worktree: {e}"


def create_worktree(
    repo_path: Path,
    branch: str,
    worktree_path: Path | None = None,
    create_branch: bool = False,
    base_branch: str | None = None,
) -> dict:
    """
    Create a git worktree for a branch.

    Args:
        repo_path: Path to the parent git repository
        branch: Branch name to checkout (or create)
        worktree_path: Where to create the worktree (auto-generated if None)
        create_branch: If True, create a new branch
        base_branch: Branch to base new branch on (defaults to current HEAD)

    Returns:
        Dict with 'path' on success, or 'error' on failure
    """
    try:
        repo = get_repo(repo_path)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    # Validate branch availability
    if not create_branch:
        validation = validate_branch_for_worktree(repo_path, branch)
        if not validation["valid"]:
            return {"error": validation["error"]}

    # Generate worktree path if not provided
    if worktree_path is None:
        container = get_worktree_container_path(Path(repo.working_dir))
        container.mkdir(parents=True, exist_ok=True)
        worktree_path = container / sanitize_branch_for_path(branch)

    # Check if worktree path already exists
    if worktree_path.exists():
        return {"error": f"Worktree path already exists: {worktree_path}"}

    try:
        args = ["add"]
        if create_branch:
            args.extend(["-b", branch, str(worktree_path)])
            if base_branch:
                args.append(base_branch)
        else:
            args.extend([str(worktree_path), branch])
        repo.git.worktree(*args)
        return {"path": str(worktree_path)}
    except GitCommandError as e:
        return {"error": _classify_worktree_error(e, branch)}


def count_unpushed_commits(cwd: Path) -> int:
    """Count commits reachable from the worktree's HEAD but no remote branch.

    This is the reap guard's "unpushed work" check. It protects only this
    worktree's own unpushed/never-pushed work (including a detached HEAD) and
    does not count unpushed commits sitting on unrelated local branches. With
    no remotes at all, every commit on HEAD counts as unpushed, so a
    never-pushed worktree is correctly protected from silent loss. Falls back
    to 0 on git error.
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return 0
    try:
        out = repo.git.rev_list("--count", "HEAD", "--not", "--remotes")
        return int(out.strip() or "0")
    except GitCommandError:
        return 0


def head_tree_matches_a_remote(cwd: Path) -> bool:
    """True if HEAD's tree is byte-identical to some remote-tracking branch tip.

    The reap guard's ``count_unpushed_commits`` check is pure sha ancestry, so a
    commit that was rebased or cherry-picked when it landed reads as "unpushed" —
    its sha was rewritten and the original is an ancestor of no remote. But if the
    worktree's *tree* already matches a remote branch (the base it landed onto),
    the content is live and reaping loses nothing. Falls back to False on error,
    so a genuine never-pushed worktree stays protected.
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return False
    try:
        head_tree = repo.head.commit.tree.hexsha
        for remote in repo.remotes:
            for ref in remote.refs:
                if ref.commit.tree.hexsha == head_tree:
                    return True
    except (GitCommandError, ValueError):
        return False
    return False


def resolve_base_ref(cwd: Path, name: str | None) -> str | None:
    """Turn a recorded base branch name into a ref that exists, preferring the remote
    copy — a stale local `dev` would understate what a branch actually changed."""
    if not name:
        return None
    for candidate in (f"origin/{name}", name):
        verify = subprocess.run(
            ["git", "-C", str(cwd), "rev-parse", "--verify", "--quiet", candidate],
            capture_output=True,
        )
        if verify.returncode == 0:
            return candidate
    return None


def default_base_ref(cwd: Path) -> str:
    """The ref a worktree's work is most likely branched from, for callers that need a
    base and weren't told one. Prefers what the remote itself calls default, then the
    conventional names, and finally ``HEAD`` (which makes a diff against it empty —
    the safe way to be wrong)."""
    result = subprocess.run(
        ["git", "-C", str(cwd), "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()
    for candidate in ("origin/main", "origin/master", "origin/dev"):
        verify = subprocess.run(
            ["git", "-C", str(cwd), "rev-parse", "--verify", "--quiet", candidate],
            capture_output=True,
        )
        if verify.returncode == 0:
            return candidate
    return "HEAD"


def _ref_exists(cwd: Path, ref: str) -> bool:
    return (
        subprocess.run(
            ["git", "-C", str(cwd), "rev-parse", "--verify", "--quiet", ref],
            capture_output=True,
        ).returncode
        == 0
    )


BASE_FETCH_TIMEOUT = 20


def _git_out(cwd: Path, *args: str) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(cwd), *args], capture_output=True, encoding="utf-8", errors="replace"
    )
    return result.stdout.strip() if result.returncode == 0 else None


def _upstream_of(cwd: Path, branch: str) -> str | None:
    """The remote-tracking ref ``branch`` follows, whether or not it is checked out."""
    tracking = _git_out(cwd, "rev-parse", "--abbrev-ref", "--symbolic-full-name", f"{branch}@{{u}}")
    if tracking:
        return tracking
    return f"origin/{branch}" if _ref_exists(cwd, f"origin/{branch}") else None


def _fetch_base(cwd: Path, upstream: str) -> None:
    """Refresh one remote-tracking ref so "what upstream says" isn't itself stale.

    Best-effort by design: a spawn on a laptop with no network must still work, and a
    remote-tracking ref that a recent push already advanced is the common case.
    """
    remote, _, branch = upstream.partition("/")
    if not branch:
        return
    try:
        subprocess.run(
            ["git", "-C", str(cwd), "fetch", "--quiet", remote, branch],
            capture_output=True,
            timeout=BASE_FETCH_TIMEOUT,
            check=False,
        )
    except (subprocess.SubprocessError, OSError):
        logger.debug("could not refresh %s before resolving the spawn base", upstream)


def _is_ancestor(cwd: Path, ancestor: str, descendant: str) -> bool:
    return (
        subprocess.run(
            ["git", "-C", str(cwd), "merge-base", "--is-ancestor", ancestor, descendant],
            capture_output=True,
        ).returncode
        == 0
    )


def head_sha(cwd: Path) -> str | None:
    """The commit a worktree is sitting on, or None if that can't be read."""
    return _git_out(cwd, "rev-parse", "HEAD")


def resolve_spawn_base(repo: Path, name: str, *, fetch: bool = True) -> dict:
    """Which commit a new branch should actually start from, and whether that needed saying.

    ``lb land --push`` advances the remote without fast-forwarding the local branch, so
    the local ``dev`` a spawn resolves is routinely behind the ``dev`` everyone means. A
    worker branched there cannot see work that already landed. So a base that is strictly
    behind its upstream resolves to the upstream instead — but local commits that were
    never pushed are real work, and a base ahead of (or diverged from) its upstream stays
    local rather than silently dropping them.

    ``note`` is empty only when local and upstream agree; any other choice is one the
    caller is expected to print, because choosing silently is what made the original
    incident invisible.
    """
    upstream = _upstream_of(repo, name)
    if upstream and fetch:
        _fetch_base(repo, upstream)

    local_sha = _git_out(repo, "rev-parse", "--verify", "--quiet", name)
    upstream_sha = (
        _git_out(repo, "rev-parse", "--verify", "--quiet", upstream) if upstream else None
    )

    if not upstream_sha:
        return {"ref": name, "sha": local_sha, "note": ""}
    if not local_sha:
        return {"ref": upstream, "sha": upstream_sha, "note": ""}
    if local_sha == upstream_sha:
        return {"ref": name, "sha": local_sha, "note": ""}
    if _is_ancestor(repo, local_sha, upstream_sha):
        return {
            "ref": upstream,
            "sha": upstream_sha,
            "note": f"local {name} ({local_sha[:8]}) is behind {upstream} "
            f"({upstream_sha[:8]}) — branching from {upstream}",
        }
    return {
        "ref": name,
        "sha": local_sha,
        "note": f"local {name} ({local_sha[:8]}) is ahead of or diverged from {upstream} "
        f"({upstream_sha[:8]}) — branching from local {name}",
    }


def landed_reference_points(cwd: Path, base: str | None = None) -> list[str]:
    """Refs whose containing this worktree's patches means reaping it loses nothing.

    The base branch comes first in both spellings, and the *local* one is not a
    fallback: a `commit`-delivery fleet's overseer lands the batch onto local ``dev``
    and pushes later, so between those two moments the local branch is the only place
    the work exists. Every remote tip follows, for a worker whose recorded base is
    stale or absent."""
    named = []
    if base:
        named += [f"origin/{base}", base]
    default = default_base_ref(cwd)
    if default != "HEAD":
        named += [default, default.removeprefix("origin/")]
    refs, seen = [], set()
    for candidate in named:
        if candidate not in seen and _ref_exists(cwd, candidate):
            seen.add(candidate)
            refs.append(candidate)
    try:  # remote tips come from git itself, so they need no verification
        for remote in get_repo(cwd).remotes:
            for ref in remote.refs:
                if ref.name not in seen:
                    seen.add(ref.name)
                    refs.append(ref.name)
    except (InvalidGitRepositoryError, GitCommandError, ValueError):
        pass
    return refs


def head_landed_state(cwd: Path, base: str | None = None) -> dict:
    """Whether this worktree's own commits already exist elsewhere, by patch identity —
    the reap guard's whole question and the ``landed`` signal `lb teardown` reports.

    Push state answers a different question. Under `commit` delivery no worker ever
    pushes, so "unpushed" is the *normal* state of fully landed work and refusing on it
    trains ``--force`` into a reflex. ``git cherry`` is the check that survives the
    rewrite a batch land performs: it marks a commit ``-`` when the reference already
    holds an equivalent patch and ``+`` when it does not, so a ref with no ``+`` lines
    holds all of this worktree's work.

    ``landed`` is ``None`` when the question could not be answered at all — a consumer
    that resets a tracking issue on ``false`` must be able to tell the two apart. A
    worktree with zero commits of its own (a scout that delivered a report) landed
    *nothing*: ``landed`` is ``False`` with ``commits`` 0, never a vacuous ``True``.
    """
    unknown = {"landed": None, "commits": None, "base": None}
    refs = landed_reference_points(cwd, base)
    if not refs:
        return unknown
    try:
        repo = get_repo(cwd)
        commits = int(repo.git.rev_list("--count", f"{refs[0]}..HEAD").strip() or "0")
    except (InvalidGitRepositoryError, GitCommandError, ValueError):
        return unknown
    if commits == 0:
        return {"landed": False, "commits": 0, "base": refs[0]}
    for ref in refs:
        try:
            cherry = repo.git.cherry(ref, "HEAD")
        except (GitCommandError, ValueError):
            continue  # one unusable ref must not decide the whole question
        if not any(line.startswith("+") for line in cherry.splitlines()):
            return {"landed": True, "commits": commits, "base": ref}
    # A solo land leaves the worktree's tree equal to the remote tip even when the
    # patches were squashed on the way in, which patch identity cannot see.
    landed = count_unpushed_commits(cwd) == 0 or head_tree_matches_a_remote(cwd)
    return {"landed": landed, "commits": commits, "base": refs[0]}


def remove_worktree(repo_path: Path, worktree_path: Path, force: bool = False) -> dict:
    """
    Remove a git worktree.

    Args:
        repo_path: Path to the parent git repository
        worktree_path: Path to the worktree to remove
        force: If True, force removal even with uncommitted changes

    Returns:
        Dict with 'status' on success, or 'error' on failure
    """
    try:
        repo = get_repo(repo_path)
    except (InvalidGitRepositoryError, NoSuchPathError):
        return {"error": "Not a git repository"}

    try:
        if force:
            repo.git.worktree("remove", "--force", str(worktree_path))
        else:
            repo.git.worktree("remove", str(worktree_path))
        return {"status": "removed", "path": str(worktree_path)}
    except GitCommandError as e:
        error_str = str(e)
        if "contains modified or untracked files" in error_str:
            return {"error": "Worktree has uncommitted changes. Use force=True to override."}
        return {"error": f"Failed to remove worktree: {e}"}


def create_branch_at(cwd: Path, branch_name: str, start_point: str | None = None) -> dict:
    """
    Create a new branch at a given commit (or HEAD if no start_point).

    Returns:
        Dict with status, branch, hash on success, or error on failure
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    try:
        if start_point:
            repo.git.checkout("-b", branch_name, start_point)
        else:
            repo.git.checkout("-b", branch_name)

        # Resolve the hash the branch points to
        commit = repo.commit(start_point) if start_point else repo.head.commit
        return {
            "status": "created",
            "branch": branch_name,
            "hash": commit.hexsha[:7],
        }
    except GitCommandError as e:
        error_str = str(e)
        if "already exists" in error_str:
            return {"error": f"Branch '{branch_name}' already exists"}
        if "not a valid object" in error_str:
            return {"error": f"Invalid start point: {start_point}"}
        return {"error": f"Failed to create branch: {e}"}


def reset_to_commit(cwd: Path, commit_hash: str, mode: str = "hard") -> dict:
    """
    Reset HEAD to a specific commit.

    Args:
        cwd: Repository working directory
        commit_hash: The commit to reset to
        mode: 'hard' (discard all changes) or 'soft' (keep changes staged)

    Returns:
        Dict with status, hash, message on success, or error on failure
    """
    if mode not in ("hard", "soft"):
        return {"error": f"Invalid mode: {mode}. Use 'hard' or 'soft'."}

    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    try:
        repo.git.reset(f"--{mode}", commit_hash)

        # For hard reset, also clean untracked files (same as reset_to_head)
        if mode == "hard":
            repo.git.clean("-fd")

        commit = repo.commit(commit_hash)
        return {
            "status": f"reset_{mode}",
            "hash": commit.hexsha[:7],
            "message": f"Reset {mode} to {commit.hexsha[:7]}",
        }
    except GitCommandError as e:
        return {"error": f"git reset --{mode} failed: {e}"}


def _reword_head(repo: Repo, message: str) -> dict:
    """Reword the HEAD commit via simple amend."""
    try:
        repo.git.commit("--amend", "--only", "-m", message)
        return {"status": "reworded", "hash": repo.head.commit.hexsha[:7], "message": message}
    except GitCommandError as e:
        return {"error": f"Amend failed: {e}"}


def _abort_rebase(cwd: Path) -> None:
    """Attempt to abort an in-progress rebase."""
    subprocess.run(["git", "rebase", "--abort"], cwd=str(cwd), capture_output=True, timeout=10)


def _reword_via_rebase(cwd: Path, repo: Repo, commit_hash: str, message: str) -> dict:
    """Reword a non-HEAD commit via interactive rebase with automated editors."""
    short = repo.commit(commit_hash).hexsha[:7]
    seq_editor = f"sed -i 's/^pick {short}/reword {short}/' \"$1\""

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False, prefix="lumbergh-reword-"
    ) as f:
        f.write(message)
        msg_file = f.name

    env = {
        "GIT_SEQUENCE_EDITOR": seq_editor,
        "GIT_EDITOR": f"sh -c 'cp {msg_file} \"$1\"'",
    }

    try:
        result = subprocess.run(
            ["git", "rebase", "-i", f"{commit_hash}^"],
            cwd=str(cwd),
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            env={**os.environ, **env},
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        _abort_rebase(cwd)
        return {"error": "Rebase timed out"}
    finally:
        Path(msg_file).unlink(missing_ok=True)

    if result.returncode != 0:
        _abort_rebase(cwd)
        return {"error": f"Rebase failed: {result.stderr.strip()}"}

    return {"status": "reworded", "hash": repo.head.commit.hexsha[:7], "message": message}


def reword_commit(cwd: Path, commit_hash: str, message: str) -> dict:
    """
    Reword (edit the message of) a commit.

    For HEAD: uses `git commit --amend -m <message>` (no staging changes).
    For non-HEAD: uses `git rebase` with GIT_SEQUENCE_EDITOR to automate the reword.
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    if not repo.head.is_valid():
        return {"error": "No commits to reword"}
    if repo.head.is_detached:
        return {"error": "Cannot reword: HEAD is detached"}

    try:
        target = repo.commit(commit_hash)
    except Exception:
        return {"error": f"Commit not found: {commit_hash}"}

    if target.hexsha == repo.head.commit.hexsha:
        return _reword_head(repo, message)

    if repo.is_dirty(untracked_files=True):
        return {
            "error": "Working tree is dirty. Commit or stash changes before rewording non-HEAD commits."
        }

    try:
        repo.git.merge_base("--is-ancestor", commit_hash, "HEAD")
    except GitCommandError:
        return {"error": "Commit is not an ancestor of HEAD on the current branch"}

    return _reword_via_rebase(cwd, repo, commit_hash, message)


def get_branches_for_worktree(repo_path: Path) -> dict:
    """
    Get branches available for creating a worktree.

    Returns all local branches with info about whether they're available
    (not already checked out in a worktree).

    Returns:
        Dict with 'branches' list and 'current' branch name
    """
    try:
        repo = get_repo(repo_path)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository", "branches": [], "current": None}

    # Get existing worktrees to check which branches are in use
    existing_worktrees = list_worktrees(repo_path)
    used_branches = {wt.branch for wt in existing_worktrees}

    current_branch = get_current_branch(repo_path)

    branches = [
        {
            "name": branch.name,
            "available": branch.name not in used_branches,
            "inWorktree": branch.name in used_branches,
            "current": branch.name == current_branch,
        }
        for branch in repo.branches
    ]

    return {
        "branches": branches,
        "current": current_branch,
    }
