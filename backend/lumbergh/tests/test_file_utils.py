"""
Unit tests for file_utils module.
"""

from pathlib import Path

from lumbergh.file_utils import get_file_language, validate_path_within_root


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
    def test_python(self):
        assert get_file_language("main.py") == "python"

    def test_typescript(self):
        assert get_file_language("App.tsx") == "tsx"

    def test_javascript(self):
        assert get_file_language("index.js") == "javascript"

    def test_unknown_extension(self):
        assert get_file_language("data.xyz123") == "text"

    def test_no_extension(self):
        assert get_file_language("Makefile") == "text"

    def test_case_insensitive(self):
        assert get_file_language("README.MD") == "markdown"

    def test_path_object(self):
        assert get_file_language(Path("src/app.ts")) == "typescript"
