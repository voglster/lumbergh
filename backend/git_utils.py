"""
Git utilities for the Lumbergh backend using GitPython.
"""

from dataclasses import dataclass
from pathlib import Path

from git import InvalidGitRepositoryError, Repo
from git.exc import GitCommandError


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


def get_full_diff_with_untracked(cwd: Path) -> dict:
    """
    Get git diff for all changed files, including untracked files.

    Returns:
        Dict with 'files' (list of file diffs) and 'stats' (additions/deletions)
    """
    try:
        repo = get_repo(cwd)
    except InvalidGitRepositoryError:
        return {"files": [], "stats": {"additions": 0, "deletions": 0}}

    files = []
    total_stats = DiffStats()

    # Get diff of working tree against HEAD
    if repo.head.is_valid():
        try:
            diff_text = repo.git.diff("HEAD")
            if diff_text:
                parsed_files, stats = parse_diff_output(diff_text)
                files.extend({"path": f.path, "diff": f.diff} for f in parsed_files)
                total_stats.additions += stats.additions
                total_stats.deletions += stats.deletions
        except GitCommandError:
            pass

    # Add untracked files
    workdir = Path(repo.working_dir)
    for untracked_path in repo.untracked_files:
        file_diff, stats = generate_untracked_file_diff(workdir, untracked_path)
        if file_diff:
            files.append({"path": file_diff.path, "diff": file_diff.diff})
            total_stats.additions += stats.additions

    return {
        "files": files,
        "stats": {"additions": total_stats.additions, "deletions": total_stats.deletions},
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
                "relativeDate": commit.committed_datetime.strftime("%Y-%m-%d %H:%M"),
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
            "relativeDate": commit.committed_datetime.strftime("%Y-%m-%d %H:%M"),
        }
    except Exception:
        return None


def get_commit_diff(cwd: Path, commit_hash: str) -> dict | None:
    """
    Get diff for a specific commit.

    Returns:
        Dict with commit info, files, and stats, or None if commit not found
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
        "relativeDate": commit.committed_datetime.strftime("%Y-%m-%d %H:%M"),
    }

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
        files = [{"path": f.path, "diff": f.diff} for f in parsed_files]
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


def checkout_branch(cwd: Path, branch: str) -> dict:
    """
    Checkout a branch if the working directory is clean.

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
        current_branch = get_current_branch(cwd)
        return {
            "status": "success",
            "branch": current_branch,
            "message": f"Switched to branch '{current_branch}'",
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
