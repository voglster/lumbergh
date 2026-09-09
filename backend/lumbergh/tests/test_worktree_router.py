from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("LUMBERGH_DATA_DIR", str(tmp_path / "cfg"))
    import importlib

    from lumbergh import constants, db_utils, worktrees
    from lumbergh.routers import worktrees as wt_router

    importlib.reload(constants)
    importlib.reload(db_utils)
    importlib.reload(worktrees)
    monkeypatch.setattr(wt_router, "get_stored_sessions", dict)
    monkeypatch.setattr(wt_router, "list_tmux_sessions", list)
    from lumbergh.main import app

    return TestClient(app)


def test_create_list_reap_roundtrip(client, tmp_path):
    from lumbergh.tests.test_worktrees import _init_repo

    repo = _init_repo(tmp_path / "app")
    r = client.post(
        "/api/worktrees", json={"repo": str(repo), "branch": "feat/x", "create_branch": True}
    )
    assert r.status_code == 200, r.text
    wt_path = r.json()["path"]

    listed = client.get("/api/worktrees", params={"repo": str(repo)}).json()["worktrees"]
    assert any(w["path"] == str(Path(wt_path).resolve()) for w in listed)
    assert listed[0]["state"] == "orphan"  # no live session in this test

    reaped = client.post("/api/worktrees/reap", json={"path": wt_path, "force": True})
    assert reaped.status_code == 200
    assert reaped.json()["status"] == "removed"


def test_reap_kills_the_worker_session(client, tmp_path, monkeypatch):
    # A reaped task's tmux session used to linger — visible in `lb` with no worktree
    # behind it. Reaping the worktree should take its worker down with it.
    from lumbergh.routers import worktrees as wt_router
    from lumbergh.tests.test_worktrees import _init_repo

    killed = []
    monkeypatch.setattr(wt_router, "kill_tmux_session", lambda name: killed.append(name) or True)

    repo = _init_repo(tmp_path / "app")
    r = client.post(
        "/api/worktrees",
        json={"repo": str(repo), "branch": "feat/x", "create_branch": True, "session": "w-x"},
    )
    wt_path = r.json()["path"]

    reaped = client.post("/api/worktrees/reap", json={"path": wt_path, "force": True})
    assert reaped.json()["status"] == "removed"
    assert killed == ["w-x"]


def test_reap_refusal_leaves_the_session_alone(client, tmp_path, monkeypatch):
    # A refused reap (dirty/unpushed) is a stop-and-report — it must not kill the
    # worker whose work would be lost.
    from lumbergh.routers import worktrees as wt_router
    from lumbergh.tests.test_worktrees import _init_repo

    killed = []
    monkeypatch.setattr(wt_router, "kill_tmux_session", lambda name: killed.append(name) or True)

    repo = _init_repo(tmp_path / "app")
    r = client.post(
        "/api/worktrees",
        json={"repo": str(repo), "branch": "feat/x", "create_branch": True, "session": "w-x"},
    )
    wt_path = r.json()["path"]
    (Path(wt_path) / "dirty.txt").write_text("uncommitted")

    reaped = client.post("/api/worktrees/reap", json={"path": wt_path, "force": False})
    assert reaped.json().get("reason") == "dirty"
    assert killed == []


def test_reap_of_window_target_kills_window_not_session(client, tmp_path, monkeypatch):
    # A batch worker lives at session:window (e.g. "port:fleet-644"). Reaping it must
    # kill only that window — killing the session would take out sibling workers too.
    from lumbergh.routers import worktrees as wt_router
    from lumbergh.tests.test_worktrees import _init_repo

    killed = {}
    monkeypatch.setattr(
        wt_router, "kill_tmux_window", lambda t: killed.setdefault("window", t) or True
    )
    monkeypatch.setattr(
        wt_router, "kill_tmux_session", lambda t: killed.setdefault("session", t) or True
    )

    repo = _init_repo(tmp_path / "app")
    r = client.post(
        "/api/worktrees",
        json={
            "repo": str(repo),
            "branch": "feat/x",
            "create_branch": True,
            "session": "port:fleet-644",
        },
    )
    wt_path = r.json()["path"]

    reaped = client.post("/api/worktrees/reap", json={"path": wt_path, "force": True})
    assert reaped.json()["status"] == "removed"
    assert killed == {"window": "port:fleet-644"}


