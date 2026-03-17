"""Advanced git operation tests.

Tests branch deletion, reword, cherry-pick, and graceful error paths
for remote-dependent operations (pull, force-push, rebase, fast-forward).
Uses the module-scoped ``git_session`` fixture (points at git-test-repo).
"""

import uuid


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ensure_at_least_one_commit(client, session):
    """Make sure there's at least one commit."""
    r = client.get(f"/api/sessions/{session}/git/log?limit=1")
    assert r.status_code == 200
    if r.json()["commits"]:
        return
    fname = f"_e2e_seed_{uuid.uuid4().hex[:8]}.txt"
    client.post(
        f"/api/sessions/{session}/files/write",
        json={"path": fname, "content": "seed\n"},
    )
    client.post(
        f"/api/sessions/{session}/git/commit",
        json={"message": "e2e seed commit"},
    )


def _get_log(client, session, limit=20):
    r = client.get(f"/api/sessions/{session}/git/log?limit={limit}")
    assert r.status_code == 200
    return r.json()["commits"]


def _get_branches(client, session):
    r = client.get(f"/api/sessions/{session}/git/branches")
    assert r.status_code == 200
    return r.json()


# ---------------------------------------------------------------------------
# Tests — Branch operations
# ---------------------------------------------------------------------------


def test_git_delete_branch(client, git_session):
    """Create a branch, delete it, verify gone."""
    branch_name = f"e2e-delete-{uuid.uuid4().hex[:8]}"

    # Create a branch
    r = client.post(
        f"/api/sessions/{git_session}/git/create-branch",
        json={"name": branch_name},
    )
    assert r.status_code == 200, f"create-branch failed: {r.text}"

    # Verify it exists
    branches = _get_branches(client, git_session)
    local_names = [b["name"] for b in branches.get("local", branches.get("branches", []))]
    assert branch_name in local_names, f"Branch {branch_name} not found in {local_names}"

    # Delete it
    r = client.post(
        f"/api/sessions/{git_session}/git/delete-branch",
        json={"branch": branch_name},
    )
    assert r.status_code == 200, f"delete-branch failed: {r.text}"

    # Verify gone
    branches = _get_branches(client, git_session)
    local_names = [b["name"] for b in branches.get("local", branches.get("branches", []))]
    assert branch_name not in local_names


def test_git_reword_commit(client, git_session):
    """Reword HEAD commit message, verify in log."""
    _ensure_at_least_one_commit(client, git_session)

    commits = _get_log(client, git_session, limit=1)
    head_hash = commits[0]["hash"]
    new_message = f"reworded by e2e {uuid.uuid4().hex[:8]}"

    r = client.post(
        f"/api/sessions/{git_session}/git/reword",
        json={"hash": head_hash, "message": new_message},
    )
    assert r.status_code == 200, f"reword failed: {r.text}"

    # Verify message changed (hash will change too due to reword)
    commits_after = _get_log(client, git_session, limit=1)
    assert commits_after[0]["message"] == new_message


def test_git_cherry_pick(client, git_session):
    """Create branch with a unique commit, cherry-pick it onto the main branch."""
    _ensure_at_least_one_commit(client, git_session)

    # Get current branch
    branches = _get_branches(client, git_session)
    current = branches.get("current", "main")

    # First, make a commit on the current branch so the side branch diverges
    marker = uuid.uuid4().hex[:8]
    fname_main = f"_main_marker_{marker}.txt"
    client.post(
        f"/api/sessions/{git_session}/files/write",
        json={"path": fname_main, "content": f"main marker {marker}\n"},
    )
    client.post(
        f"/api/sessions/{git_session}/git/commit",
        json={"message": f"main marker {marker}"},
    )

    # Create a side branch from the commit BEFORE the marker
    commits = _get_log(client, git_session, limit=5)
    base_hash = commits[1]["hash"] if len(commits) > 1 else commits[0]["hash"]

    side_branch = f"e2e-cherry-{marker}"
    r = client.post(
        f"/api/sessions/{git_session}/git/create-branch",
        json={"name": side_branch, "start_point": base_hash},
    )
    assert r.status_code == 200

    # Checkout the side branch
    r = client.post(
        f"/api/sessions/{git_session}/git/checkout",
        json={"branch": side_branch},
    )
    assert r.status_code == 200

    # Create a unique file and commit on the side branch
    fname = f"_cherry_{marker}.txt"
    client.post(
        f"/api/sessions/{git_session}/files/write",
        json={"path": fname, "content": f"cherry-pick me {marker}\n"},
    )
    r = client.post(
        f"/api/sessions/{git_session}/git/commit",
        json={"message": f"cherry commit {fname}"},
    )
    assert r.status_code == 200

    # Get the commit hash
    cherry_hash = _get_log(client, git_session, limit=1)[0]["hash"]

    # Switch back to original branch
    r = client.post(
        f"/api/sessions/{git_session}/git/checkout",
        json={"branch": current},
    )
    assert r.status_code == 200

    # Cherry-pick
    r = client.post(
        f"/api/sessions/{git_session}/git/cherry-pick",
        json={"hash": cherry_hash},
    )
    assert r.status_code in (200, 409), f"cherry-pick failed unexpectedly: {r.status_code} — {r.text}"

    if r.status_code == 200:
        # Verify the commit message appears in log
        commits = _get_log(client, git_session, limit=5)
        messages = [c["message"] for c in commits]
        assert any(f"cherry commit {fname}" in m for m in messages)

    # Cleanup: delete the side branch
    client.post(
        f"/api/sessions/{git_session}/git/delete-branch",
        json={"branch": side_branch},
    )


# ---------------------------------------------------------------------------
# Tests — Graceful error paths (no remote configured)
# ---------------------------------------------------------------------------


def test_git_pull_no_remote(client, git_session):
    """Pull without a remote should return 400."""
    r = client.post(f"/api/sessions/{git_session}/git/pull")
    assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"


def test_git_force_push_no_remote(client, git_session):
    """Force push without a remote should return 400."""
    r = client.post(f"/api/sessions/{git_session}/git/force-push")
    assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"


def test_git_rebase_no_target(client, git_session):
    """Rebase with a nonexistent target branch should return 400."""
    r = client.post(
        f"/api/sessions/{git_session}/git/rebase",
        json={"branch": "nonexistent-branch-xyz"},
    )
    assert r.status_code in (400, 409), f"Expected 400/409, got {r.status_code}: {r.text}"


def test_git_fast_forward_no_remote(client, git_session):
    """Fast-forward with no remote branch should return 400."""
    r = client.post(
        f"/api/sessions/{git_session}/git/fast-forward",
        json={"branch": "origin/nonexistent"},
    )
    assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
