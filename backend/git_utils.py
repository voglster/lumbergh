"""
Git utilities for the Lumbergh backend using GitPython.
"""

from dataclasses import dataclass
from pathlib import Path

import hashlib
import os
import subprocess
import tempfile

from git import InvalidGitRepositoryError, Repo
from git.exc import GitCommandError


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
            path = diff.b_path or diff.a_path
            files.append({"path": path, "status": _get_diff_status(diff, staged=True)})
            seen_paths.add(path)

    # Unstaged changes (working tree vs index)
    for diff in repo.index.diff(None):
        path = diff.a_path or diff.b_path
        if path not in seen_paths:
            files.append({"path": path, "status": _get_diff_status(diff, staged=False)})

    # Untracked files
    for path in repo.untracked_files:
        files.append({"path": path, "status": "untracked"})

    return files


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

    try:
        content = full_path.read_text(errors="replace")
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
    except Exception:
        return None, stats


def get_file_content_at_ref(repo: Repo, ref: str, path: str) -> str | None:
    """Get file content at a specific git ref (commit, HEAD, etc.)."""
    try:
        return repo.git.show(f"{ref}:{path}")
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

    files = []
    total_stats = DiffStats()
    workdir = Path(repo.working_dir)

    # Get diff of working tree against HEAD
    if repo.head.is_valid():
        try:
            diff_text = repo.git.diff("HEAD")
            if diff_text:
                parsed_files, stats = parse_diff_output(diff_text)
                for f in parsed_files:
                    # Get old content from HEAD
                    old_content = get_file_content_at_ref(repo, "HEAD", f.path)
                    # Get new content from working directory
                    try:
                        new_content = (workdir / f.path).read_text(errors="replace")
                    except Exception:
                        new_content = None
                    files.append({
                        "path": f.path,
                        "diff": f.diff,
                        "oldContent": old_content,
                        "newContent": new_content,
                    })
                total_stats.additions += stats.additions
                total_stats.deletions += stats.deletions
        except GitCommandError:
            pass

    # Add untracked files (new files - no old content)
    for untracked_path in repo.untracked_files:
        file_diff, stats = generate_untracked_file_diff(workdir, untracked_path)
        if file_diff:
            try:
                new_content = (workdir / untracked_path).read_text(errors="replace")
            except Exception:
                new_content = None
            files.append({
                "path": file_diff.path,
                "diff": file_diff.diff,
                "oldContent": None,
                "newContent": new_content,
            })
            total_stats.additions += stats.additions

    return {
        "files": files,
        "stats": {"additions": total_stats.additions, "deletions": total_stats.deletions},
    }


