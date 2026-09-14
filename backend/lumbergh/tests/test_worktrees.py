import importlib
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from lumbergh import worktrees


@pytest.fixture
def registry(tmp_path, monkeypatch):
    from tinydb import TinyDB

    db = TinyDB(tmp_path / "worktrees.json")
    monkeypatch.setattr(worktrees, "get_worktrees_db", lambda: db)
    yield db
    db.close()


@pytest.fixture
def worktrees_db(tmp_path, monkeypatch):
    from tinydb import TinyDB

    db = TinyDB(tmp_path / "worktrees.json")
    monkeypatch.setattr(worktrees, "get_worktrees_db", lambda: db)
    yield db
    db.close()


def _write(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True)


@pytest.mark.usefixtures("worktrees_db")
def test_reap_allows_worktree_whose_commits_landed_via_rebase(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "master")
    _git(repo, "config", "user.email", "t@t")
    _git(repo, "config", "user.name", "t")
    (repo / "base.txt").write_text("base")
    _git(repo, "add", ".")
    _git(repo, "commit", "-qm", "base")
    origin = tmp_path / "origin.git"
    _git(repo, "clone", "--bare", "-q", str(repo), str(origin))
    _git(repo, "remote", "add", "origin", str(origin))
    _git(repo, "fetch", "-q", "origin")

    wt = tmp_path / "wt"
    _git(repo, "worktree", "add", "-q", "-b", "worker", str(wt), "master")
    (wt / "work.txt").write_text("done")
    _git(wt, "add", ".")
    _git(wt, "commit", "-qm", "work")

    # Land-by-rebase: the same content reaches origin under a rewritten sha (amend
    # forces a distinct sha, same tree), so the worker's original commit is on no
    # remote, yet origin/master's tree now equals the worktree's tree. Pure ancestry
    # calls this "unpushed"; nothing is actually at risk.
    _git(repo, "cherry-pick", "worker")
    _git(repo, "commit", "--amend", "-qm", "work (landed)")
    _git(repo, "push", "-q", "origin", "master")

    result = worktrees.reap(wt, force=False, rm_branch=True)

    assert result.get("status") == "removed", result


def _repo_with_origin(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "master")
    _git(repo, "config", "user.email", "t@t")
    _git(repo, "config", "user.name", "t")
    (repo / "base.txt").write_text("base")
    _git(repo, "add", ".")
    _git(repo, "commit", "-qm", "base")
    origin = tmp_path / "origin.git"
    _git(repo, "clone", "--bare", "-q", str(repo), str(origin))
    _git(repo, "remote", "add", "origin", str(origin))
    _git(repo, "fetch", "-q", "origin")
    return repo


@pytest.mark.usefixtures("worktrees_db")
def test_reap_allows_a_worker_whose_batch_landed_alongside_other_workers(tmp_path):
    """The real shape of a landed batch: `lb land` cherry-picks EVERY worker onto
    the base, so no single worker's tree ever equals the landed tree — only its
    patch does. Tree comparison alone refuses every worker of every green batch."""
    repo = _repo_with_origin(tmp_path)

    worktrees_by_name = {}
    for name in ("worker-a", "worker-b"):
        wt = tmp_path / name
        _git(repo, "worktree", "add", "-q", "-b", name, str(wt), "master")
        (wt / f"{name}.txt").write_text(name)
        _git(wt, "add", ".")
        _git(wt, "commit", "-qm", f"{name} work")
        worktrees_by_name[name] = wt

    # The base moved while the workers ran, so every pick is a genuine rewrite —
    # this is what makes the landed shas differ from the workers' originals.
    (repo / "base.txt").write_text("base moved")
    _git(repo, "commit", "-qam", "base moves on")
    for name in ("worker-a", "worker-b"):
        _git(repo, "cherry-pick", name)
    _git(repo, "push", "-q", "origin", "master")

    result = worktrees.reap(worktrees_by_name["worker-a"], force=False, rm_branch=True)

    assert result.get("status") == "removed", result
    assert result.get("landed") is True, result


