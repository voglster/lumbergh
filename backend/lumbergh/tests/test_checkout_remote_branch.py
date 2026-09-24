"""Checking out a branch by its remote name.

The UI hands this endpoint whatever the branch badge says, and two of its
labels carry the remote's prefix: every entry in the branch dropdown
(``get_branches`` returns ``origin/foo``), and a graph badge whose local
branch of the same name sits on a different commit. ``git checkout
origin/foo`` detaches HEAD, so picking a branch from the list left you on no
branch at all — and the graph's "checkout and reset it" confirmation reset the
detached HEAD instead of the branch it named.

From the UI there is no such thing as wanting a detached HEAD. Naming the
remote means: put me on the local branch of that name, making it if it does
not exist, and move it here if it safely can.
"""

import subprocess
from pathlib import Path

import pytest

from lumbergh.git_utils import checkout_branch


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(cwd), *args],
        check=True,
        capture_output=True,
        encoding="utf-8",
    ).stdout.strip()


def _commit(repo: Path, message: str) -> str:
    (repo / "f").write_text(message)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", message)
    return _git(repo, "rev-parse", "HEAD")


def _head_branch(repo: Path) -> str:
    return _git(repo, "rev-parse", "--abbrev-ref", "HEAD")


def _upstream(repo: Path, branch: str) -> str:
    return _git(repo, "rev-parse", "--abbrev-ref", f"{branch}@{{upstream}}")


@pytest.fixture
def clone(tmp_path):
    """A clone whose origin carries a ``feature`` branch one commit ahead."""
    origin = tmp_path / "origin"
    origin.mkdir()
    _git(origin, "init", "-q", "-b", "main")
    _git(origin, "config", "user.email", "t@t.t")
    _git(origin, "config", "user.name", "t")
    _commit(origin, "init")
    _git(origin, "checkout", "-q", "-b", "feature")
    _commit(origin, "their work")
    _git(origin, "checkout", "-q", "main")

    working = tmp_path / "clone"
    _git(tmp_path, "clone", "-q", str(origin), str(working))
    _git(working, "config", "user.email", "t@t.t")
    _git(working, "config", "user.name", "t")
    return working


class TestRemoteOnlyBranch:
    def test_it_lands_on_a_local_branch_rather_than_a_detached_head(self, clone):
        result = checkout_branch(clone, "origin/feature")

        assert "error" not in result
        assert _head_branch(clone) == "feature"

    def test_the_new_branch_tracks_the_remote_it_came_from(self, clone):
        checkout_branch(clone, "origin/feature")

        assert _upstream(clone, "feature") == "origin/feature"

    def test_it_sits_at_the_commit_the_remote_names(self, clone):
        checkout_branch(clone, "origin/feature")

        assert _git(clone, "rev-parse", "HEAD") == _git(clone, "rev-parse", "origin/feature")


class TestLocalBranchAlreadyThere:
    def test_a_local_branch_at_the_same_commit_is_simply_checked_out(self, clone):
        _git(clone, "checkout", "-q", "-b", "feature", "origin/feature")
        _git(clone, "checkout", "-q", "main")

        result = checkout_branch(clone, "origin/feature")

        assert "error" not in result
        assert _head_branch(clone) == "feature"

    def test_a_local_branch_left_behind_is_carried_forward(self, clone):
        """Behind the remote is the case "move it to here" is really asking for."""
        _git(clone, "branch", "feature", "origin/feature~1")

        checkout_branch(clone, "origin/feature")

        assert _head_branch(clone) == "feature"
        assert _git(clone, "rev-parse", "HEAD") == _git(clone, "rev-parse", "origin/feature")


class TestLocalBranchThatHasDiverged:
    @pytest.fixture
    def diverged(self, clone):
        """A local ``feature`` carrying one commit the remote has never seen."""
        _git(clone, "checkout", "-q", "-b", "feature", "origin/feature~1")
        mine = _commit(clone, "my unpushed work")
        _git(clone, "checkout", "-q", "main")
        return clone, mine

    def test_it_checks_the_branch_out_without_moving_it(self, diverged):
        repo, mine = diverged

        checkout_branch(repo, "origin/feature")

        assert _head_branch(repo) == "feature"
        assert _git(repo, "rev-parse", "HEAD") == mine

    def test_it_says_what_it_left_alone(self, diverged):
        repo, _mine = diverged

        result = checkout_branch(repo, "origin/feature")

        assert result["divergedCommits"] == 1
        assert "1 commit" in result["message"]

    def test_an_explicit_reset_still_moves_the_branch_itself(self, diverged):
        """What the graph's confirm dialog promises — and it must move the
        branch, not the detached HEAD it used to leave behind."""
        repo, _mine = diverged
        remote_tip = _git(repo, "rev-parse", "origin/feature")

        checkout_branch(repo, "origin/feature", reset_to=remote_tip)

        assert _head_branch(repo) == "feature"
        assert _git(repo, "rev-parse", "feature") == remote_tip


class TestNamesThatOnlyLookRemote:
    def test_a_local_branch_genuinely_named_like_a_remote_is_left_alone(self, clone):
        """``origin/x`` is a legal local branch name, and it means itself."""
        _git(clone, "branch", "origin/odd", "main")

        result = checkout_branch(clone, "origin/odd")

        assert "error" not in result
        assert _head_branch(clone) == "origin/odd"

    def test_a_plain_local_branch_is_untouched_by_any_of_this(self, clone):
        _git(clone, "branch", "plain", "main")

        result = checkout_branch(clone, "plain")

        assert "error" not in result
        assert _head_branch(clone) == "plain"
