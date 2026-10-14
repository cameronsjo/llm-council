"""The combined test command must propagate failures from either suite."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize("backend_exit,frontend_exit", [(0, 0), (7, 0), (0, 9)])
def test_test_target_propagates_failures(
    tmp_path: Path, backend_exit: int, frontend_exit: int
) -> None:
    make = shutil.which("make")
    assert make is not None, "make is required for the development test entrypoint"
    repo = Path(__file__).resolve().parents[1]
    (tmp_path / "Makefile").write_text((repo / "Makefile").read_text())
    (tmp_path / "frontend").mkdir()
    # A file named test must not prevent this phony target from running.
    (tmp_path / "test").touch()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for command, code in (("uv", backend_exit), ("npm", frontend_exit)):
        stub = bin_dir / command
        stub.write_text(f"#!/bin/sh\necho {command}-ran\nexit {code}\n")
        stub.chmod(0o755)
    result = subprocess.run(
        [make, "test"],
        cwd=tmp_path,
        env={**os.environ, "PATH": str(bin_dir)},
        capture_output=True,
        text=True,
        check=False,
    )
    assert "uv-ran" in result.stdout
    assert ("npm-ran" in result.stdout) == (backend_exit == 0)
    assert (result.returncode == 0) == (backend_exit == 0 and frontend_exit == 0)