def get_graph_log(cwd: Path, limit: int = 100) -> dict:
    """
    Get commit graph data for metro-style visualization.

    Returns:
        Dict with commits (including parents and refs), branches, and HEAD info
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"commits": [], "branches": [], "head": None}

    if not repo.head.is_valid():
        return {"commits": [], "branches": [], "head": None}

    # Build hash → ref names map, tracking local vs remote vs tag
    # Each entry: (name, kind) where kind is 'local', 'remote', or 'tag'
    raw_refs: dict[str, list[tuple[str, str]]] = {}
    for ref in repo.refs:
        name = ref.name
        kind = "local"
        if name.startswith("refs/heads/"):
            name = name[11:]
        elif name.startswith("refs/remotes/"):
            name = name[13:]
            kind = "remote"
        elif name.startswith("refs/tags/"):
            name = name[10:]
            kind = "tag"
        elif name.startswith("origin/"):
            # RemoteReference without refs/remotes/ prefix (e.g. origin/HEAD)
            kind = "remote"
        if name == "origin/HEAD":
            continue  # symref to default branch, not a real branch
        try:
            hexsha = ref.commit.hexsha
        except Exception:
            continue
        raw_refs.setdefault(hexsha, []).append((name, kind))

    # Build a lookup: branch_name → hash for local and remote refs
    local_branch_hash: dict[str, str] = {}
    remote_branch_hash: dict[str, str] = {}
    for hexsha, entries in raw_refs.items():
        for name, kind in entries:
            if kind == "remote" and name.startswith("origin/"):
                remote_branch_hash[name[7:]] = hexsha
            elif kind == "local" and name != "HEAD":
                local_branch_hash[name] = hexsha

    # Build enriched ref_map: hash → list of { name, local, remote }
    ref_map: dict[str, list[dict]] = {}
    seen_per_commit: dict[str, set[str]] = {}
    for hexsha, entries in raw_refs.items():
        enriched = []
        commit_seen = seen_per_commit.setdefault(hexsha, set())
        for name, kind in entries:
            if kind == "tag":
                enriched.append({"name": name, "local": False, "remote": False, "tag": True})
                continue
            if name == "HEAD" or name.startswith("HEAD -> "):
                continue
            if kind == "remote":
                if not name.startswith("origin/"):
                    continue  # skip non-origin remotes for now
                branch_name = name[7:]
                if branch_name == "HEAD":
                    continue
                if branch_name in commit_seen:
                    continue  # already handled by local ref at same commit
                commit_seen.add(branch_name)
                local_at_same = local_branch_hash.get(branch_name) == hexsha
                enriched.append({
                    "name": branch_name,
                    "local": local_at_same,
                    "remote": True,
                })
            else:
                # Local branch
                if name in commit_seen:
                    continue
                commit_seen.add(name)
                remote_at_same = remote_branch_hash.get(name) == hexsha
                enriched.append({
                    "name": name,
                    "local": True,
                    "remote": remote_at_same,
                })
        if enriched:
            ref_map.setdefault(hexsha, []).extend(enriched)

    # HEAD info
    head_hash = repo.head.commit.hexsha
    head_branch = None
    if not repo.head.is_detached:
        try:
            head_branch = repo.active_branch.name
        except TypeError:
            pass

    # Determine unpushed commits for the current branch
    unpushed_set: set[str] = set()
    if head_branch and not repo.head.is_detached:
        try:
            tracking = repo.active_branch.tracking_branch()
            if tracking:
                tracking_ref = tracking.name
            else:
                # Try origin/<branch> as fallback
                tracking_ref = f"origin/{head_branch}"
                try:
                    repo.git.rev_parse("--verify", tracking_ref)
                except GitCommandError:
                    tracking_ref = None

            if tracking_ref:
                unpushed_hashes = repo.git.rev_list(f"{tracking_ref}..{head_branch}").strip()
                if unpushed_hashes:
                    unpushed_set = set(unpushed_hashes.splitlines())
            else:
                # No remote tracking at all — treat all commits as unpushed
                all_hashes = repo.git.rev_list(head_branch).strip()
                if all_hashes:
                    unpushed_set = set(all_hashes.splitlines())
        except GitCommandError:
            pass

    # Collect commits (--all walks all refs, not just HEAD)
    commits = []
    for commit in repo.iter_commits(rev="--all", max_count=limit, topo_order=True):
        email = commit.author.email or ""
        commits.append({
            "hash": commit.hexsha,
            "shortHash": commit.hexsha[:7],
            "message": commit.summary,
            "author": commit.author.name,
            "authorEmail": email,
            "authorGravatar": gravatar_url(email) if email else None,
            "relativeDate": commit.committed_datetime.isoformat(),
            "parents": [p.hexsha for p in commit.parents],
            "refs": ref_map.get(commit.hexsha, []),
            "pushed": commit.hexsha not in unpushed_set,
        })

    # Branch list
    branches = []
    for branch in repo.branches:
        branches.append({
            "name": branch.name,
            "hash": branch.commit.hexsha,
            "current": not repo.head.is_detached and branch.name == head_branch,
        })

    # Working directory changes (for WIP node)
    working_changes = None
    if repo.is_dirty(untracked_files=True):
        status = get_porcelain_status(cwd)
        working_changes = {
            "files": len(status),
            "staged": sum(1 for f in status if f["status"] in ("added", "modified", "renamed", "deleted")),
            "unstaged": sum(1 for f in status if f["status"] in ("untracked",)),
        }

    return {
        "commits": commits,
        "branches": branches,
        "head": {"hash": head_hash, "branch": head_branch},
        "workingChanges": working_changes,
    }


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

    commits = []
    for commit in repo.iter_commits(max_count=limit):
        commits.append(
            {
                "hash": commit.hexsha,
                "shortHash": commit.hexsha[:7],
                "message": commit.summary,
                "author": commit.author.name,
                "relativeDate": commit.committed_datetime.isoformat(),
            }
        )

    return commits


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
            diff_text = repo.git.diff(f"{commit_hash}^..{commit_hash}")
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
            files.append({
                "path": f.path,
                "diff": f.diff,
                "oldContent": old_content,
                "newContent": new_content,
            })
        stats = parsed_stats

    return {
        **commit_info,
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


def git_stash_pop(cwd: Path) -> dict:
    """
    Pop the most recent stash.

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

        repo.git.stash("pop")
        return {
            "status": "popped",
            "message": "Stash popped",
        }
    except GitCommandError as e:
        error_msg = str(e)
        if "conflict" in error_msg.lower():
            return {"error": "Stash pop had conflicts. Resolve them manually."}
        return {"error": f"git stash pop failed: {e}"}


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
    local_branches = []
    for branch in repo.branches:
        local_branches.append(
            {
                "name": branch.name,
                "current": branch.name == current_branch,
            }
        )

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
            "message": f"Switched to branch '{current_branch}'" + (f" and reset to {reset_to[:7]}" if reset_to else ""),
        }
    except GitCommandError as e:
        return {"error": str(e)}


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


