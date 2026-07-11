"""Shared test fixtures and configuration.

Sets environment variables before any backend modules are imported,
preventing import errors from missing API keys.
"""

import os
import tempfile

# Set required env vars BEFORE any backend imports happen.
# pytest loads conftest.py before test modules, so this runs first.
os.environ.setdefault("OPENROUTER_API_KEY", "test-key-not-real")

# Redirect data writes away from the real ./data directory for the whole
# test session. Any test that accidentally exercises a real I/O code path
# (e.g., the rankings tap point inside the council stream pipeline) writes
# to this temp dir instead of polluting developer state.
# Only allocate a tempdir if the env var isn't already set — otherwise
# CI runners or external orchestrators can pin the location, and we avoid
# leaving orphan tempdirs on every test run.
if "LLMCOUNCIL_DATA_DIR" not in os.environ:
    os.environ["LLMCOUNCIL_DATA_DIR"] = tempfile.mkdtemp(prefix="llmcouncil-tests-")


def build_request(
    method: str = "GET",
    path: str = "/",
    client: tuple[str, int] | None = None,
    headers: dict[str, str] | None = None,
):
    """Build a Starlette Request from a raw ASGI scope with a controlled peer.

    TestClient pins the peer to "testclient", so peer-sensitive tests build the
    scope directly. Imported lazily so this module's env setup still runs before
    any backend/framework import.
    """
    from fastapi import Request

    raw_headers = [
        (name.lower().encode(), value.encode())
        for name, value in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "query_string": b"",
        "headers": raw_headers,
        "client": client,
    }
    return Request(scope)
