"""Tests for pure functions in backend.auth."""

from backend.auth import _is_trusted_ip, _parse_trusted_ips


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
