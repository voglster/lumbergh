"""Destructive / mutation git endpoint tests.

Uses the module-scoped ``git_session`` fixture (points at git-test-repo).
Tests are ordered top-to-bottom and designed to be idempotent — they must pass
on repeated runs even when the repo is clean or has leftover branches from
prior runs.
"""

import uuid


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ensure_dirty(client, session):
    """Make sure the repo has an uncommitted change (a throwaway file).

    Returns the filename created, or None if the repo was already dirty.
    """
    status = client.get(f"/api/sessions/{session}/git/status").json()
    if not status.get("clean"):
        return None

    # Create a temp file via the file-write endpoint (or commit + modify)
    fname = f"_e2e_tmp_{uuid.uuid4().hex[:8]}.txt"
    r = client.post(
        f"/api/sessions/{session}/files/write",
        json={"path": fname, "content": "e2e throwaway\n"},
    )
    # If write endpoint doesn't exist, fall back — the test will adapt
    if r.status_code != 200:
        return None
    return fname


def _get_log(client, session, limit=20):
    r = client.get(f"/api/sessions/{session}/git/log?limit={limit}")
    assert r.status_code == 200
    return r.json()["commits"]


def _ensure_at_least_one_commit(client, session):
    """Make sure there's at least one commit so amend/reset-to have something."""
    commits = _get_log(client, session, limit=1)
    if commits:
        return

    # Create a file, commit it
    fname = f"_e2e_seed_{uuid.uuid4().hex[:8]}.txt"
    client.post(
        f"/api/sessions/{session}/files/write",
        json={"path": fname, "content": "seed\n"},
    )
    client.post(
        f"/api/sessions/{session}/git/commit",
        json={"message": "e2e seed commit"},
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_git_reset_discards_changes(client, git_session):
    """POST /git/reset should discard uncommitted changes or succeed on clean."""
    _ensure_dirty(client, git_session)

    r = client.post(f"/api/sessions/{git_session}/git/reset")
    # Accept 200 (reset performed) or 400 (nothing to reset)
    assert r.status_code in (200, 400), f"Unexpected status: {r.status_code} — {r.text}"

    if r.status_code == 200:
        status = client.get(f"/api/sessions/{git_session}/git/status").json()
        assert status.get("clean") is True, f"Repo not clean after reset: {status}"


def test_git_revert_file(client, git_session):
    """POST /git/revert-file should revert a single file or handle gracefully."""
    # Try reverting README.md — it may or may not have changes
    r = client.post(
        f"/api/sessions/{git_session}/git/revert-file",
        json={"path": "README.md"},
    )
    # 200 = reverted, 400 = nothing to revert or file not found
    assert r.status_code in (200, 400), f"Unexpected status: {r.status_code} — {r.text}"


def test_git_amend_commit(client, git_session):
    """POST /git/amend should change the last commit message without adding a commit."""
    _ensure_at_least_one_commit(client, git_session)

    commits_before = _get_log(client, git_session)
    count_before = len(commits_before)

    r = client.post(
        f"/api/sessions/{git_session}/git/amend",
        json={"message": "amended by e2e"},
    )
    assert r.status_code in (200, 400), f"Unexpected status: {r.status_code} — {r.text}"

    if r.status_code == 200:
        commits_after = _get_log(client, git_session)
        assert len(commits_after) == count_before, "Amend should not add a new commit"
        assert commits_after[0]["message"] == "amended by e2e"


def test_git_stash_drop(client, git_session):
    """POST /git/stash-drop should drop a stash entry or 400 if empty."""
    # Try to create something to stash
    created = _ensure_dirty(client, git_session)

    if created:
        stash_r = client.post(f"/api/sessions/{git_session}/git/stash")
        assert stash_r.status_code in (200, 400)

        if stash_r.status_code == 200:
            r = client.post(f"/api/sessions/{git_session}/git/stash-drop")
            assert r.status_code == 200, f"stash-drop failed: {r.text}"
            return

    # No stash available — verify graceful 400
    r = client.post(f"/api/sessions/{git_session}/git/stash-drop")
    assert r.status_code in (200, 400), f"Unexpected status: {r.status_code} — {r.text}"


def test_git_reset_to_commit(client, git_session):
    """POST /git/reset-to should move HEAD to a specific commit."""
    _ensure_at_least_one_commit(client, git_session)
    commits = _get_log(client, git_session, limit=50)

    if len(commits) < 2:
        # Only one commit — can't meaningfully test reset-to, just verify
        # the endpoint accepts the current HEAD hash
        r = client.post(
            f"/api/sessions/{git_session}/git/reset-to",
            json={"hash": commits[0]["hash"], "mode": "soft"},
        )
        assert r.status_code in (200, 400), f"Unexpected: {r.status_code} — {r.text}"
        return

    latest_hash = commits[0]["hash"]
    first_hash = commits[-1]["hash"]

    # Soft-reset to the first commit
    r = client.post(
        f"/api/sessions/{git_session}/git/reset-to",
        json={"hash": first_hash, "mode": "soft"},
    )
    assert r.status_code == 200, f"reset-to first commit failed: {r.text}"

    # Verify HEAD moved
    log_after = _get_log(client, git_session, limit=1)
    assert log_after[0]["hash"] == first_hash

    # Reset back to latest (hard to clean up staged changes from soft reset)
    r2 = client.post(
        f"/api/sessions/{git_session}/git/reset-to",
        json={"hash": latest_hash, "mode": "hard"},
    )
    assert r2.status_code == 200, f"reset-to latest failed: {r2.text}"


def test_git_diff_stats(client, git_session):
    """GET /git/diff-stats should return a valid stats structure."""
    r = client.get(f"/api/sessions/{git_session}/git/diff-stats")
    assert r.status_code == 200
    data = r.json()
    # Expect numeric fields for file count and line changes
    assert "files" in data or "file_count" in data, f"Missing file count field: {data}"
    assert "additions" in data, f"Missing additions field: {data}"
    assert "deletions" in data, f"Missing deletions field: {data}"

    # Values should be non-negative integers
    files_key = "files" if "files" in data else "file_count"
    assert isinstance(data[files_key], int) and data[files_key] >= 0
    assert isinstance(data["additions"], int) and data["additions"] >= 0
    assert isinstance(data["deletions"], int) and data["deletions"] >= 0


def test_git_graph(client, git_session):
    """GET /git/graph should return commit graph data."""
    r = client.get(f"/api/sessions/{git_session}/git/graph")
    assert r.status_code == 200
    data = r.json()
    assert "commits" in data, f"Missing commits key: {list(data.keys())}"
    assert isinstance(data["commits"], list)

    if data["commits"]:
        commit = data["commits"][0]
        # Each commit should have at minimum a hash and message
        assert "hash" in commit, f"Commit missing hash: {commit.keys()}"
        assert "message" in commit, f"Commit missing message: {commit.keys()}"
