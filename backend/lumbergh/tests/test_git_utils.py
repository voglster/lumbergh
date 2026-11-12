"""
Tests for git_utils module.
"""

import subprocess

from lumbergh.git_utils import (
    _build_raw_refs,
    _classify_ref,
    _enrich_ref_entry,
    checkout_branch,
    generate_untracked_file_diff,
    get_branches,
    get_commit_diff,
    get_commit_log,
    get_current_branch,
    get_full_diff_with_untracked,
    get_porcelain_status,
    get_range_diff,
    parse_diff_output,
    search_commits,
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

    def test_modified_binary_is_listed_without_its_bytes(self, mock_git_repo):
        image = mock_git_repo / "sprite.webp"
        image.write_bytes(b"RIFF\x00\x00WEBP" + bytes(range(256)) * 100)
        subprocess.run(["git", "add", "-A"], cwd=mock_git_repo, check=True)
        subprocess.run(["git", "commit", "-qm", "sprite"], cwd=mock_git_repo, check=True)
        image.write_bytes(b"RIFF\x00\x01WEBP" + bytes(range(255, -1, -1)) * 100)

        [entry] = get_full_diff_with_untracked(mock_git_repo)["files"]

        assert entry["path"] == "sprite.webp"
        assert entry["oldContent"] is None
        assert entry["newContent"] is None

    def test_untracked_binary_is_listed_without_its_bytes(self, mock_git_repo):
        (mock_git_repo / "frame.png").write_bytes(
            b"\x89PNG\r\n\x1a\n\x00" + bytes(range(256)) * 100
        )

        [entry] = get_full_diff_with_untracked(mock_git_repo)["files"]

        assert entry["path"] == "frame.png"
        assert entry["newContent"] is None
        assert "Binary files" in entry["diff"]
        assert len(entry["diff"]) < 200

    def test_embedded_contents_stop_at_the_payload_budget(self, mock_git_repo, monkeypatch):
        monkeypatch.setattr("lumbergh.git_utils.MAX_DIFF_CONTENT_BYTES", 2_500)
        for i in range(5):
            (mock_git_repo / f"notes{i}.txt").write_text("x" * 1_000)

        files = get_full_diff_with_untracked(mock_git_repo)["files"]

        assert len(files) == 5
        embedded = sum(len(f["newContent"] or "") + len(f["diff"]) for f in files)
        assert embedded <= 2_500 + 1_100


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

    def test_binary_change_is_listed_without_its_bytes(self, mock_git_repo):
        image = mock_git_repo / "sprite.webp"
        image.write_bytes(b"RIFF\x00\x00WEBP" + bytes(range(256)) * 100)
        subprocess.run(["git", "add", "-A"], cwd=mock_git_repo, check=True)
        subprocess.run(["git", "commit", "-qm", "sprite"], cwd=mock_git_repo, check=True)
        image.write_bytes(b"RIFF\x00\x01WEBP" + bytes(range(255, -1, -1)) * 100)
        subprocess.run(["git", "commit", "-qam", "redraw"], cwd=mock_git_repo, check=True)
        head = get_commit_log(mock_git_repo, limit=1)[0]["hash"]

        [entry] = get_commit_diff(mock_git_repo, head)["files"]

        assert entry["path"] == "sprite.webp"
        assert entry["oldContent"] is None
        assert entry["newContent"] is None


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


class TestClassifyRef:
    def test_local_branch(self):
        assert _classify_ref("refs/heads/main") == ("main", "local")

    def test_remote_branch(self):
        assert _classify_ref("refs/remotes/origin/main") == ("origin/main", "remote")

    def test_tag_with_prefix(self):
        assert _classify_ref("refs/tags/v1.0.0") == ("v1.0.0", "tag")

    def test_origin_shorthand(self):
        assert _classify_ref("origin/feature") == ("origin/feature", "remote")

    def test_bare_name_defaults_to_local(self):
        assert _classify_ref("main") == ("main", "local")


class TestBuildRawRefs:
    def test_tags_classified_as_tag(self, mock_git_repo):
        import subprocess

        subprocess.run(
            ["git", "tag", "v1.0.0"],
            cwd=mock_git_repo,
            capture_output=True,
        )
        from git import Repo

        repo = Repo(mock_git_repo)
        raw = _build_raw_refs(repo)

        tag_entries = [
            (name, kind) for entries in raw.values() for name, kind in entries if name == "v1.0.0"
        ]
        assert len(tag_entries) == 1
        assert tag_entries[0] == ("v1.0.0", "tag")

    def test_branches_not_classified_as_tag(self, mock_git_repo):
        from git import Repo

        repo = Repo(mock_git_repo)
        raw = _build_raw_refs(repo)

        for entries in raw.values():
            for name, kind in entries:
                if kind == "local":
                    assert name != ""


class TestEnrichRefEntry:
    def test_tag_entry(self):
        result = _enrich_ref_entry("v1.0.0", "tag", "abc123", set(), {}, {})
        assert result == {"name": "v1.0.0", "local": False, "remote": False, "tag": True}

    def test_head_skipped(self):
        result = _enrich_ref_entry("HEAD", "local", "abc123", set(), {}, {})
        assert result is None


class TestDiffPrefixConfiguration:
    """Paths must survive whatever prefix style the user's git config asks for.

    `diff.mnemonicPrefix` renders headers as `diff --git c/README.md w/README.md`
    and `diff.noprefix` drops the prefixes altogether, so a parser that looks for
    a literal " b/" reports every tracked file as "unknown".
    """

    @staticmethod
    def _tracked_paths(repo_path):
        result = get_full_diff_with_untracked(repo_path)
        return {f["path"] for f in result["files"]}

    def test_reads_paths_under_mnemonic_prefixes(self, mock_git_repo_with_changes):
        subprocess.run(
            ["git", "config", "diff.mnemonicPrefix", "true"],
            cwd=mock_git_repo_with_changes,
            capture_output=True,
        )

        assert "README.md" in self._tracked_paths(mock_git_repo_with_changes)

    def test_reads_paths_under_noprefix(self, mock_git_repo_with_changes):
        subprocess.run(
            ["git", "config", "diff.noprefix", "true"],
            cwd=mock_git_repo_with_changes,
            capture_output=True,
        )

        assert "README.md" in self._tracked_paths(mock_git_repo_with_changes)

    def test_reads_paths_under_default_prefixes(self, mock_git_repo_with_changes):
        subprocess.run(
            ["git", "config", "diff.mnemonicPrefix", "false"],
            cwd=mock_git_repo_with_changes,
            capture_output=True,
        )

        assert "README.md" in self._tracked_paths(mock_git_repo_with_changes)


class TestGetRangeDiff:
    @staticmethod
    def _commit(repo_path, name, body):
        (repo_path / name).write_text(body)
        subprocess.run(["git", "add", "."], cwd=repo_path, capture_output=True)
        subprocess.run(["git", "commit", "-m", f"add {name}"], cwd=repo_path, capture_output=True)
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=repo_path, capture_output=True, text=True
        ).stdout.strip()

    def test_accumulates_every_commit_after_the_base(self, mock_git_repo):
        base = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=mock_git_repo, capture_output=True, text=True
        ).stdout.strip()
        self._commit(mock_git_repo, "one.txt", "one\n")
        head = self._commit(mock_git_repo, "two.txt", "two\n")

        result = get_range_diff(mock_git_repo, base, head)

        assert {f["path"] for f in result["files"]} == {"one.txt", "two.txt"}
        assert result["range"]["commitCount"] == 2
        assert result["range"]["from"]["hash"] == base
        assert result["range"]["to"]["hash"] == head

    def test_binary_change_is_listed_without_its_bytes(self, mock_git_repo):
        base = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=mock_git_repo, capture_output=True, text=True
        ).stdout.strip()
        (mock_git_repo / "frame.png").write_bytes(b"\x89PNG\x00" + bytes(range(256)) * 100)
        subprocess.run(["git", "add", "-A"], cwd=mock_git_repo, check=True)
        subprocess.run(["git", "commit", "-qm", "frame"], cwd=mock_git_repo, check=True)
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=mock_git_repo, capture_output=True, text=True
        ).stdout.strip()

        [entry] = get_range_diff(mock_git_repo, base, head)["files"]

        assert entry["path"] == "frame.png"
        assert entry["newContent"] is None

    def test_orders_the_pair_by_ancestry_whichever_way_it_is_asked(self, mock_git_repo):
        base = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=mock_git_repo, capture_output=True, text=True
        ).stdout.strip()
        head = self._commit(mock_git_repo, "one.txt", "one\n")

        forward = get_range_diff(mock_git_repo, base, head)
        backward = get_range_diff(mock_git_repo, head, base)

        assert backward["files"] == forward["files"]
        assert backward["range"]["from"]["hash"] == base
        assert backward["stats"]["additions"] == forward["stats"]["additions"]

    def test_same_commit_twice_is_an_empty_diff(self, mock_git_repo):
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=mock_git_repo, capture_output=True, text=True
        ).stdout.strip()

        result = get_range_diff(mock_git_repo, head, head)

        assert result["files"] == []
        assert result["range"]["commitCount"] == 0

    def test_unknown_commit_is_not_found(self, mock_git_repo):
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=mock_git_repo, capture_output=True, text=True
        ).stdout.strip()

        assert get_range_diff(mock_git_repo, head, "deadbeef" * 5) is None

    def test_divergent_branches_diff_tip_to_tip(self, mock_git_repo):
        trunk = self._commit(mock_git_repo, "trunk.txt", "trunk\n")
        subprocess.run(["git", "checkout", "-b", "side"], cwd=mock_git_repo, capture_output=True)
        subprocess.run(["git", "reset", "--hard", "HEAD~1"], cwd=mock_git_repo, capture_output=True)
        side = self._commit(mock_git_repo, "side.txt", "side\n")

        result = get_range_diff(mock_git_repo, trunk, side)

        assert {f["path"] for f in result["files"]} == {"trunk.txt", "side.txt"}


