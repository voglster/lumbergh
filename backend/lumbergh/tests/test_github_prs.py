"""Open pull requests, as the `gh` CLI sees them."""

import json
import subprocess

import pytest

from lumbergh import github


@pytest.fixture(autouse=True)
def no_cache():
    github.clear_pr_cache()
    yield
    github.clear_pr_cache()


def fake_gh(monkeypatch, *, stdout="[]", returncode=0, exc=None, record=None):
    def run(cmd, **kwargs):
        if record is not None:
            record.append((cmd, kwargs))
        if exc:
            raise exc
        return subprocess.CompletedProcess(cmd, returncode, stdout=stdout, stderr="")

    monkeypatch.setattr(github.subprocess, "run", run)


def test_returns_the_open_prs_gh_reports(monkeypatch, tmp_path):
    payload = json.dumps(
        [
            {
                "number": 412,
                "title": "fix(graph): shorten hashes",
                "state": "OPEN",
                "url": "https://github.com/o/r/pull/412",
                "headRefName": "fix/graph-hash",
                "isDraft": False,
            }
        ]
    )
    fake_gh(monkeypatch, stdout=payload)

    prs = github.list_open_prs(tmp_path)

    assert [p["number"] for p in prs] == [412]
    assert prs[0]["headRefName"] == "fix/graph-hash"


def test_a_repo_without_github_simply_has_no_prs(monkeypatch, tmp_path):
    fake_gh(monkeypatch, stdout="", returncode=1)

    assert github.list_open_prs(tmp_path) == []


def test_a_missing_gh_is_not_an_error(monkeypatch, tmp_path):
    fake_gh(monkeypatch, exc=FileNotFoundError("gh"))

    assert github.list_open_prs(tmp_path) == []


def test_a_hung_gh_gives_up_rather_than_blocking(monkeypatch, tmp_path):
    fake_gh(monkeypatch, exc=subprocess.TimeoutExpired("gh", 10))

    assert github.list_open_prs(tmp_path) == []


def test_garbage_output_is_not_trusted(monkeypatch, tmp_path):
    fake_gh(monkeypatch, stdout="not json at all")

    assert github.list_open_prs(tmp_path) == []


def test_a_second_look_inside_the_ttl_does_not_ask_gh_again(monkeypatch, tmp_path):
    calls = []
    fake_gh(monkeypatch, stdout="[]", record=calls)

    github.list_open_prs(tmp_path)
    github.list_open_prs(tmp_path)

    assert len(calls) == 1


def test_the_cache_expires(monkeypatch, tmp_path):
    calls = []
    fake_gh(monkeypatch, stdout="[]", record=calls)
    clock = [1000.0]
    monkeypatch.setattr(github.time, "monotonic", lambda: clock[0])

    github.list_open_prs(tmp_path)
    clock[0] += github.PR_CACHE_TTL + 1
    github.list_open_prs(tmp_path)

    assert len(calls) == 2


def test_each_repo_is_cached_on_its_own(monkeypatch, tmp_path):
    calls = []
    fake_gh(monkeypatch, stdout="[]", record=calls)
    other = tmp_path / "other"
    other.mkdir()

    github.list_open_prs(tmp_path)
    github.list_open_prs(other)

    assert len(calls) == 2
    assert calls[0][1]["cwd"] == tmp_path


def test_a_repo_with_more_open_prs_than_ghs_default_page_still_sees_them_all(monkeypatch, tmp_path):
    calls = []
    fake_gh(monkeypatch, stdout="[]", record=calls)

    github.list_open_prs(tmp_path)

    cmd = calls[0][0]
    assert "--limit" in cmd
    assert int(cmd[cmd.index("--limit") + 1]) >= 200