def test_ls_uses_stubbed_sessions_not_real_tmux(client, tmp_path):
    from lumbergh.routers import worktrees as wt_router
    from lumbergh.tests.test_worktrees import _init_repo

    repo = _init_repo(tmp_path / "app")
    r = client.post(
        "/api/worktrees", json={"repo": str(repo), "branch": "feat/y", "create_branch": True}
    )
    wt_path = r.json()["path"]

    wt_router.get_stored_sessions = lambda: {
        "kb-sentinel": {"workdir": wt_path, "agent_provider": "sentinel"}
    }
    wt_router.list_tmux_sessions = lambda: [{"name": "kb-sentinel"}]

    listed = client.get("/api/worktrees", params={"repo": str(repo)}).json()["worktrees"]
    row = next(w for w in listed if w["path"] == str(Path(wt_path).resolve()))
    assert row["state"] == "active"
    assert row["session"] == "kb-sentinel"
    assert row["agent"] == "sentinel"


def test_ls_without_repo_returns_worktrees_from_all_repos(client, tmp_path):
    from lumbergh.tests.test_worktrees import _init_repo

    repo_a = _init_repo(tmp_path / "app-a")
    repo_b = _init_repo(tmp_path / "app-b")
    r_a = client.post(
        "/api/worktrees", json={"repo": str(repo_a), "branch": "feat/a", "create_branch": True}
    )
    r_b = client.post(
        "/api/worktrees", json={"repo": str(repo_b), "branch": "feat/b", "create_branch": True}
    )
    assert r_a.status_code == 200, r_a.text
    assert r_b.status_code == 200, r_b.text

    listed = client.get("/api/worktrees").json()["worktrees"]
    repos = {w["repo"] for w in listed}
    assert repos == {"app-a", "app-b"}


def test_adopt_of_hand_made_worktree(client, tmp_path):
    from lumbergh.tests.test_worktrees import _git, _init_repo

    repo = _init_repo(tmp_path / "app")
    wt = tmp_path / "hand-made-wt"
    _git(repo, "worktree", "add", "-q", "-b", "feat/manual", str(wt))

    adopted = client.post("/api/worktrees/adopt", json={"path": str(wt), "session": "kb-2"})
    assert adopted.status_code == 200
    body = adopted.json()
    assert body["status"] == "adopted"
    assert body["branch"] == "feat/manual"
    assert body["parent_repo"] == str(repo.resolve())
    assert body["target"] == "kb-2"


def test_link_then_unlink_promotes_symlink_to_copy(client, tmp_path):
    from lumbergh.tests.test_worktrees import _init_repo

    repo = _init_repo(tmp_path / "app")
    (repo / ".venv").mkdir()
    (repo / ".venv" / "marker").write_text("v")
    # A repo that asks for sharing by name is the only way a worktree gets a symlink now,
    # and the only case `/unlink` has anything to promote.
    (repo / ".lumbergh.toml").write_text(
        '[worktree]\nlinks = [{ path = ".venv", mode = "symlink" }]\n'
    )

    r = client.post(
        "/api/worktrees", json={"repo": str(repo), "branch": "feat/z", "create_branch": True}
    )
    wt = Path(r.json()["path"])
    assert (wt / ".venv").is_symlink()

    unlinked = client.post("/api/worktrees/unlink", json={"path": str(wt)})
    assert unlinked.status_code == 200
    assert unlinked.json()["unlinked"] == [{"path": ".venv", "status": "copied"}]
    assert not (wt / ".venv").is_symlink()
    assert (wt / ".venv" / "marker").read_text() == "v"

    linked = client.post("/api/worktrees/link", json={"path": str(wt)})
    assert linked.status_code == 200
    assert linked.json() == {"linked": []}  # already present post-unlink -> plan_links skips it


