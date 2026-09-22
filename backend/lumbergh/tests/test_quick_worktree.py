"""One-click worktree: a second agent on the same repo, nothing to fill in.

The full create flow asks for a branch, a session name and a description. When
you just want another agent working somewhere else, all three are ceremony.
"""

import pytest
from fastapi.testclient import TestClient
from tinydb import TinyDB

from lumbergh.db_utils import CONFIG_DIR
from lumbergh.main import app
from lumbergh.quick_worktree import next_quick_name
from lumbergh.routers import sessions as sessions_router
from lumbergh.routers.sessions import _resolve_launch_command as real_launch_command


class TestNaming:
    def test_the_first_quick_worktree_is_number_one(self):
        assert next_quick_name(set(), set()) == ("quick/1", "quick-1")

    def test_it_steps_past_a_branch_that_already_exists(self):
        assert next_quick_name({"quick/1", "quick/2"}, set()) == ("quick/3", "quick-3")

    def test_a_taken_session_name_moves_the_branch_too(self):
        """Branch and session stay a matching pair, so one name describes both."""
        assert next_quick_name(set(), {"quick-1"}) == ("quick/2", "quick-2")


@pytest.fixture
def client(tmp_path, monkeypatch):
    table = TinyDB(tmp_path / "sessions.json").table("sessions")
    monkeypatch.setattr(sessions_router, "sessions_table", table)
    monkeypatch.setattr(sessions_router, "get_live_sessions", dict)
    monkeypatch.setattr(sessions_router, "create_tmux_session", lambda *_a, **_k: None)
    monkeypatch.setattr(
        sessions_router, "_resolve_launch_command", lambda _provider, **_kw: "claude"
    )
    from lumbergh.routers import settings as settings_router

    monkeypatch.setattr(
        settings_router,
        "get_settings",
        lambda: {"worktree": {"base_dir": str(tmp_path / "worktrees")}},
    )
    return TestClient(app)


class TestEndpoint:
    def test_it_creates_a_worktree_session_on_a_fresh_branch(self, client, mock_git_repo):
        response = client.post(
            "/api/sessions/quick-worktree", json={"parent_repo": str(mock_git_repo)}
        )

        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "quick-1"
        assert body["type"] == "worktree"
        assert body["worktreeBranch"] == "quick/1"
        assert body["worktreeParentRepo"] == str(mock_git_repo)

    def test_the_second_one_does_not_collide_with_the_first(self, client, mock_git_repo):
        first = client.post(
            "/api/sessions/quick-worktree", json={"parent_repo": str(mock_git_repo)}
        )
        second = client.post(
            "/api/sessions/quick-worktree", json={"parent_repo": str(mock_git_repo)}
        )

        assert first.json()["name"] == "quick-1"
        assert second.json()["name"] == "quick-2"
        assert second.json()["worktreeBranch"] == "quick/2"

    def test_a_directory_that_is_not_a_repo_is_a_plain_400(self, client, tmp_path):
        plain = tmp_path / "not-a-repo"
        plain.mkdir()

        response = client.post("/api/sessions/quick-worktree", json={"parent_repo": str(plain)})

        assert response.status_code == 400
        assert "git repository" in response.json()["detail"]


class TestRegistryIsolation:
    def test_the_run_does_not_touch_the_developers_own_registry(self, client, mock_git_repo):
        """Rows written here point at tmp dirs pytest then deletes, and every later
        `lb fleet` dies reconciling a repo that is no longer on disk."""
        registry = CONFIG_DIR / "worktrees.json"
        before = registry.read_text() if registry.exists() else None

        client.post("/api/sessions/quick-worktree", json={"parent_repo": str(mock_git_repo)})

        assert (registry.read_text() if registry.exists() else None) == before


@pytest.fixture
def launches(request, monkeypatch):
    """The launch commands the endpoint actually hands tmux.

    Restores the real resolver the ``client`` fixture stubs out — the choice of
    command is the thing under test here — so it has to be set up after it.
    """
    request.getfixturevalue("client")
    recorded: list[str] = []
    monkeypatch.setattr(sessions_router, "_resolve_launch_command", real_launch_command)
    monkeypatch.setattr(
        sessions_router,
        "create_tmux_session",
        lambda _name, _workdir, launch_command: recorded.append(launch_command),
    )
    return recorded


class TestFreshConversation:
    """A quick worktree is a new agent, never a returning one.

    Names are the lowest free number, so ``quick/1`` comes back around once the
    last one is gone — and onto the same worktree path, because the path is
    derived from the branch. The harness keys its history on the working
    directory, so ``claude --continue`` there picks up whoever sat in that seat
    before and carries on their conversation.
    """

    def test_it_launches_an_agent_with_nothing_to_resume(self, client, launches, mock_git_repo):
        client.post("/api/sessions/quick-worktree", json={"parent_repo": str(mock_git_repo)})

        assert launches == ["claude"]

    def test_the_reused_name_does_not_reopen_the_last_occupants_conversation(
        self, client, launches, mock_git_repo
    ):
        """quick-1, deleted, then quick-1 again — the second one starts empty."""
        client.post("/api/sessions/quick-worktree", json={"parent_repo": str(mock_git_repo)})
        client.delete("/api/sessions/quick-1")
        client.post("/api/sessions/quick-worktree", json={"parent_repo": str(mock_git_repo)})

        assert all("--continue" not in command for command in launches)