def get_remote_status(cwd: Path, fetch: bool = True) -> dict:
    """
    Get ahead/behind status relative to remote tracking branch.

    Args:
        cwd: Repository working directory
        fetch: Whether to fetch from remote first (default True)

    Returns:
        Dict with ahead, behind counts, branch info, and any errors
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    # Check for detached HEAD
    if repo.head.is_detached:
        return {"error": "HEAD is detached", "ahead": 0, "behind": 0}

    branch = repo.active_branch
    tracking = branch.tracking_branch()

    if not tracking:
        # No tracking branch - check if origin exists
        try:
            remote = repo.remote("origin")
            remote_ref = f"origin/{branch.name}"
            # Check if remote branch exists
            try:
                repo.git.rev_parse("--verify", remote_ref)
            except GitCommandError:
                return {
                    "branch": branch.name,
                    "remote": "origin",
                    "ahead": 0,
                    "behind": 0,
                    "noTracking": True,
                    "noRemoteBranch": True,
                }
        except ValueError:
            return {"error": "No remote configured", "ahead": 0, "behind": 0}

        tracking_ref = remote_ref
        remote_name = "origin"
    else:
        tracking_ref = tracking.name
        remote_name = tracking.remote_name

    # Fetch from remote if requested
    if fetch:
        try:
            remote = repo.remote(remote_name)
            remote.fetch()
        except GitCommandError:
            # Fetch failed, continue with stale data
            pass

    # Count commits ahead/behind
    try:
        # Commits in local but not in remote (ahead)
        ahead = int(repo.git.rev_list("--count", f"{tracking_ref}..{branch.name}"))
        # Commits in remote but not in local (behind)
        behind = int(repo.git.rev_list("--count", f"{branch.name}..{tracking_ref}"))
    except GitCommandError:
        ahead = 0
        behind = 0

    return {
        "branch": branch.name,
        "remote": remote_name,
        "tracking": tracking_ref,
        "ahead": ahead,
        "behind": behind,
    }


def git_push(cwd: Path) -> dict:
    """
    Push commits to the remote repository.

    Returns:
        Dict with status, remote, branch, and message on success, or error on failure
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    # Check for detached HEAD
    if repo.head.is_detached:
        return {"error": "Cannot push: HEAD is detached"}

    branch = repo.active_branch

    # Check for tracking branch
    tracking = branch.tracking_branch()
    if tracking:
        remote_name = tracking.remote_name
    else:
        # Default to origin if no tracking branch
        try:
            remote_name = "origin"
            repo.remote(remote_name)
        except ValueError:
            return {"error": "No remote configured"}

    try:
        remote = repo.remote(remote_name)
        push_info = remote.push(branch.name)

        # Check push result
        for info in push_info:
            if info.flags & info.ERROR:
                return {"error": f"Push failed: {info.summary}"}
            if info.flags & info.REJECTED:
                return {"error": "Push rejected: non-fast-forward update. Pull first."}
            if info.flags & info.REMOTE_REJECTED:
                return {"error": f"Push rejected by remote: {info.summary}"}

        return {
            "status": "pushed",
            "remote": remote_name,
            "branch": branch.name,
            "message": f"Pushed {branch.name} to {remote_name}",
        }
    except GitCommandError as e:
        error_msg = str(e)
        if "Could not read from remote repository" in error_msg:
            return {"error": "Push failed: Could not connect to remote repository"}
        if "Authentication failed" in error_msg or "Permission denied" in error_msg:
            return {"error": "Push failed: Authentication error"}
        return {"error": f"Push failed: {e}"}