@pytest.mark.usefixtures("worktrees_db")
def test_reap_reports_landed_false_for_unlanded_work_it_is_forced_through(tmp_path):
    """`lb teardown --force` still has to say whether the work landed — that flag is
    the only signal a repo has for putting a torn-down worker's issue back on the board."""
    repo = _repo_with_origin(tmp_path)
    wt = tmp_path / "wt"
    _git(repo, "worktree", "add", "-q", "-b", "worker", str(wt), "master")
    (wt / "novel.txt").write_text("never pushed anywhere")
    _git(wt, "add", ".")
    _git(wt, "commit", "-qm", "work")

    result = worktrees.reap(wt, force=True, rm_branch=True)

    assert result.get("status") == "removed", result
    assert result.get("landed") is False, result


@pytest.mark.usefixtures("worktrees_db")
def test_reap_still_refuses_genuinely_unlanded_work(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "master")
    _git(repo, "config", "user.email", "t@t")
    _git(repo, "config", "user.name", "t")
    (repo / "base.txt").write_text("base")
    _git(repo, "add", ".")
    _git(repo, "commit", "-qm", "base")
    origin = tmp_path / "origin.git"
    _git(repo, "clone", "--bare", "-q", str(repo), str(origin))
    _git(repo, "remote", "add", "origin", str(origin))
    _git(repo, "fetch", "-q", "origin")

    wt = tmp_path / "wt"
    _git(repo, "worktree", "add", "-q", "-b", "worker", str(wt), "master")
    (wt / "novel.txt").write_text("never pushed anywhere")
    _git(wt, "add", ".")
    _git(wt, "commit", "-qm", "work")

    # The patch is in no base and on no remote — reaping would truly lose it, so refuse.
    result = worktrees.reap(wt, force=False)

    assert result.get("reason") == "unlanded", result
    # A refusal still has to answer the question it refused on: blank is not "false".
    assert result.get("landed") is False, result
    assert result.get("commits") == 1, result


def _commit_mode_fleet(tmp_path: Path) -> tuple[Path, dict[str, Path]]:
    """A `commit`-delivery run at the moment teardown runs: workers committed and
    never pushed, one scout committed nothing, and the overseer landed the batch onto
    the local base branch. Nothing has reached a remote yet — the normal state."""
    repo = _repo_with_origin(tmp_path)
    _git(repo, "checkout", "-q", "-b", "dev")
    _git(repo, "push", "-q", "origin", "dev")

    workers = {}
    for name in ("issue-749", "issue-786"):
        wt = tmp_path / name
        _git(repo, "worktree", "add", "-q", "-b", name, str(wt), "dev")
        (wt / f"{name}.txt").write_text(name)
        _git(wt, "add", ".")
        _git(wt, "commit", "-qm", f"{name} work")
        workers[name] = wt
    scout = tmp_path / "scout-585"
    _git(repo, "worktree", "add", "-q", "-b", "scout-585", str(scout), "dev")
    workers["scout-585"] = scout

    _git(repo, "checkout", "-q", "-b", "batch-run", "dev")
    for name in ("issue-749", "issue-786"):
        _git(repo, "cherry-pick", name)
    _git(repo, "checkout", "-q", "dev")
    _git(repo, "merge", "-q", "--ff-only", "batch-run")
    for name, wt in workers.items():
        worktrees.record_worktree(
            wt, repo, name, "2026-08-02T00:00:00Z", run="port-tooling-0802", base_branch="dev"
        )
    return repo, workers


@pytest.mark.usefixtures("worktrees_db")
def test_reap_lands_a_commit_mode_worker_that_never_pushed(tmp_path):
    """The delivery mode is `commit`: workers never push, so "unpushed" is the normal
    state of fully landed work. Refusing on it makes `--force` reflex — the very thing
    the landed check was added to end. Patch identity against the base is the question."""
    _, workers = _commit_mode_fleet(tmp_path)

    result = worktrees.reap(workers["issue-749"], force=False, rm_branch=True)

    assert result.get("status") == "removed", result
    assert result.get("landed") is True, result


