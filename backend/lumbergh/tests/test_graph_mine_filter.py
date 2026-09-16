"""The git graph's "just my work" filter.

On a shared repo the commit budget gets eaten by other people's branches, so
the filter narrows the graph to refs the operator has recently worked on, plus
the trunk that keeps the result readable.
"""

import os
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from lumbergh.git_identity import DEFAULT_LOOKBACK, Identity, resolve_identity
from lumbergh.git_utils import get_graph_log

ME = "me@example.com"
THEM = "them@example.com"


def _git(cwd: Path, *args: str, env: dict | None = None) -> str:
    result = subprocess.run(
        ["git", "-C", str(cwd), *args],
        check=True,
        capture_output=True,
        encoding="utf-8",
        env=env,
    )
    return result.stdout.strip()


def _commit(
    repo: Path,
    message: str,
    author: str = ME,
    committer: str | None = None,
    days_ago: int = 0,
) -> None:
    when = (datetime.now(UTC) - timedelta(days=days_ago)).isoformat()
    env = {
        **os.environ,
        "GIT_AUTHOR_EMAIL": author,
        "GIT_AUTHOR_NAME": "author",
        "GIT_COMMITTER_EMAIL": committer or author,
        "GIT_COMMITTER_NAME": "committer",
        "GIT_AUTHOR_DATE": when,
        "GIT_COMMITTER_DATE": when,
    }
    (repo / "f").write_text(message)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", message, env=env)


@pytest.fixture
def repo(tmp_path):
    """A repo on ``main`` with one commit, configured with my identity."""
    path = tmp_path / "repo"
    path.mkdir()
    _git(path, "init", "-q", "-b", "main")
    _git(path, "config", "user.email", ME)
    _git(path, "config", "user.name", "me")
    _commit(path, "init")
    return path


def _branch(repo: Path, name: str, commits: list[tuple[str, str]], days_ago: int = 0) -> None:
    """Create ``name`` off the current HEAD and commit ``(message, author)`` pairs."""
    _git(repo, "checkout", "-q", "-b", name)
    for message, author in commits:
        _commit(repo, message, author=author, days_ago=days_ago)
    _git(repo, "checkout", "-q", "main")


def _branches_in_graph(graph: dict) -> set[str]:
    return {ref["name"] for commit in graph["commits"] for ref in commit["refs"]}


def _messages(graph: dict) -> set[str]:
    return {commit["message"] for commit in graph["commits"]}


class TestIdentity:
    def test_resolves_repo_git_config(self, repo):
        assert resolve_identity(repo).emails == frozenset({ME})

    def test_folds_in_extra_emails_case_insensitively(self, repo):
        identity = resolve_identity(repo, extra_emails=["Other@Example.COM"])

        assert identity.emails == frozenset({ME, "other@example.com"})

    def test_is_falsy_without_any_email(self, tmp_path, monkeypatch):
        monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
        monkeypatch.setenv("GIT_CONFIG_SYSTEM", os.devnull)
        anonymous = tmp_path / "anonymous"
        anonymous.mkdir()
        _git(anonymous, "init", "-q")

        assert not resolve_identity(anonymous, extra_emails=[])