def git_pull_rebase(cwd: Path) -> dict:
    """
    Pull changes from remote with rebase.
    If conflicts occur, aborts the rebase and returns an error.

    Returns:
        Dict with status on success, or error on failure
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    # Check for detached HEAD
    if repo.head.is_detached:
        return {"error": "Cannot pull: HEAD is detached"}

    branch = repo.active_branch

    # Check for tracking branch
    tracking = branch.tracking_branch()
    if tracking:
        remote_name = tracking.remote_name
    else:
        # Default to origin if no tracking branch
        try:
            remote_name = "origin"
            repo.remote(remote_name)
        except ValueError:
            return {"error": "No remote configured"}

    # Check if working directory is dirty and stash if needed
    stashed = False
    if repo.is_dirty(untracked_files=True):
        try:
            repo.git.stash("push", "-u", "-m", "lumbergh-auto-stash")
            stashed = True
        except GitCommandError as e:
            return {"error": f"Failed to stash changes: {e}"}

    # Attempt pull with rebase
    try:
        repo.git.pull("--rebase")
    except GitCommandError as e:
        error_msg = str(e)
        # Check for rebase conflicts
        if "conflict" in error_msg.lower() or "could not apply" in error_msg.lower():
            # Abort the rebase
            try:
                repo.git.rebase("--abort")
            except GitCommandError:
                pass  # Best effort to abort

            # Restore stash if we stashed
            if stashed:
                try:
                    repo.git.stash("pop")
                except GitCommandError:
                    pass  # Best effort to restore

            return {"error": "Rebase conflicts detected. Aborting rebase and restoring state."}

        # Other errors (network, auth, etc.)
        if stashed:
            try:
                repo.git.stash("pop")
            except GitCommandError:
                pass

        if "Could not read from remote repository" in error_msg:
            return {"error": "Pull failed: Could not connect to remote repository"}
        if "Authentication failed" in error_msg or "Permission denied" in error_msg:
            return {"error": "Pull failed: Authentication error"}
        return {"error": f"Pull failed: {e}"}

    # Pull succeeded - restore stash if we stashed
    stash_conflict = False
    if stashed:
        try:
            repo.git.stash("pop")
        except GitCommandError:
            stash_conflict = True

    if stash_conflict:
        return {
            "status": "pulled",
            "stashConflict": True,
            "message": "Pulled successfully but stash pop had conflicts. Resolve manually with 'git stash pop'.",
        }

    return {
        "status": "pulled",
        "stashed": stashed,
        "message": f"Pulled and rebased {branch.name} from {remote_name}",
    }


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

    worktrees = []
    try:
        # Parse `git worktree list --porcelain` output
        output = repo.git.worktree("list", "--porcelain")
        current_worktree: dict[str, str] = {}

        for line in output.split("\n"):
            if line.startswith("worktree "):
                current_worktree["path"] = line[9:]
            elif line.startswith("HEAD "):
                current_worktree["commit"] = line[5:]
            elif line.startswith("branch "):
                # refs/heads/branch-name → branch-name
                branch_ref = line[7:]
                if branch_ref.startswith("refs/heads/"):
                    current_worktree["branch"] = branch_ref[11:]
                else:
                    current_worktree["branch"] = branch_ref
            elif line == "":
                if current_worktree.get("path"):
                    worktrees.append(
                        WorktreeInfo(
                            path=current_worktree.get("path", ""),
                            branch=current_worktree.get("branch", "HEAD"),
                            commit=current_worktree.get("commit", "")[:7],
                            is_main=current_worktree.get("path") == str(repo_path),
                        )
                    )
                current_worktree = {}

        # Don't forget the last entry
        if current_worktree.get("path"):
            worktrees.append(
                WorktreeInfo(
                    path=current_worktree.get("path", ""),
                    branch=current_worktree.get("branch", "HEAD"),
                    commit=current_worktree.get("commit", "")[:7],
                    is_main=current_worktree.get("path") == str(repo_path),
                )
            )
    except GitCommandError:
        pass

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
        if create_branch:
            # Create new branch and worktree
            if base_branch:
                repo.git.worktree("add", "-b", branch, str(worktree_path), base_branch)
            else:
                repo.git.worktree("add", "-b", branch, str(worktree_path))
        else:
            # Use existing branch
            repo.git.worktree("add", str(worktree_path), branch)

        return {"path": str(worktree_path)}
    except GitCommandError as e:
        error_str = str(e)
        if "already exists" in error_str:
            return {"error": f"Branch '{branch}' already exists"}
        if "is not a valid branch name" in error_str:
            return {"error": f"Invalid branch name: {branch}"}
        return {"error": f"Failed to create worktree: {e}"}


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
    except InvalidGitRepositoryError:
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
            repo.git.branch(branch_name, start_point)
        else:
            repo.git.branch(branch_name)

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


def reword_commit(cwd: Path, commit_hash: str, message: str) -> dict:
    """
    Reword (edit the message of) a commit.

    For HEAD: uses `git commit --amend -m <message>` (no staging changes).
    For non-HEAD: uses `git rebase` with GIT_SEQUENCE_EDITOR to automate the reword.

    Guards:
    - Rejects if working tree is dirty (for non-HEAD commits)
    - Rejects if commit is not an ancestor of HEAD on the current branch

    Returns:
        Dict with status, hash, message on success, or error on failure
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"error": "Not a git repository"}

    if not repo.head.is_valid():
        return {"error": "No commits to reword"}

    if repo.head.is_detached:
        return {"error": "Cannot reword: HEAD is detached"}

    # Resolve the commit
    try:
        target = repo.commit(commit_hash)
    except Exception:
        return {"error": f"Commit not found: {commit_hash}"}

    head_commit = repo.head.commit

    # Check if this is HEAD
    is_head = target.hexsha == head_commit.hexsha

    if is_head:
        # Simple amend — only change the message, don't stage anything
        try:
            repo.git.commit("--amend", "--only", "-m", message)
            return {
                "status": "reworded",
                "hash": repo.head.commit.hexsha[:7],
                "message": message,
            }
        except GitCommandError as e:
            return {"error": f"Amend failed: {e}"}

    # Non-HEAD: require clean working tree
    if repo.is_dirty(untracked_files=True):
        return {"error": "Working tree is dirty. Commit or stash changes before rewording non-HEAD commits."}

    # Verify commit is an ancestor of HEAD
    try:
        repo.git.merge_base("--is-ancestor", commit_hash, "HEAD")
    except GitCommandError:
        return {"error": "Commit is not an ancestor of HEAD on the current branch"}

    # Use rebase with automated editors
    # GIT_SEQUENCE_EDITOR: replaces "pick <hash>" with "reword <hash>"
    # GIT_EDITOR: writes the new message to the file git provides
    short = target.hexsha[:7]
    seq_editor_script = f"sed -i 's/^pick {short}/reword {short}/' \"$1\""

    # Write new message to a temp file, then use a script that copies it
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, prefix='lumbergh-reword-') as f:
            f.write(message)
            msg_file = f.name

        editor_script = f'cp {msg_file} "$1"'

        env = {
            "GIT_SEQUENCE_EDITOR": seq_editor_script,
            "GIT_EDITOR": f'sh -c \'{editor_script}\'',
        }

        # Run rebase interactively on the parent of the target commit
        parent_ref = f"{commit_hash}^"
        result = subprocess.run(
            ["git", "rebase", "-i", parent_ref],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            env={**os.environ, **env},
            timeout=30,
        )

        # Clean up temp file
        Path(msg_file).unlink(missing_ok=True)

        if result.returncode != 0:
            # Try to abort rebase if it failed
            subprocess.run(
                ["git", "rebase", "--abort"],
                cwd=str(cwd),
                capture_output=True,
                timeout=10,
            )
            return {"error": f"Rebase failed: {result.stderr.strip()}"}

        # Refresh repo state
        new_head = repo.head.commit
        return {
            "status": "reworded",
            "hash": new_head.hexsha[:7],
            "message": message,
        }
    except subprocess.TimeoutExpired:
        subprocess.run(
            ["git", "rebase", "--abort"],
            cwd=str(cwd),
            capture_output=True,
            timeout=10,
        )
        return {"error": "Rebase timed out"}
    except Exception as e:
        return {"error": f"Reword failed: {e}"}


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

    branches = []
    for branch in repo.branches:
        branches.append({
            "name": branch.name,
            "available": branch.name not in used_branches,
            "inWorktree": branch.name in used_branches,
            "current": branch.name == current_branch,
        })

    return {
        "branches": branches,
        "current": current_branch,
    }