class TestCheckoutBranchHeldByAWorktree:
    """A branch checked out in a worktree cannot be checked out again.

    git says so clearly, but GitPython's ``str(GitCommandError)`` wraps the
    message in the exit code and the command line, and that whole blob used to
    reach the user verbatim. The path is the useful part — it names which
    worktree to go look at — so it has to survive as a field, not be buried in
    prose.
    """

    def _repo_with_worktree(self, tmp_path):
        repo = tmp_path / "repo"
        repo.mkdir()
        run = lambda *a, **kw: subprocess.run(a, cwd=kw.pop("cwd", repo), capture_output=True)  # noqa: E731
        run("git", "init")
        run("git", "config", "user.email", "t@example.com")
        run("git", "config", "user.name", "T")
        run("git", "commit", "--allow-empty", "-m", "init")
        run("git", "branch", "feature")
        worktree = tmp_path / "wt"
        run("git", "worktree", "add", str(worktree), "feature")
        return repo, worktree

    def test_names_the_worktree_instead_of_the_command_line(self, temp_dir):
        repo, worktree = self._repo_with_worktree(temp_dir)

        result = checkout_branch(repo, "feature")

        assert "error" in result
        assert "exit code" not in result["error"]
        assert "cmdline" not in result["error"]
        assert "feature" in result["error"]
        assert result["worktree_path"] == str(worktree)

    def test_an_ordinary_failure_keeps_its_message_and_names_no_worktree(self, temp_dir):
        repo, _ = self._repo_with_worktree(temp_dir)

        result = checkout_branch(repo, "no-such-branch")

        assert "error" in result
        assert "exit code" not in result["error"]
        assert result.get("worktree_path") is None