@pytest.mark.usefixtures("worktrees_db")
def test_reap_reports_landed_on_the_forced_path_too(tmp_path):
    """`--force` suppresses the refusal, not the fact. Reporting `landed: false` for
    work that provably landed is worse than reporting nothing: the consumer acts on it."""
    _, workers = _commit_mode_fleet(tmp_path)

    result = worktrees.reap(workers["issue-786"], force=True, rm_branch=True)

    assert result.get("status") == "removed", result
    assert result.get("landed") is True, result


@pytest.mark.usefixtures("worktrees_db")
def test_reap_reports_a_zero_commit_scout_as_having_landed_nothing(tmp_path):
    """A scout delivers a report and commits nothing. "Landed" is vacuously true of it
    and sends a consumer looking for work that never existed — it landed nothing."""
    _, workers = _commit_mode_fleet(tmp_path)

    result = worktrees.reap(workers["scout-585"], force=False, rm_branch=True)

    assert result.get("status") == "removed", result  # nothing to lose, so no refusal
    assert result.get("commits") == 0, result
    assert result.get("landed") is False, result


@pytest.mark.usefixtures("worktrees_db")
def test_reap_reports_landed_unknown_when_no_base_can_be_resolved(tmp_path):
    """With nothing to compare against, the honest answer is "unknown" — and a consumer
    must be able to tell that from a genuine `false`, which it acts on."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "master")
    _git(repo, "config", "user.email", "t@t")
    _git(repo, "config", "user.name", "t")
    (repo / "base.txt").write_text("base")
    _git(repo, "add", ".")
    _git(repo, "commit", "-qm", "base")
    wt = tmp_path / "wt"
    _git(repo, "worktree", "add", "-q", "-b", "worker", str(wt), "master")
    (wt / "work.txt").write_text("work")
    _git(wt, "add", ".")
    _git(wt, "commit", "-qm", "work")

    refused = worktrees.reap(wt, force=False)
    assert refused.get("reason") == "unknown", refused

    forced = worktrees.reap(wt, force=True, rm_branch=True)
    assert forced.get("status") == "removed", forced
    assert forced.get("landed") is None, forced


@pytest.mark.usefixtures("worktrees_db")
def test_reap_readiness_answers_without_touching_the_worktree(tmp_path):
    """`lb teardown --dry-run` needs the whole verdict before anything is destroyed."""
    _, workers = _commit_mode_fleet(tmp_path)

    readiness = worktrees.reap_readiness(workers["issue-749"])

    assert readiness == {"landed": True, "commits": 1, "blocker": None, "processes": []}
    assert workers["issue-749"].exists()


@pytest.mark.usefixtures("worktrees_db")
def test_reap_is_idempotent_when_worktree_and_parent_already_gone(tmp_path):
    import shutil

    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "master")
    _git(repo, "config", "user.email", "t@t")
    _git(repo, "config", "user.name", "t")
    (repo / "base.txt").write_text("base")
    _git(repo, "add", ".")
    _git(repo, "commit", "-qm", "base")

    now = "2026-07-30T00:00:00Z"
    created = worktrees.create(repo, "feat/gone", created_at=now, create_branch=True)
    wt = Path(created["path"])
    assert worktrees.get_entry(wt) is not None

    # An `lb teardown` (or manual cleanup) can leave the worktrees registry pointing
    # at a worktree — and even its parent repo — that no longer exists on disk. Reaping
    # such a ghost must converge to "already gone", not raise NoSuchPathError.
    shutil.rmtree(repo)
    shutil.rmtree(wt, ignore_errors=True)

    result = worktrees.reap(wt, force=True)

    assert "error" not in result, result
    assert worktrees.get_entry(wt) is None


def test_apply_links_excludes_symlinked_dir_so_status_stays_clean(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "master")
    _git(repo, "config", "user.email", "t@t")
    _git(repo, "config", "user.name", "t")
    # A trailing-slash pattern matches a real directory but NOT a symlink-to-dir,
    # the exact mismatch that left `?? e2e/.venv` in every worker worktree.
    (repo / ".gitignore").write_text(".venv/\n")
    (repo / "e2e").mkdir()
    (repo / "e2e" / "keep").write_text("x")
    _git(repo, "add", ".")
    _git(repo, "commit", "-qm", "base")
    (repo / "e2e" / ".venv").mkdir()  # the real dep dir in the main checkout

    wt = tmp_path / "wt"
    _git(repo, "worktree", "add", "-q", "-b", "work", str(wt), "master")

    worktrees.apply_links(repo, wt, [worktrees.LinkSpec(path="e2e/.venv", mode="symlink")])

    assert (wt / "e2e" / ".venv").is_symlink()
    status = subprocess.run(
        ["git", "-C", str(wt), "status", "--porcelain"],
        capture_output=True,
        encoding="utf-8",
    ).stdout
    assert ".venv" not in status  # the linked dep must not read as untracked


def _init_repo(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    _git(path, "init", "-q")
    _git(path, "config", "user.email", "t@t.t")
    _git(path, "config", "user.name", "t")
    (path / ".gitignore").write_text(".venv/\nnode_modules/\n.env\n")
    (path / "README").write_text("x")
    _git(path, "add", "-A")
    _git(path, "commit", "-qm", "init")
    return path


def test_parse_config_absent_dotfile_yields_autodetect(tmp_path):
    cfg = worktrees.parse_worktree_config(tmp_path)
    assert cfg.links is None
    assert cfg.post_create == []
    assert cfg.base_dir is None


def test_parse_config_reads_links_modes_hooks_and_basedir(tmp_path):
    _write(
        tmp_path / ".lumbergh.toml",
        "[worktree]\n"
        'base_dir = "~/wt"\n'
        'links = [{ path = ".venv", mode = "copy" }, "node_modules"]\n'
        'post_create = ["uv sync"]\n',
    )
    cfg = worktrees.parse_worktree_config(tmp_path)
    assert cfg.base_dir == "~/wt"
    assert cfg.post_create == ["uv sync"]
    assert cfg.links == [
        worktrees.LinkSpec(path=".venv", mode="copy"),
        worktrees.LinkSpec(path="node_modules", mode="copy"),
    ]


def test_resolve_dir_sibling_default(tmp_path):
    repo = tmp_path / "app"
    repo.mkdir()
    cfg = worktrees.parse_worktree_config(repo)
    out = worktrees.resolve_worktree_dir(repo, "feat/x", cfg, global_base_dir=None)
    assert out == tmp_path / "app-worktrees" / "feat-x"


def test_resolve_dir_global_base_dir(tmp_path):
    repo = tmp_path / "app"
    repo.mkdir()
    cfg = worktrees.parse_worktree_config(repo)
    out = worktrees.resolve_worktree_dir(
        repo, "feat/x", cfg, global_base_dir=str(tmp_path / "central")
    )
    assert out == tmp_path / "central" / "app" / "feat-x"


def test_resolve_dir_dotfile_base_dir_wins_over_global(tmp_path):
    repo = tmp_path / "app"
    repo.mkdir()
    _write(repo / ".lumbergh.toml", f'[worktree]\nbase_dir = "{tmp_path / "proj"}"\n')
    cfg = worktrees.parse_worktree_config(repo)
    out = worktrees.resolve_worktree_dir(
        repo, "feat/x", cfg, global_base_dir=str(tmp_path / "central")
    )
    assert out == tmp_path / "proj" / "app" / "feat-x"


def test_plan_links_autodetect_only_existing_and_ignored(tmp_path):
    repo = _init_repo(tmp_path / "app")
    (repo / ".venv").mkdir()
    (repo / ".env").write_text("SECRET=1")
    # node_modules absent -> skipped; README tracked -> never a candidate anyway
    cfg = worktrees.parse_worktree_config(repo)
    wt = tmp_path / "wt"
    wt.mkdir()
    planned = {s.path for s in worktrees.plan_links(repo, wt, cfg)}
    assert planned == {".venv", ".env"}


def test_plan_links_skips_when_already_present_in_worktree(tmp_path):
    repo = _init_repo(tmp_path / "app")
    (repo / ".venv").mkdir()
    cfg = worktrees.parse_worktree_config(repo)
    wt = tmp_path / "wt"
    (wt / ".venv").mkdir(parents=True)  # already there
    assert worktrees.plan_links(repo, wt, cfg) == []


def test_apply_links_copies_by_default_and_symlinks_only_on_request(tmp_path):
    repo = _init_repo(tmp_path / "app")
    (repo / ".venv").mkdir()
    (repo / ".venv" / "marker").write_text("v")
    (repo / "node_modules").mkdir()
    (repo / "node_modules" / "pkg").write_text("n")
    _write(
        repo / ".lumbergh.toml",
        '[worktree]\nlinks = [{ path = ".venv", mode = "symlink" }, "node_modules"]\n',
    )
    cfg = worktrees.parse_worktree_config(repo)
    wt = tmp_path / "wt"
    wt.mkdir()
    applied = worktrees.apply_links(repo, wt, worktrees.plan_links(repo, wt, cfg))
    assert {r["path"]: r["mode"] for r in applied} == {".venv": "symlink", "node_modules": "copy"}
    assert (wt / ".venv").is_symlink()  # asked for by name
    # The default: the worktree owns its dependencies, so nothing it runs can reach back
    # into the shared checkout and empty them.
    assert not (wt / "node_modules").is_symlink()
    assert (wt / "node_modules" / "pkg").read_text() == "n"


def test_registry_record_get_remove(tmp_path, monkeypatch):
    monkeypatch.setenv("LUMBERGH_DATA_DIR", str(tmp_path / "cfg"))
    import importlib

    from lumbergh import constants, db_utils

    importlib.reload(constants)
    importlib.reload(db_utils)
    importlib.reload(worktrees)

    wt = tmp_path / "app-worktrees" / "feat-x"
    worktrees.record_worktree(
        wt,
        parent_repo=tmp_path / "app",
        branch="feat/x",
        created_at="2026-07-28T00:00:00Z",
        session="kb-1",
        links_applied=[{"path": ".venv", "mode": "copy"}],
    )
    row = worktrees.get_entry(wt)
    assert row["branch"] == "feat/x"
    assert row["target"] == "kb-1"
    assert row["created_at"] == "2026-07-28T00:00:00Z"
    assert [r["path"] for r in worktrees.all_entries()] == [str(wt.resolve())]
    worktrees.remove_entry(wt)
    assert worktrees.get_entry(wt) is None


def test_reconcile_active_orphan_and_stale_prune(tmp_path, monkeypatch):
    monkeypatch.setenv("LUMBERGH_DATA_DIR", str(tmp_path / "cfg"))
    import importlib

    from lumbergh import constants, db_utils

    importlib.reload(constants)
    importlib.reload(db_utils)
    importlib.reload(worktrees)

    repo = _init_repo(tmp_path / "app")
    active = tmp_path / "app-worktrees" / "active"
    orphan = tmp_path / "app-worktrees" / "orphan"
    _git(repo, "worktree", "add", "-q", "-b", "active", str(active))
    _git(repo, "worktree", "add", "-q", "-b", "orphan", str(orphan))

    now = "2026-07-28T00:00:00Z"
    worktrees.record_worktree(active, repo, "active", now, session="kb-1")
    worktrees.record_worktree(orphan, repo, "orphan", now, session="kb-gone")
    worktrees.record_worktree(tmp_path / "ghost", repo, "ghost", now)  # not in git -> stale

    live = {"kb-1": {"workdir": str(active), "agent_provider": "claude"}}
    rows = worktrees.reconcile(repo, live)

    by_branch = {r["branch"]: r for r in rows}
    assert by_branch["active"]["state"] == "active"
    assert by_branch["active"]["session"] == "kb-1"
    assert by_branch["active"]["agent"] == "claude"
    assert by_branch["orphan"]["state"] == "orphan"
    assert by_branch["orphan"]["session"] is None
    assert by_branch["orphan"]["agent"] is None
    assert "ghost" not in by_branch
    assert worktrees.get_entry(tmp_path / "ghost") is None  # pruned

    live_no_provider = {"kb-1": {"workdir": str(active), "agent_provider": None}}
    rows_no_provider = worktrees.reconcile(repo, live_no_provider)
    by_branch_no_provider = {r["branch"]: r for r in rows_no_provider}
    from lumbergh.providers import DEFAULT_PROVIDER

    assert by_branch_no_provider["active"]["agent"] == DEFAULT_PROVIDER


def test_reconcile_carries_the_repo_and_intent_a_worktree_came_from(tmp_path, monkeypatch):
    monkeypatch.setenv("LUMBERGH_DATA_DIR", str(tmp_path / "cfg"))
    import importlib

    from lumbergh import constants, db_utils

    importlib.reload(constants)
    importlib.reload(db_utils)
    importlib.reload(worktrees)

    repo = _init_repo(tmp_path / "app")
    orphan = tmp_path / "app-worktrees" / "orphan"
    _git(repo, "worktree", "add", "-q", "-b", "orphan", str(orphan))
    worktrees.record_worktree(
        orphan,
        repo,
        "orphan",
        "2026-07-28T00:00:00Z",
        task_intent="teach the reaper to name its victims",
    )

    (row,) = worktrees.reconcile(repo, {})

    assert row["repo"] == "app"
    assert row["parent_repo"] == str(repo.resolve())
    assert row["task_intent"] == "teach the reaper to name its victims"


def test_count_unpushed_commits_scoped_to_worktree_head(tmp_path):
    from lumbergh.git_utils import count_unpushed_commits

    repo = _init_repo(tmp_path / "app")
    bare = tmp_path / "remote.git"
    bare.mkdir()
    _git(bare, "init", "-q", "--bare")
    _git(repo, "remote", "add", "origin", str(bare))
    _git(repo, "push", "-q", "origin", "HEAD:refs/heads/main")

    worktree_a = tmp_path / "wt-a"
    worktree_b = tmp_path / "wt-b"
    _git(repo, "worktree", "add", "-q", "-b", "a", str(worktree_a))
    _git(repo, "worktree", "add", "-q", "-b", "b", str(worktree_b))
    _git(worktree_a, "push", "-q", "origin", "a")
    _git(worktree_b, "push", "-q", "origin", "b")

    (worktree_b / "extra.txt").write_text("only on b")
    _git(worktree_b, "add", "-A")
    _git(worktree_b, "commit", "-qm", "b-only commit")

    assert count_unpushed_commits(worktree_a) == 0
    assert count_unpushed_commits(worktree_b) == 1


def test_reap_refuses_dirty_then_force_removes(tmp_path, monkeypatch):
    monkeypatch.setenv("LUMBERGH_DATA_DIR", str(tmp_path / "cfg"))
    from lumbergh import constants, db_utils

    importlib.reload(constants)
    importlib.reload(db_utils)
    importlib.reload(worktrees)

    repo = _init_repo(tmp_path / "app")
    now = "2026-07-28T00:00:00Z"
    created = worktrees.create(repo, "feat/x", created_at=now, create_branch=True)
    wt = Path(created["path"])
    (wt / "dirty.txt").write_text("uncommitted")

    refused = worktrees.reap(wt, force=False)
    assert refused["error"]
    assert refused["reason"] == "dirty"
    assert wt.exists()

    forced = worktrees.reap(wt, force=True)
    assert forced["status"] == "removed"
    assert not wt.exists()
    assert worktrees.get_entry(wt) is None


def test_reap_unregistered_worktree_derives_parent_via_git(tmp_path, monkeypatch):
    monkeypatch.setenv("LUMBERGH_DATA_DIR", str(tmp_path / "cfg"))
    from lumbergh import constants, db_utils

    importlib.reload(constants)
    importlib.reload(db_utils)
    importlib.reload(worktrees)

    repo = _init_repo(tmp_path / "app")
    wt = tmp_path / "hand-made-wt"
    _git(repo, "worktree", "add", "-q", "-b", "feat/manual", str(wt))
    assert worktrees.get_entry(wt) is None

    result = worktrees.reap(wt, force=True)

    assert result["status"] == "removed"
    assert not wt.exists()


def test_create_applies_links_and_records(tmp_path, monkeypatch):
    monkeypatch.setenv("LUMBERGH_DATA_DIR", str(tmp_path / "cfg"))
    from lumbergh import constants, db_utils

    importlib.reload(constants)
    importlib.reload(db_utils)
    importlib.reload(worktrees)

    repo = _init_repo(tmp_path / "app")
    (repo / ".venv").mkdir()
    (repo / ".venv" / "m").write_text("v")
    now = "2026-07-28T00:00:00Z"
    created = worktrees.create(repo, "feat/y", created_at=now, create_branch=True, session="kb-9")
    wt = Path(created["path"])
    assert (wt / ".venv" / "m").read_text() == "v"  # the dep is there, and the worktree owns it
    assert not (wt / ".venv").is_symlink()
    entry = worktrees.get_entry(wt)
    assert entry["target"] == "kb-9"
    assert entry["created_at"] == now
    assert {r["path"] for r in entry["links_applied"]} == {".venv"}


def test_session_created_worktree_is_registered(tmp_path, monkeypatch):
    """Creating a worktree session records a registry entry + links (integration seam)."""
    monkeypatch.setenv("LUMBERGH_DATA_DIR", str(tmp_path / "cfg"))
    from lumbergh import constants, db_utils
    from lumbergh.routers import sessions

    importlib.reload(constants)
    importlib.reload(db_utils)
    importlib.reload(worktrees)
    importlib.reload(sessions)

    repo = _init_repo(tmp_path / "app")
    (repo / ".venv").mkdir()
    (repo / ".venv" / "m").write_text("v")

    from lumbergh.models import CreateSessionRequest, WorktreeConfig

    body = CreateSessionRequest(
        mode="worktree",
        worktree=WorktreeConfig(parent_repo=str(repo), branch="feat/z", create_branch=True),
    )
    workdir, _parent, _branch = sessions._resolve_worktree_workdir(body)
    assert (Path(workdir) / ".venv" / "m").read_text() == "v"
    assert worktrees.get_entry(Path(workdir)) is not None


@pytest.mark.usefixtures("registry")
def test_record_worktree_persists_kind_and_origin(tmp_path):
    row = worktrees.record_worktree(
        tmp_path / "wt",
        tmp_path / "repo",
        "feat/x",
        "2026-07-28T00:00:00+00:00",
        kind="scout",
        origin="bill",
    )
    assert row["kind"] == "scout"
    assert row["origin"] == "bill"
    assert worktrees.get_entry(tmp_path / "wt")["kind"] == "scout"


@pytest.mark.usefixtures("registry")
def test_record_worktree_defaults_kind_and_origin_to_none(tmp_path):
    row = worktrees.record_worktree(
        tmp_path / "wt", tmp_path / "repo", "feat/x", "2026-07-28T00:00:00+00:00"
    )
    assert row["kind"] is None
    assert row["origin"] is None


@pytest.mark.usefixtures("worktrees_db")
def test_record_worktree_stores_target_and_run(tmp_path):
    row = worktrees.record_worktree(
        path=tmp_path / "wt",
        parent_repo=tmp_path / "repo",
        branch="feat/x",
        created_at="2026-07-30T00:00:00Z",
        target="port:fleet-644",
        run="batch-9",
    )
    assert row["target"] == "port:fleet-644"
    assert row["run"] == "batch-9"


@pytest.mark.usefixtures("worktrees_db")
def test_record_worktree_session_kwarg_back_compat(tmp_path):
    row = worktrees.record_worktree(
        path=tmp_path / "wt2",
        parent_repo=tmp_path / "repo",
        branch="feat/y",
        created_at="2026-07-30T00:00:00Z",
        session="scout-1",
    )
    assert row["target"] == "scout-1"
    assert row["run"] is None


def test_create_threads_target_and_run(tmp_path, monkeypatch):
    monkeypatch.setenv("LUMBERGH_DATA_DIR", str(tmp_path / "cfg"))
    from lumbergh import constants, db_utils

    importlib.reload(constants)
    importlib.reload(db_utils)
    importlib.reload(worktrees)
    repo = _init_repo(tmp_path / "repo")
    created = worktrees.create(
        repo,
        "feat/z",
        created_at="2026-07-30T00:00:00Z",
        create_branch=True,
        target="port:fleet-644",
        run="batch-9",
    )
    entry = worktrees.get_entry(Path(created["path"]))
    assert entry["target"] == "port:fleet-644"
    assert entry["run"] == "batch-9"


def _spawn_orphan_in(cwd: Path, pidfile: Path) -> int:
    """A leftover the way workers really leave one: reparented to init, still holding
    the worktree as its cwd long after the window that started it is gone."""
    script = (
        f"import os, time; open({str(pidfile)!r}, 'w').write(str(os.getpid())); time.sleep(300)"
    )
    subprocess.run(["setsid", "--fork", sys.executable, "-c", script], cwd=str(cwd), check=True)
    for _ in range(200):
        if pidfile.exists() and pidfile.read_text():
            return int(pidfile.read_text())
        time.sleep(0.02)
    raise AssertionError("orphan never reported its pid")


def _pid_alive(pid: int) -> bool:
    return Path(f"/proc/{pid}").exists()


def _wait_gone(pid: int, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not _pid_alive(pid):
            return True
        time.sleep(0.05)
    return False


@pytest.mark.usefixtures("worktrees_db")
def test_reap_kills_processes_the_worker_left_running_in_the_worktree(tmp_path):
    """A test server the worker started outlives its own worktree otherwise: the binary
    keeps a port and a shared-DB connection while its tree is gone from disk."""
    repo = _repo_with_origin(tmp_path)
    wt = tmp_path / "wt"
    _git(repo, "worktree", "add", "-q", "-b", "worker", str(wt), "master")
    server = _spawn_orphan_in(wt, tmp_path / "server.pid")

    try:
        result = worktrees.reap(wt, force=True, rm_branch=True)

        assert result.get("status") == "removed", result
        assert _wait_gone(server)
        assert [p["pid"] for p in result.get("processes_killed", [])] == [server]
    finally:
        if _pid_alive(server):
            os.kill(server, 9)


@pytest.mark.usefixtures("worktrees_db")
def test_reap_readiness_reports_leftover_processes_without_killing_them(tmp_path):
    """`--dry-run` has to show what a real teardown would kill — a silent kill is its own trap."""
    repo = _repo_with_origin(tmp_path)
    wt = tmp_path / "wt"
    _git(repo, "worktree", "add", "-q", "-b", "worker", str(wt), "master")
    server = _spawn_orphan_in(wt, tmp_path / "server.pid")

    try:
        readiness = worktrees.reap_readiness(wt)

        assert [p["pid"] for p in readiness["processes"]] == [server]
        assert _pid_alive(server)
    finally:
        os.kill(server, 9)


def _branches(repo: Path) -> set[str]:
    out = subprocess.run(
        ["git", "-C", str(repo), "branch", "--format=%(refname:short)"],
        check=True,
        capture_output=True,
        text=True,
    )
    return set(out.stdout.split())


@pytest.mark.usefixtures("worktrees_db")
def test_reap_clears_the_branch_of_landed_work(tmp_path):
    """A landed worker's branch outlives its worktree and its registry row, and the next
    todo that slugs to the same name then cannot be launched at all. Nothing needs it once
    the work is in — but only a safe delete, so unlanded work is never taken with it."""
    repo = _repo_with_origin(tmp_path)
    wt = tmp_path / "wt"
    _git(repo, "worktree", "add", "-q", "-b", "worker", str(wt), "master")
    (wt / "work.txt").write_text("done")
    _git(wt, "add", ".")
    _git(wt, "commit", "-qm", "work")
    _git(repo, "merge", "-q", "worker")
    _git(repo, "push", "-q", "origin", "master")

    result = worktrees.reap(wt, force=False)

    assert result.get("status") == "removed", result
    assert result.get("branch_removed") == "worker", result
    assert "worker" not in _branches(repo)


@pytest.mark.usefixtures("worktrees_db")
def test_reap_keeps_the_branch_when_the_work_did_not_land(tmp_path):
    """`--force` throws away the worktree, never the only remaining record of its commits."""
    repo = _repo_with_origin(tmp_path)
    wt = tmp_path / "wt"
    _git(repo, "worktree", "add", "-q", "-b", "worker", str(wt), "master")
    (wt / "work.txt").write_text("done")
    _git(wt, "add", ".")
    _git(wt, "commit", "-qm", "work")

    result = worktrees.reap(wt, force=True)

    assert result.get("status") == "removed", result
    assert result.get("branch_removed") is None, result
    assert "worker" in _branches(repo)
