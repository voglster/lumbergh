"""Video files in the shared folder: naming, media type, and seekable delivery."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from lumbergh.main import app

    return TestClient(app)


@pytest.fixture
def shared_dir(temp_dir, monkeypatch):
    d = temp_dir / "shared"
    d.mkdir()
    monkeypatch.setattr("lumbergh.routers.shared.SHARED_DIR", d)
    return d


class TestVideoUpload:
    def test_video_gets_its_own_filename_prefix(self, client, shared_dir):
        r = client.post(
            "/api/shared/upload",
            files={"file": ("clip.mp4", b"\x00\x00\x00 ftypmp42", "video/mp4")},
        )

        assert r.status_code == 200
        name = r.json()["name"]
        assert name.startswith("video_")
        assert name.endswith(".mp4")
        assert (shared_dir / name).exists()

    def test_image_still_gets_the_screenshot_prefix(self, client, shared_dir):
        r = client.post(
            "/api/shared/upload",
            files={"file": ("shot.png", b"\x89PNG", "image/png")},
        )

        assert r.json()["name"].startswith("screenshot_")
        assert (shared_dir / r.json()["name"]).exists()

    def test_other_files_still_get_the_generic_prefix(self, client, shared_dir):
        r = client.post(
            "/api/shared/upload",
            files={"file": ("notes.md", b"# hi", "text/markdown")},
        )

        assert r.json()["name"].startswith("file_")
        assert (shared_dir / r.json()["name"]).exists()


class TestVideoDelivery:
    def test_served_with_a_video_media_type(self, client, shared_dir):
        (shared_dir / "clip.mp4").write_bytes(b"0123456789")

        r = client.get("/api/shared/files/clip.mp4/content")

        assert r.status_code == 200
        assert r.headers["content-type"] == "video/mp4"

    def test_range_request_returns_just_that_slice(self, client, shared_dir):
        (shared_dir / "clip.mp4").write_bytes(b"0123456789")

        r = client.get("/api/shared/files/clip.mp4/content", headers={"Range": "bytes=2-5"})

        assert r.status_code == 206
        assert r.content == b"2345"
        assert r.headers["content-range"] == "bytes 2-5/10"