class TestSearchCommitsBySha:
    """`--grep` searches commit messages, so it can never find a commit by its id.

    A sha is the one thing you can hold that is guaranteed not to appear in the
    text being searched, which made "All history" structurally unable to answer
    the most precise question a user can ask.
    """

    def _repo_with_history(self, tmp_path):
        repo = tmp_path / "repo"
        repo.mkdir()

        def run(*args):
            return subprocess.run(args, cwd=repo, capture_output=True, text=True)

        run("git", "init")
        run("git", "config", "user.email", "t@example.com")
        run("git", "config", "user.name", "T")
        hashes = []
        for i in range(3):
            run("git", "commit", "--allow-empty", "-m", f"commit number {i}")
            hashes.append(run("git", "rev-parse", "HEAD").stdout.strip())
        return repo, hashes

    def test_finds_a_commit_by_its_full_sha(self, temp_dir):
        repo, hashes = self._repo_with_history(temp_dir)

        found = search_commits(repo, hashes[0])

        assert [c["hash"] for c in found] == [hashes[0]]

    def test_finds_a_commit_by_its_short_sha(self, temp_dir):
        repo, hashes = self._repo_with_history(temp_dir)

        found = search_commits(repo, hashes[1][:7])

        assert [c["hash"] for c in found] == [hashes[1]]

    def test_a_sha_that_names_nothing_finds_nothing(self, temp_dir):
        repo, _ = self._repo_with_history(temp_dir)

        assert search_commits(repo, "abcdef1234567890") == []

    def test_a_message_search_still_works_and_is_not_swallowed(self, temp_dir):
        repo, _ = self._repo_with_history(temp_dir)

        assert len(search_commits(repo, "commit number")) == 3

    def test_a_hex_word_finds_both_the_commit_it_names_and_the_ones_mentioning_it(self, temp_dir):
        repo, hashes = self._repo_with_history(temp_dir)
        short = hashes[2][:8]
        subprocess.run(
            ["git", "commit", "--allow-empty", "-m", f"revert {short}"],
            cwd=repo,
            capture_output=True,
        )

        found = {c["hash"] for c in search_commits(repo, short)}

        assert hashes[2] in found
        assert len(found) == 2
