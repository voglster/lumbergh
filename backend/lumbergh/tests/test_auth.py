"""
Unit tests for the auth module.
"""

from lumbergh.auth import _make_token, _verify_token


class TestTokenRoundTrip:
    def test_create_verify(self):
        """Token created by _make_token should be accepted by _verify_token."""
        token = _make_token()
        assert _verify_token(token) is True

    def test_invalid_token_rejected(self):
        """Arbitrary strings should be rejected."""
        assert _verify_token("not-a-valid-token") is False
        assert _verify_token("") is False

    def test_token_is_deterministic(self):
        """Same signing key produces same token (within a process)."""
        t1 = _make_token()
        t2 = _make_token()
        assert t1 == t2
