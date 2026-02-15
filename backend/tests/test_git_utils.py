"""
Tests for git_utils module.
"""

from git_utils import (
    generate_untracked_file_diff,
    get_branches,
    get_commit_diff,
    get_commit_log,
    get_current_branch,
    get_full_diff_with_untracked,
    get_porcelain_status,
    parse_diff_output,
    stage_all_and_commit,
)


class TestGetCurrentBranch:
    def test_returns_branch_name(self, mock_git_repo):
        branch = get_current_branch(mock_git_repo)
        # Default branch could be 'main' or 'master' depending on git config
        assert branch in ("main", "master")


class TestGetPorcelainStatus:
    def test_clean_repo(self, mock_git_repo):
        files = get_porcelain_status(mock_git_repo)
        assert files == []

    def test_with_changes(self, mock_git_repo_with_changes):
        files = get_porcelain_status(mock_git_repo_with_changes)
        assert len(files) == 2

        paths = {f["path"] for f in files}
        assert "README.md" in paths
        assert "new_file.txt" in paths

        statuses = {f["status"] for f in files}
        assert "modified" in statuses
        assert "untracked" in statuses


class TestParseDiffOutput:
    def test_single_file_diff(self):
        diff_text = """diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line1
+added line
 line2
-removed line
 line3"""

        files, stats = parse_diff_output(diff_text)

        assert len(files) == 1
        assert files[0].path == "file.txt"
        assert stats.additions == 1
        assert stats.deletions == 1

    def test_multiple_files(self):
        diff_text = """diff --git a/file1.txt b/file1.txt
--- a/file1.txt
+++ b/file1.txt
@@ -1 +1,2 @@
 original
+added
diff --git a/file2.txt b/file2.txt
--- a/file2.txt
+++ b/file2.txt
@@ -1 +1,3 @@
 original
+added1
+added2"""

        files, stats = parse_diff_output(diff_text)

        assert len(files) == 2
        assert files[0].path == "file1.txt"
        assert files[1].path == "file2.txt"
        assert stats.additions == 3
        assert stats.deletions == 0

    def test_empty_diff(self):
        files, stats = parse_diff_output("")
        assert files == []
        assert stats.additions == 0
        assert stats.deletions == 0


class TestGenerateUntrackedFileDiff:
    def test_generates_diff_for_new_file(self, temp_dir):
        test_file = temp_dir / "new_file.txt"
        test_file.write_text("line1\nline2\nline3")

        file_diff, stats = generate_untracked_file_diff(temp_dir, "new_file.txt")

        assert file_diff is not None
        assert file_diff.path == "new_file.txt"
        assert "+line1" in file_diff.diff
        assert stats.additions == 3

    def test_nonexistent_file(self, temp_dir):
        file_diff, stats = generate_untracked_file_diff(temp_dir, "nonexistent.txt")
        assert file_diff is None
        assert stats.additions == 0


class TestGetFullDiffWithUntracked:
    def test_includes_tracked_and_untracked(self, mock_git_repo_with_changes):
        result = get_full_diff_with_untracked(mock_git_repo_with_changes)

        assert "files" in result
        assert "stats" in result
        assert len(result["files"]) == 2

        paths = {f["path"] for f in result["files"]}
        assert "README.md" in paths
        assert "new_file.txt" in paths


class TestGetCommitLog:
    def test_returns_commits(self, mock_git_repo):
        commits = get_commit_log(mock_git_repo, limit=10)

        assert len(commits) == 1
        assert commits[0]["message"] == "Initial commit"
        assert "hash" in commits[0]
        assert "shortHash" in commits[0]


class TestGetCommitDiff:
    def test_returns_commit_details(self, mock_git_repo):
        # Get the commit hash
        commits = get_commit_log(mock_git_repo, limit=1)
        commit_hash = commits[0]["hash"]

        result = get_commit_diff(mock_git_repo, commit_hash)

        assert result is not None
        assert result["message"] == "Initial commit"
        assert "files" in result
        assert "stats" in result

    def test_nonexistent_commit(self, mock_git_repo):
        result = get_commit_diff(mock_git_repo, "nonexistent123")
        assert result is None


class TestStageAllAndCommit:
    def test_commits_changes(self, mock_git_repo_with_changes):
        result = stage_all_and_commit(mock_git_repo_with_changes, "Test commit")

        assert result["status"] == "committed"
        assert result["message"] == "Test commit"
        assert "hash" in result

        # Verify repo is now clean
        files = get_porcelain_status(mock_git_repo_with_changes)
        assert files == []

    def test_nothing_to_commit(self, mock_git_repo):
        result = stage_all_and_commit(mock_git_repo, "Empty commit")
        assert result["status"] == "nothing_to_commit"


class TestGetBranches:
    def test_returns_branches(self, mock_git_repo):
        result = get_branches(mock_git_repo)

        assert "current" in result
        assert "local" in result
        assert "remote" in result
        assert "clean" in result

        assert result["clean"] is True
        assert len(result["local"]) >= 1
