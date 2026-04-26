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
