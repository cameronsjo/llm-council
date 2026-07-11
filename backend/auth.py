"""Authentication module for reverse proxy header-based auth.

Supports Authelia, OAuth2 Proxy, and similar reverse proxy authentication
systems that pass user identity via trusted headers.
"""

import logging
import os
from dataclasses import dataclass, field
from functools import lru_cache
from ipaddress import IPv4Address, IPv4Network, IPv6Address, IPv6Network, ip_address, ip_network

from fastapi import HTTPException, Request, status

logger = logging.getLogger(__name__)

# Environment configuration
AUTH_ENABLED = os.getenv("LLMCOUNCIL_AUTH_ENABLED", "false").lower() == "true"

# Trusted proxy IPs - only accept auth headers from these sources
# Supports individual IPs and CIDR notation
TRUSTED_PROXY_IPS = os.getenv(
    "LLMCOUNCIL_TRUSTED_PROXY_IPS",
    "127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
)

# Header names (Authelia/OAuth2 Proxy standard)
REMOTE_USER_HEADER = "Remote-User"
REMOTE_GROUPS_HEADER = "Remote-Groups"
REMOTE_EMAIL_HEADER = "Remote-Email"
REMOTE_NAME_HEADER = "Remote-Name"


@dataclass
class User:
    """Authenticated user from reverse proxy headers."""

    username: str
    email: str | None = None
    groups: list[str] = field(default_factory=list)
    display_name: str | None = None


@lru_cache(maxsize=1)
def _parse_trusted_ips() -> tuple:
    """Parse trusted proxy IPs from environment variable.

    Returns:
        Tuple of ip_address or ip_network objects
    """
    trusted = []
    for ip_str in TRUSTED_PROXY_IPS.split(","):
        ip_str = ip_str.strip()
        if not ip_str:
            continue
        try:
            if "/" in ip_str:
                trusted.append(ip_network(ip_str, strict=False))
            else:
                trusted.append(ip_address(ip_str))
        except ValueError:
            logger.warning("Invalid IP/CIDR in LLMCOUNCIL_TRUSTED_PROXY_IPS: %s", ip_str)
    return tuple(trusted)


def reload_trusted_proxy_ips() -> str:
    """Re-read the trusted-proxy list from the environment and drop its cache.

    Owns the cache-invalidation contract so callers (e.g. config.reload_config)
    don't reach into this module's internals: TRUSTED_PROXY_IPS is frozen at
    import and _parse_trusted_ips is lru_cache'd, so a reload must reassign the
    module var AND clear the cache — clearing alone would re-parse the stale
    value. A reload with the env var absent keeps the current value.

    Returns:
        The effective trusted-proxy IPs string after the reload
    """
    global TRUSTED_PROXY_IPS
    TRUSTED_PROXY_IPS = os.getenv("LLMCOUNCIL_TRUSTED_PROXY_IPS", TRUSTED_PROXY_IPS)
    _parse_trusted_ips.cache_clear()
    return TRUSTED_PROXY_IPS


def _is_trusted_ip(client_ip: str) -> bool:
    """Check if client IP is in the trusted proxy list.

    Args:
        client_ip: The client IP address string

    Returns:
        True if IP is trusted, False otherwise
    """
    trusted_list = _parse_trusted_ips()

    try:
        client = ip_address(client_ip)
    except ValueError:
        logger.warning("Invalid client IP: %s", client_ip)
        return False

    for trusted in trusted_list:
        if isinstance(trusted, (IPv4Network, IPv6Network)):
            if client in trusted:
                return True
        elif isinstance(trusted, (IPv4Address, IPv6Address)):
            if client == trusted:
                return True

    return False


def _get_peer_ip(request: Request) -> str:
    """Extract the immediate TCP peer's IP address.

    This is the value trust decisions key on: the peer address comes from
    the socket, not from request headers. This holds only while uvicorn's
    proxy-header handling is off (the entrypoint pins ``proxy_headers=False``);
    with it on, uvicorn overwrites ``scope["client"]`` from X-Forwarded-For
    for peers in ``forwarded_allow_ips``, which would make the peer IP
    spoofable and reopen the bypass. X-Forwarded-For is a client-supplied
    claim — never use it to decide trust (see _get_client_ip for its
    audit-logging role).

    Args:
        request: FastAPI request object

    Returns:
        Peer IP address string, or "" when unavailable
    """
    if request.client:
        return request.client.host
    return ""


def _get_client_ip(request: Request) -> str:
    """Extract the claimed client IP for audit logging only.

    Returns the leftmost X-Forwarded-For value — the original client as
    claimed by whoever set the header. Attacker-controlled, so this is
    for log visibility only; trust decisions use _get_peer_ip.

    Args:
        request: FastAPI request object

    Returns:
        Claimed client IP address string
    """
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # Leftmost entry: the original client per the header's own claim
        return forwarded.split(",")[0].strip()

    # Fall back to direct client
    if request.client:
        return request.client.host

    return ""


async def get_current_user(request: Request) -> User | None:
    """Extract user from trusted proxy headers.

    Only returns a User if:
    1. AUTH_ENABLED is True
    2. Request comes from a trusted proxy IP
    3. Remote-User header is present

    Args:
        request: FastAPI request object

    Returns:
        User object if authenticated, None otherwise
    """
    if not AUTH_ENABLED:
        return None

    # Trust keys on the TCP peer, never on X-Forwarded-For — the header
    # is attacker-controlled and was previously spoofable for a full
    # auth bypass (any peer claiming an in-range XFF passed the gate).
    peer_ip = _get_peer_ip(request)

    if not _is_trusted_ip(peer_ip):
        logger.warning(
            "Auth headers received from untrusted peer: %s "
            "(claimed client: %s, trusted: %s)",
            peer_ip,
            _get_client_ip(request),
            TRUSTED_PROXY_IPS,
        )
        return None

    username = request.headers.get(REMOTE_USER_HEADER)
    if not username:
        return None

    # Parse groups (comma-separated)
    groups_str = request.headers.get(REMOTE_GROUPS_HEADER, "")
    groups = [g.strip() for g in groups_str.split(",") if g.strip()]

    return User(
        username=username,
        email=request.headers.get(REMOTE_EMAIL_HEADER),
        groups=groups,
        display_name=request.headers.get(REMOTE_NAME_HEADER),
    )


async def require_auth(request: Request) -> User:
    """Dependency that requires authentication.

    Use this for routes that MUST have an authenticated user.

    Args:
        request: FastAPI request object

    Returns:
        Authenticated User object

    Raises:
        HTTPException: 401 if not authenticated
    """
    user = await get_current_user(request)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def get_optional_user(request: Request) -> User | None:
    """Dependency for optional authentication.

    Returns User if auth is enabled and user is authenticated,
    None otherwise. Does not raise exceptions.

    Args:
        request: FastAPI request object

    Returns:
        User object if authenticated, None otherwise
    """
    return await get_current_user(request)