class TestMineFilter:
    def test_unfiltered_graph_shows_everyones_branches(self, repo):
        _branch(repo, "theirs", [("their work", THEM)])

        graph = get_graph_log(repo, identity=resolve_identity(repo), mine_only=False)

        assert "theirs" in _branches_in_graph(graph)
        assert graph["mine"] == {"available": True, "active": False}

    def test_drops_branches_that_are_not_mine(self, repo):
        _branch(repo, "mine", [("my work", ME)])
        _branch(repo, "theirs", [("their work", THEM)])

        graph = get_graph_log(repo, identity=resolve_identity(repo), mine_only=True)

        assert "mine" in _branches_in_graph(graph)
        assert "their work" not in _messages(graph)
        assert graph["mine"] == {"available": True, "active": True}

    def test_keeps_trunk_even_when_it_is_not_mine(self, repo):
        _commit(repo, "their trunk commit", author=THEM)
        _branch(repo, "mine", [("my work", ME)])

        graph = get_graph_log(repo, identity=resolve_identity(repo), mine_only=True)

        assert "their trunk commit" in _messages(graph)

    def test_branch_stays_mine_when_someone_commits_on_top(self, repo):
        _branch(repo, "mine", [("my work", ME), ("their small fix", THEM)])

        graph = get_graph_log(repo, identity=resolve_identity(repo), mine_only=True)

        assert "mine" in _branches_in_graph(graph)

    def test_branch_is_not_mine_once_my_commit_falls_outside_lookback(self, repo):
        theirs = [(f"theirs {n}", THEM) for n in range(DEFAULT_LOOKBACK)]
        _branch(repo, "stale", [("my old work", ME), *theirs])

        graph = get_graph_log(repo, identity=resolve_identity(repo), mine_only=True)

        assert "stale" not in _branches_in_graph(graph)

    def test_committer_identity_counts_not_only_author(self, repo):
        _branch(
            repo,
            "rebased",
            [
                (
                    "their patch, my rebase",
                    THEM,
                )
            ],
        )
        _git(repo, "checkout", "-q", "rebased")
        _commit(repo, "amended", author=THEM, committer=ME)
        _git(repo, "checkout", "-q", "main")

        graph = get_graph_log(repo, identity=resolve_identity(repo), mine_only=True)

        assert "rebased" in _branches_in_graph(graph)

    def test_extra_emails_make_a_branch_mine(self, repo):
        _branch(repo, "alt", [("work under my other address", THEM)])

        identity = resolve_identity(repo, extra_emails=[THEM])
        graph = get_graph_log(repo, identity=identity, mine_only=True)

        assert "alt" in _branches_in_graph(graph)

    def test_worktree_branch_is_always_kept(self, repo, tmp_path):
        wt = tmp_path / "wt"
        _git(repo, "worktree", "add", "-q", "-b", "theirs-wt", str(wt))
        _commit(wt, "their worktree commit", author=THEM)

        graph = get_graph_log(repo, identity=resolve_identity(repo), mine_only=True)

        assert "theirs-wt" in _branches_in_graph(graph)

    def test_without_identity_nothing_is_filtered(self, repo):
        _branch(repo, "theirs", [("their work", THEM)])

        graph = get_graph_log(repo, identity=Identity(frozenset()), mine_only=True)

        assert "theirs" in _branches_in_graph(graph)
        assert graph["mine"] == {"available": False, "active": False}

    def test_abandoned_branches_drop_out_even_though_they_are_mine(self, repo):
        """A year-old branch is history, not work in progress."""
        _branch(repo, "abandoned", [("my ancient work", ME)], days_ago=400)
        _branch(repo, "current", [("my recent work", ME)])

        graph = get_graph_log(repo, identity=resolve_identity(repo), mine_only=True)

        assert "current" in _branches_in_graph(graph)
        assert "abandoned" not in _branches_in_graph(graph)

    def test_age_cutoff_is_configurable(self, repo):
        _branch(repo, "middling", [("work from a while back", ME)], days_ago=120)

        identity = resolve_identity(repo, max_age_days=365)
        graph = get_graph_log(repo, identity=identity, mine_only=True)

        assert "middling" in _branches_in_graph(graph)

    def test_age_cutoff_can_be_disabled(self, repo):
        _branch(repo, "abandoned", [("my ancient work", ME)], days_ago=400)

        identity = resolve_identity(repo, max_age_days=0)
        graph = get_graph_log(repo, identity=identity, mine_only=True)

        assert "abandoned" in _branches_in_graph(graph)

    def test_current_branch_survives_the_age_cutoff(self, repo):
        """You are standing in it, so it stays however old it is."""
        _branch(repo, "ancient-but-checked-out", [("my ancient work", ME)], days_ago=400)
        _git(repo, "checkout", "-q", "ancient-but-checked-out")

        graph = get_graph_log(repo, identity=resolve_identity(repo), mine_only=True)

        assert "ancient-but-checked-out" in _branches_in_graph(graph)

    def test_branches_payload_stays_unfiltered(self, repo):
        """BranchSelector still has to offer other people's branches to check out."""
        _branch(repo, "theirs", [("their work", THEM)])

        graph = get_graph_log(repo, identity=resolve_identity(repo), mine_only=True)

        assert "theirs" in {b["name"] for b in graph["branches"]}


class TestRefsOutsideHeadsAndRemotes:
    """`git filter-branch` leaves `refs/original/refs/heads/<name>` behind.

    GitPython shortens that ref to `refs/heads/<name>`, which reads like a
    branch but resolves to nothing once the real branch is gone — and an
    unresolvable name in the rev-list argv takes the whole graph down.
    """

    def _leave_a_backup_ref(self, repo, name):
        _git(repo, "update-ref", f"refs/original/refs/heads/{name}", _git(repo, "rev-parse", name))

    def test_graph_survives_a_filter_branch_backup_ref(self, repo):
        _branch(repo, "rewritten", [("my work", ME)])
        self._leave_a_backup_ref(repo, "rewritten")
        get_graph_log(repo, identity=resolve_identity(repo), mine_only=True)
        _git(repo, "branch", "-qD", "rewritten")
        _branch(repo, "live", [("my live work", ME)])

        graph = get_graph_log(repo, identity=resolve_identity(repo), mine_only=True)

        assert "my live work" in _messages(graph)

    def test_backup_ref_is_not_labelled_as_a_branch(self, repo):
        _branch(repo, "rewritten", [("my work", ME)])
        self._leave_a_backup_ref(repo, "rewritten")

        graph = get_graph_log(repo, identity=resolve_identity(repo), mine_only=True)

        assert "refs/heads/rewritten" not in _branches_in_graph(graph)
