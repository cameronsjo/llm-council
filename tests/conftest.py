"""Shared test fixtures and configuration.

Sets environment variables before any backend modules are imported,
preventing import errors from missing API keys.
"""

import os

# Set required env vars BEFORE any backend imports happen.
# pytest loads conftest.py before test modules, so this runs first.
os.environ.setdefault("OPENROUTER_API_KEY", "test-key-not-real")
