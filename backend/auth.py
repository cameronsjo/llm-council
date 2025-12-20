"""Authentication module for reverse proxy header-based auth.

Supports Authelia, OAuth2 Proxy, and similar reverse proxy authentication
systems that pass user identity via trusted headers.
"""

import logging
import os
from dataclasses import dataclass, field
from ipaddress import ip_address, ip_network
from typing import List, Optional

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
    email: Optional[str] = None
    groups: List[str] = field(default_factory=list)
    display_name: Optional[str] = None


def _parse_trusted_ips() -> List:
    """Parse trusted proxy IPs from environment variable.

    Returns:
        List of ip_address or ip_network objects
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
    return trusted


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
        if hasattr(trusted, "network_address"):
            # It's a network
            if client in trusted:
                return True
        elif client == trusted:
            return True

    return False


def _get_client_ip(request: Request) -> str:
    """Extract client IP from request, respecting X-Forwarded-For.

    Args:
        request: FastAPI request object

    Returns:
        Client IP address string
    """
    # Check X-Forwarded-For header (leftmost is original client)
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # Get the rightmost IP that we didn't add (the reverse proxy's view of client)
        # In a typical setup: client -> nginx -> app
        # X-Forwarded-For would be: original_client, ...
        return forwarded.split(",")[0].strip()

    # Fall back to direct client
    if request.client:
        return request.client.host

    return ""


async def get_current_user(request: Request) -> Optional[User]:
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

    client_ip = _get_client_ip(request)

    if not _is_trusted_ip(client_ip):
        logger.warning(
            "Auth headers received from untrusted IP: %s (trusted: %s)",
            client_ip,
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


async def get_optional_user(request: Request) -> Optional[User]:
    """Dependency for optional authentication.

    Returns User if auth is enabled and user is authenticated,
    None otherwise. Does not raise exceptions.

    Args:
        request: FastAPI request object

    Returns:
        User object if authenticated, None otherwise
    """
    return await get_current_user(request)
