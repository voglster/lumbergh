"""Scratchpad read/write tests."""


def test_scratchpad_initially_empty(client, test_session):
    r = client.get(f"/api/sessions/{test_session}/scratchpad")
    assert r.status_code == 200
    assert r.json()["content"] == ""


def test_save_and_get_scratchpad(client, test_session):
    content = "# Notes\n\nSome planning notes for the session."
    r = client.post(
        f"/api/sessions/{test_session}/scratchpad",
        json={"content": content},
    )
    assert r.status_code == 200
    assert r.json()["content"] == content

    # Verify persisted
    r2 = client.get(f"/api/sessions/{test_session}/scratchpad")
    assert r2.json()["content"] == content
