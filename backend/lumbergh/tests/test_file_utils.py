"""
Unit tests for file_utils module.
"""

import os
from pathlib import Path

import pytest

from lumbergh.file_utils import get_file_language, list_directory, validate_path_within_root


class TestValidatePathWithinRoot:
    def test_valid_path(self, temp_dir):
        """A child path should be accepted."""
        child = temp_dir / "sub" / "file.txt"
        child.parent.mkdir(parents=True, exist_ok=True)
        child.touch()
        assert validate_path_within_root(child, temp_dir) is True

    def test_path_traversal_blocked(self, temp_dir):
        """Path traversal via .. should be blocked."""
        bad_path = temp_dir / ".." / ".." / "etc" / "passwd"
        assert validate_path_within_root(bad_path, temp_dir) is False

    def test_symlink_escape_blocked(self, temp_dir):
        """Symlink pointing outside root should be blocked."""
        link = temp_dir / "escape"
        link.symlink_to("/etc")
        target = link / "passwd"
        assert validate_path_within_root(target, temp_dir) is False

    def test_root_itself_valid(self, temp_dir):
        """Root path itself should be valid (it is within itself)."""
        assert validate_path_within_root(temp_dir, temp_dir) is True


class TestGetFileLanguage:
    def test_returns_bare_extension(self):
        assert get_file_language("main.py") == "py"
        assert get_file_language("App.tsx") == "tsx"
        assert get_file_language("login.feature") == "feature"

    def test_unrecognized_extension_still_passed_through(self):
        assert get_file_language("data.xyz123") == "xyz123"

    def test_no_extension(self):
        assert get_file_language("Makefile") == "text"

    def test_case_insensitive(self):
        assert get_file_language("README.MD") == "md"

    def test_path_object(self):
        assert get_file_language(Path("src/app.ts")) == "ts"


class TestListDirectory:
    def test_returns_only_immediate_children(self, temp_dir):
        """Nothing below the requested level appears in the result."""
        (temp_dir / "a.txt").write_text("a")
        (temp_dir / "sub").mkdir()
        (temp_dir / "sub" / "b.txt").write_text("b")
        paths = {e["path"] for e in list_directory(temp_dir)}
        assert paths == {"a.txt", "sub"}

    def test_child_paths_are_relative_to_root(self, temp_dir):
        """A nested listing reports paths relative to root, not to rel_path."""
        (temp_dir / "sub").mkdir()
        (temp_dir / "sub" / "b.txt").write_text("b")
        assert [e["path"] for e in list_directory(temp_dir, "sub")] == ["sub/b.txt"]

    def test_does_not_descend(self, temp_dir, monkeypatch):
        """The regression test: listing one level scans exactly one directory.

        On the old rglob implementation this fails, because the walk descends
        into node_modules before the ignore filter is applied.
        """
        (temp_dir / "node_modules").mkdir()
        for i in range(5):
            pkg = temp_dir / "node_modules" / f"pkg{i}"
            pkg.mkdir()
            (pkg / "index.js").write_text("x")
        (temp_dir / "src").mkdir()
        (temp_dir / "src" / "app.ts").write_text("x")

        real_scandir = os.scandir
        calls: list[str] = []

        def counting_scandir(path):
            calls.append(str(path))
            return real_scandir(path)

        monkeypatch.setattr(os, "scandir", counting_scandir)
        list_directory(temp_dir)
        assert len(calls) == 1

    def test_ignored_dirs_excluded(self, temp_dir):
        (temp_dir / "node_modules").mkdir()
        (temp_dir / "__pycache__").mkdir()
        (temp_dir / "src").mkdir()
        assert {e["path"] for e in list_directory(temp_dir)} == {"src"}

    def test_directories_sort_before_files(self, temp_dir):
        (temp_dir / "zebra").mkdir()
        (temp_dir / "alpha.txt").write_text("a")
        assert [e["path"] for e in list_directory(temp_dir)] == ["zebra", "alpha.txt"]

    def test_names_sort_case_insensitively(self, temp_dir):
        for name in ("Banana.txt", "apple.txt", "Cherry.txt"):
            (temp_dir / name).write_text("x")
        assert [e["path"] for e in list_directory(temp_dir)] == [
            "apple.txt",
            "Banana.txt",
            "Cherry.txt",
        ]

    def test_unstattable_entry_is_skipped(self, temp_dir):
        """A dangling symlink exercises the same path as a mid-scan deletion.

        is_dir() returns False for a broken link, then stat() follows it and
        raises FileNotFoundError -- the OSError branch that also covers an
        entry deleted between scandir and stat. Tested this way because
        os.DirEntry is a C type and rejects monkeypatching.
        """
        (temp_dir / "keep.txt").write_text("keep")
        (temp_dir / "dangling").symlink_to(temp_dir / "does_not_exist")
        assert [e["path"] for e in list_directory(temp_dir)] == ["keep.txt"]

    def test_size_is_none_for_directories(self, temp_dir):
        (temp_dir / "sub").mkdir()
        (temp_dir / "f.txt").write_text("hello")
        by_path = {e["path"]: e for e in list_directory(temp_dir)}
        assert by_path["sub"]["size"] is None
        assert by_path["sub"]["type"] == "directory"
        assert by_path["f.txt"]["size"] == 5
        assert by_path["f.txt"]["type"] == "file"

    def test_traversal_raises_permission_error(self, temp_dir):
        with pytest.raises(PermissionError):
            list_directory(temp_dir, "../..")

    def test_absolute_path_raises_permission_error(self, temp_dir):
        """pathlib discards the left operand when the right is absolute."""
        with pytest.raises(PermissionError):
            list_directory(temp_dir, "/etc")

    def test_symlink_escape_raises_permission_error(self, temp_dir):
        (temp_dir / "escape").symlink_to("/etc")
        with pytest.raises(PermissionError):
            list_directory(temp_dir, "escape")

    def test_missing_path_raises_file_not_found(self, temp_dir):
        with pytest.raises(FileNotFoundError):
            list_directory(temp_dir, "no_such_dir")

    def test_file_as_path_raises_not_a_directory(self, temp_dir):
        (temp_dir / "f.txt").write_text("x")
        with pytest.raises(NotADirectoryError):
            list_directory(temp_dir, "f.txt")

    def test_ignored_dir_is_addressable_explicitly(self, temp_dir):
        """IGNORE_DIRS governs browsing, not access."""
        (temp_dir / "node_modules").mkdir()
        (temp_dir / "node_modules" / "pkg").mkdir()
        assert [e["path"] for e in list_directory(temp_dir, "node_modules")] == ["node_modules/pkg"]
