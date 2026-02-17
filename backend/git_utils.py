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
        "relativeDate": commit.committed_datetime.strftime("%Y-%m-%d %H:%M"),
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