def test_for_session_lists_the_siblings_of_the_repo_the_session_sits_in(
    client, tmp_path, monkeypatch
):
    """The Git tab knows a session name and nothing else.

    It has no way to learn a filesystem path, and the worktrees worth showing are
    the ones sharing this session's repo — which, when the session is itself a
    worktree, is its parent rather than its own directory.
    """
    from lumbergh.tests.test_worktrees import _init_repo

    repo = _init_repo(tmp_path / "app")
    made = client.post(
        "/api/worktrees", json={"repo": str(repo), "branch": "feat/x", "create_branch": True}
    ).json()

    from lumbergh.routers import worktrees as wt_router

    monkeypatch.setattr(wt_router, "get_session_workdir", lambda _name: Path(made["path"]))

    body = client.get("/api/worktrees/for-session/whatever").json()

    assert body["repo"] == str(repo)
    assert [w["path"] for w in body["worktrees"]] == [str(Path(made["path"]).resolve())]


def test_readiness_reports_a_clean_worktree_as_holding_nothing(client, tmp_path):
    from lumbergh.tests.test_worktrees import _init_repo

    repo = _init_repo(tmp_path / "app")
    wt_path = client.post(
        "/api/worktrees", json={"repo": str(repo), "branch": "feat/x", "create_branch": True}
    ).json()["path"]

    r = client.get("/api/worktrees/readiness", params={"path": wt_path})

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dirty"] == 0
    assert body["commits"] == 0
    # No remote to compare against, so landedness is unestablished rather than proven —
    # the caller is told which of the two it is.
    assert body["blocker"] == "unknown"
    assert body["landed"] is None


def test_readiness_counts_the_uncommitted_files_a_reap_would_destroy(client, tmp_path):
    # The blocker alone says "dirty"; the modal has to say how much is at stake.
    from lumbergh.tests.test_worktrees import _init_repo

    repo = _init_repo(tmp_path / "app")
    wt_path = client.post(
        "/api/worktrees", json={"repo": str(repo), "branch": "feat/x", "create_branch": True}
    ).json()["path"]
    (Path(wt_path) / "scratch.py").write_text("half a thought\n")
    (Path(wt_path) / "notes.md").write_text("the other half\n")

    body = client.get("/api/worktrees/readiness", params={"path": wt_path}).json()

    assert body["blocker"] == "dirty"
    assert body["dirty"] == 2


def test_readiness_names_the_live_session_a_reap_would_kill(client, tmp_path, monkeypatch):
    from lumbergh.routers import worktrees as wt_router
    from lumbergh.tests.test_worktrees import _init_repo

    repo = _init_repo(tmp_path / "app")
    wt_path = client.post(
        "/api/worktrees",
        json={"repo": str(repo), "branch": "feat/x", "create_branch": True, "session": "w-x"},
    ).json()["path"]
    monkeypatch.setattr(wt_router, "list_tmux_sessions", lambda: [{"name": "w-x"}])
    monkeypatch.setattr(
        wt_router, "get_stored_sessions", lambda: {"w-x": {"workdir": str(wt_path)}}
    )

    body = client.get("/api/worktrees/readiness", params={"path": wt_path}).json()

    assert body["session"] == "w-x"


def test_readiness_never_removes_anything(client, tmp_path):
    from lumbergh.tests.test_worktrees import _init_repo

    repo = _init_repo(tmp_path / "app")
    wt_path = client.post(
        "/api/worktrees", json={"repo": str(repo), "branch": "feat/x", "create_branch": True}
    ).json()["path"]

    client.get("/api/worktrees/readiness", params={"path": wt_path})

    assert Path(wt_path).exists()
    assert worktrees_module().get_entry(Path(wt_path)) is not None


def worktrees_module():
    from lumbergh import worktrees

    return worktrees
