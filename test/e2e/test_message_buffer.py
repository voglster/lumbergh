"""Message buffer endpoint tests."""


def test_message_buffer_initially_empty(client, test_session):
    """GET message-buffer returns 200 with an empty or valid messages list."""
    r = client.get(f"/api/sessions/{test_session}/message-buffer")
    assert r.status_code == 200
    data = r.json()
    assert "messages" in data
    assert isinstance(data["messages"], list)


def test_clear_message_buffer(client, test_session):
    """DELETE message-buffer returns 200 and reports cleared status."""
    r = client.delete(f"/api/sessions/{test_session}/message-buffer")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "cleared"

    # Verify buffer is empty after clearing
    r2 = client.get(f"/api/sessions/{test_session}/message-buffer")
    assert r2.status_code == 200
    assert r2.json()["messages"] == []
