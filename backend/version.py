"""Version information for LLM Council."""

import os
import subprocess
from dataclasses import dataclass
from functools import lru_cache

# Semantic version - update this when releasing
__version__ = "0.7.0"

# GitHub repository URL
REPO_URL = "https://github.com/cameronsjo/llm-council"


@dataclass
class VersionInfo:
    """Application version information."""

    version: str
    git_commit: str
    git_commit_short: str
    build_time: str
    repo_url: str

    @property
    def commit_url(self) -> str | None:
        """Get URL to the commit on GitHub."""
        if self.git_commit and self.git_commit != "unknown":
            return f"{self.repo_url}/commit/{self.git_commit}"
        return None

    @property
    def release_url(self) -> str | None:
        """Get URL to the release on GitHub."""
        if self.version and self.version != "dev":
            return f"{self.repo_url}/releases/tag/v{self.version}"
        return None


def _get_git_commit() -> str:
    """Get current git commit hash."""
    # First check environment variable (set during Docker build)
    env_commit = os.getenv("GIT_COMMIT")
    if env_commit and env_commit != "unknown":
        return env_commit

    # Try to get from git directly (for local development)
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass

    return "unknown"


def _get_build_time() -> str:
    """Get build time."""
    return os.getenv("BUILD_TIME", "unknown")


@lru_cache
def get_version_info() -> VersionInfo:
    """Get version information (cached)."""
    git_commit = _get_git_commit()
    git_commit_short = git_commit[:7] if git_commit != "unknown" else "unknown"

    return VersionInfo(
        version=os.getenv("APP_VERSION", __version__),
        git_commit=git_commit,
        git_commit_short=git_commit_short,
        build_time=_get_build_time(),
        repo_url=REPO_URL,
    )
