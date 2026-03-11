"""Todo CRUD and cross-session move tests."""


def test_todos_initially_empty(client, test_session):
    r = client.get(f"/api/sessions/{test_session}/todos")
    assert r.status_code == 200
    assert r.json()["todos"] == []


def test_save_and_get_todos(client, test_session):
    todos = [
        {"text": "First task", "done": False},
        {"text": "Second task", "done": False},
        {"text": "Third task", "done": True},
    ]
    r = client.post(f"/api/sessions/{test_session}/todos", json={"todos": todos})
    assert r.status_code == 200
    assert len(r.json()["todos"]) == 3

    # Verify persisted
    r2 = client.get(f"/api/sessions/{test_session}/todos")
    assert len(r2.json()["todos"]) == 3
    assert r2.json()["todos"][0]["text"] == "First task"
    assert r2.json()["todos"][2]["done"] is True


def test_toggle_todo_done(client, test_session):
    # Get current todos
    r = client.get(f"/api/sessions/{test_session}/todos")
    todos = r.json()["todos"]
    assert len(todos) >= 1

    # Toggle first item
    todos[0]["done"] = not todos[0]["done"]
    r2 = client.post(f"/api/sessions/{test_session}/todos", json={"todos": todos})
    assert r2.status_code == 200
    assert r2.json()["todos"][0]["done"] == todos[0]["done"]


def test_move_todo_between_sessions(client, test_session, second_session):
    # Ensure source has todos
    source_todos = [
        {"text": "Movable task", "done": False},
        {"text": "Stay put", "done": False},
    ]
    client.post(f"/api/sessions/{test_session}/todos", json={"todos": source_todos})

    # Ensure target starts empty
    client.post(f"/api/sessions/{second_session}/todos", json={"todos": []})

    # Move first todo from test_session to second_session
    r = client.post(
        f"/api/sessions/{test_session}/todos/move",
        json={"todo_index": 0, "target_session": second_session},
    )
    assert r.status_code == 200

    # Source should have 1 todo left
    r2 = client.get(f"/api/sessions/{test_session}/todos")
    assert len(r2.json()["todos"]) == 1
    assert r2.json()["todos"][0]["text"] == "Stay put"

    # Target should have the moved todo
    r3 = client.get(f"/api/sessions/{second_session}/todos")
    assert len(r3.json()["todos"]) == 1
    assert r3.json()["todos"][0]["text"] == "Movable task"
    assert r3.json()["todos"][0]["done"] is False  # Reset on move
