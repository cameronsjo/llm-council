"""Tests for pure functions in backend.auth."""

from fastapi import Request
from fastapi.testclient import TestClient

import backend.auth
from backend.auth import (
    _get_client_ip,
    _get_peer_ip,
    _is_trusted_ip,
    _parse_trusted_ips,
    get_current_user,
)


def _build_request(
    client: tuple[str, int] | None,
    headers: dict[str, str] | None = None,
) -> Request:
    """Build a Request from a raw ASGI scope with a controlled peer address.

    TestClient pins the peer to "testclient", so peer-sensitive tests need
    a hand-built scope.
    """
    raw_headers = [
        (name.lower().encode(), value.encode())
        for name, value in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "query_string": b"",
        "headers": raw_headers,
        "client": client,
    }
    return Request(scope)


# ---------------------------------------------------------------------------
# _parse_trusted_ips
# ---------------------------------------------------------------------------

class TestParseTrustedIps:
    """Tests for _parse_trusted_ips."""

    def test_default_ips_parse_correctly(self):
        """Default trusted IPs parse into proper address/network objects."""
        # Clear the lru_cache so we get a fresh parse
        _parse_trusted_ips.cache_clear()

        result = _parse_trusted_ips()

        # Should be a tuple (cached return type)
        assert isinstance(result, tuple)
        # Default has: 127.0.0.1, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
        assert len(result) == 5

    def test_cache_returns_same_object(self):
        """Subsequent calls return cached result (same object)."""
        _parse_trusted_ips.cache_clear()
        first = _parse_trusted_ips()
        second = _parse_trusted_ips()
        assert first is second


# ---------------------------------------------------------------------------
# _is_trusted_ip
# ---------------------------------------------------------------------------

class TestIsTrustedIp:
    """Tests for _is_trusted_ip."""

    def setup_method(self):
        """Clear cache before each test to ensure clean state."""
        _parse_trusted_ips.cache_clear()

    def test_localhost_ipv4_is_trusted(self):
        """127.0.0.1 is trusted (explicit in default list)."""
        assert _is_trusted_ip("127.0.0.1") is True

    def test_localhost_ipv6_is_trusted(self):
        """::1 is trusted (explicit in default list)."""
        assert _is_trusted_ip("::1") is True

    def test_private_10_network_is_trusted(self):
        """10.x.x.x addresses are trusted (in 10.0.0.0/8)."""
        assert _is_trusted_ip("10.1.2.3") is True
        assert _is_trusted_ip("10.255.255.255") is True

    def test_private_192_168_network_is_trusted(self):
        """192.168.x.x addresses are trusted (in 192.168.0.0/16)."""
        assert _is_trusted_ip("192.168.1.1") is True
        assert _is_trusted_ip("192.168.0.1") is True

    def test_private_172_16_network_is_trusted(self):
        """172.16-31.x.x addresses are trusted (in 172.16.0.0/12)."""
        assert _is_trusted_ip("172.16.0.1") is True
        assert _is_trusted_ip("172.31.255.255") is True

    def test_public_ip_is_not_trusted(self):
        """Public IP addresses are not trusted."""
        assert _is_trusted_ip("8.8.8.8") is False
        assert _is_trusted_ip("1.1.1.1") is False

    def test_invalid_ip_returns_false(self):
        """Invalid IP string returns False (does not raise)."""
        assert _is_trusted_ip("not-an-ip") is False
        assert _is_trusted_ip("") is False

    def test_outside_172_range_not_trusted(self):
        """172.32.x.x is outside 172.16.0.0/12 and should not be trusted."""
        assert _is_trusted_ip("172.32.0.1") is False


# ---------------------------------------------------------------------------
# _get_peer_ip — trust must key on the TCP peer, never X-Forwarded-For
# ---------------------------------------------------------------------------

class TestGetPeerIp:
    """Tests for _get_peer_ip."""

    def test_returns_socket_peer(self):
        """Peer IP comes from the connection scope's client address."""
        request = _build_request(client=("203.0.113.9", 12345))
        assert _get_peer_ip(request) == "203.0.113.9"

    def test_ignores_x_forwarded_for(self):
        """A spoofed X-Forwarded-For header does not change the peer IP."""
        request = _build_request(
            client=("203.0.113.9", 12345),
            headers={"X-Forwarded-For": "127.0.0.1"},
        )
        assert _get_peer_ip(request) == "203.0.113.9"

    def test_no_client_returns_empty(self):
        """A scope without a client address yields an empty string."""
        request = _build_request(client=None)
        assert _get_peer_ip(request) == ""

    def test_client_ip_still_reads_xff_for_audit(self):
        """_get_client_ip (audit logging) still surfaces the claimed client."""
        request = _build_request(
            client=("203.0.113.9", 12345),
            headers={"X-Forwarded-For": "198.51.100.7, 10.0.0.1"},
        )
        assert _get_client_ip(request) == "198.51.100.7"


# ---------------------------------------------------------------------------
# get_current_user — the #40 attack case and the legitimate-proxy case
# ---------------------------------------------------------------------------

class TestXffBypass:
    """Regression tests for issue #40 (X-Forwarded-For auth bypass)."""

    def test_spoofed_xff_does_not_authenticate(self, monkeypatch):
        """Attack case: untrusted peer + spoofed XFF + Remote-User stays anonymous.

        AUTH_ENABLED is an import-time constant, so the attribute (not the
        env var) must be patched. /api/user uses get_optional_user, so the
        proof is the response body, not the status code.
        """
        monkeypatch.setattr(backend.auth, "AUTH_ENABLED", True)
        from backend.main import app

        client = TestClient(app)
        response = client.get(
            "/api/user",
            headers={
                "X-Forwarded-For": "127.0.0.1",
                "Remote-User": "ghost",
            },
        )

        assert response.status_code == 200
        # TestClient's peer is "testclient" — untrusted — so the spoofed
        # XFF must no longer grant trust.
        assert response.json() == {"authenticated": False}

    async def test_trusted_peer_authenticates(self, monkeypatch):
        """Positive case: a trusted TCP peer's auth headers are honored."""
        monkeypatch.setattr(backend.auth, "AUTH_ENABLED", True)
        request = _build_request(
            client=("127.0.0.1", 54321),
            headers={
                "Remote-User": "alice",
                "Remote-Email": "alice@example.com",
                "Remote-Groups": "developers, admin",
            },
        )

        user = await get_current_user(request)

        assert user is not None
        assert user.username == "alice"
        assert user.email == "alice@example.com"
        assert user.groups == ["developers", "admin"]

    async def test_untrusted_peer_with_headers_gets_none(self, monkeypatch):
        """An untrusted peer presenting auth headers is rejected."""
        monkeypatch.setattr(backend.auth, "AUTH_ENABLED", True)
        request = _build_request(
            client=("203.0.113.9", 12345),
            headers={"Remote-User": "ghost"},
        )

        assert await get_current_user(request) is None
