"""Shared files upload/list/delete tests."""


def test_shared_files_initially_empty(client):
    # Clear first to ensure clean state
    client.delete("/api/shared/files")
    r = client.get("/api/shared/files")
    assert r.status_code == 200
    assert r.json()["files"] == []


def test_upload_and_list_shared_file(client):
    # Upload a text file
    r = client.post(
        "/api/shared/upload",
        files={"file": ("test.txt", b"Hello from e2e test", "text/plain")},
    )
    assert r.status_code == 200
    data = r.json()
    assert "name" in data
    filename = data["name"]

    # List should include our file
    r2 = client.get("/api/shared/files")
    names = [f["name"] for f in r2.json()["files"]]
    assert filename in names


def test_get_shared_file_content(client):
    # Upload a file
    r = client.post(
        "/api/shared/upload",
        files={"file": ("readme.md", b"# Test Content", "text/plain")},
    )
    filename = r.json()["name"]

    # Get its content
    r2 = client.get(f"/api/shared/files/{filename}")
    assert r2.status_code == 200
    assert "Test Content" in r2.json()["content"]


def test_delete_shared_file(client):
    # Upload then delete
    r = client.post(
        "/api/shared/upload",
        files={"file": ("delete-me.txt", b"delete me", "text/plain")},
    )
    filename = r.json()["name"]

    r2 = client.delete(f"/api/shared/files/{filename}")
    assert r2.status_code == 200
    assert r2.json()["status"] == "deleted"

    # Verify gone
    r3 = client.get(f"/api/shared/files/{filename}")
    assert r3.status_code == 404


def test_clear_all_shared_files(client):
    # Upload a couple files
    client.post(
        "/api/shared/upload",
        files={"file": ("a.txt", b"a", "text/plain")},
    )
    client.post(
        "/api/shared/upload",
        files={"file": ("b.txt", b"b", "text/plain")},
    )

    r = client.delete("/api/shared/files")
    assert r.status_code == 200
    assert r.json()["deleted"] >= 2

    r2 = client.get("/api/shared/files")
    assert r2.json()["files"] == []
