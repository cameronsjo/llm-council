"""Filesystem and concurrency regression tests for conversation storage."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from backend import storage


@pytest.fixture()
def isolated_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point both authenticated and unauthenticated storage at a temp tree."""
    data_base = tmp_path / "data"
    monkeypatch.setattr(storage, "DATA_BASE_DIR", str(data_base))
    monkeypatch.setattr(storage, "DATA_DIR", str(data_base / "conversations"))
    return data_base


def _conversation_path(conversation_id: str, user_id: str | None = None) -> Path:
    return Path(storage.get_conversation_path(conversation_id, user_id))


def _assert_no_temporary_json_files(path: Path) -> None:
    assert list(path.parent.glob("*.tmp")) == []


@pytest.mark.parametrize("failure_phase", ["serialize", "replace"])
def test_save_failure_preserves_existing_json_and_cleans_temp_file(
    failure_phase: str,
    isolated_storage: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failed replacement must leave the last complete conversation readable."""
    storage.create_conversation(
        "save-failure",
        council_models=["old-model"],
        chairman_model="old-chairman",
    )
    path = _conversation_path("save-failure")
    original = json.loads(path.read_text())
    replacement = {**original, "title": "replacement"}

    def fail_replace(source: str, destination: str) -> None:
        raise OSError("simulated replace failure")

    def fail_dump(data: Any, output: Any, **kwargs: Any) -> None:
        output.write('{"incomplete":')
        raise OSError("simulated serialization failure")

    if failure_phase == "serialize":
        monkeypatch.setattr(storage.json, "dump", fail_dump)
    else:
        monkeypatch.setattr(storage.os, "replace", fail_replace)

    with pytest.raises(OSError, match="simulated .* failure"):
        storage.save_conversation(replacement)

    assert json.loads(path.read_text()) == original
    _assert_no_temporary_json_files(path)


def test_create_failure_preserves_existing_json_and_cleans_temp_file(
    isolated_storage: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failed create replacement must not destroy an existing conversation."""
    storage.create_conversation(
        "create-failure",
        council_models=["old-model"],
        chairman_model="old-chairman",
    )
    path = _conversation_path("create-failure")
    original = json.loads(path.read_text())

    def fail_replace(source: str, destination: str) -> None:
        raise OSError("simulated replace failure")

    monkeypatch.setattr(storage.os, "replace", fail_replace)

    with pytest.raises(OSError, match="simulated replace failure"):
        storage.create_conversation(
            "create-failure",
            council_models=["new-model"],
            chairman_model="new-chairman",
        )

    assert json.loads(path.read_text()) == original
    _assert_no_temporary_json_files(path)


def _run_in_thread(
    operation: Callable[[], Any],
    started: threading.Event,
    finished: threading.Event,
    errors: list[BaseException],
) -> threading.Thread:
    def runner() -> None:
        started.set()
        try:
            operation()
        except BaseException as exc:  # Report worker failures after joining.
            errors.append(exc)
        finally:
            finished.set()

    thread = threading.Thread(target=runner)
    thread.start()
    return thread


def _install_first_write_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[threading.Event, threading.Event]:
    """Pause the first post-setup JSON write until another operation is started."""
    dump_started = threading.Event()
    release_dump = threading.Event()
    state_lock = threading.Lock()
    first_write = True
    original_dump = storage.json.dump

    def gated_dump(data: Any, fp: Any, *args: Any, **kwargs: Any) -> None:
        nonlocal first_write
        with state_lock:
            should_pause = first_write
            first_write = False
        if should_pause:
            dump_started.set()
            assert release_dump.wait(2), "timed out waiting to release the first write"
        original_dump(data, fp, *args, **kwargs)

    monkeypatch.setattr(storage.json, "dump", gated_dump)
    return dump_started, release_dump


def test_concurrent_read_modify_writes_preserve_both_messages(
    isolated_storage: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same-conversation writers serialize their snapshots instead of losing one."""
    storage.create_conversation("concurrent-messages")
    dump_started, release_dump = _install_first_write_gate(monkeypatch)
    errors: list[BaseException] = []
    first_started = threading.Event()
    first_finished = threading.Event()
    second_started = threading.Event()
    second_finished = threading.Event()

    first = _run_in_thread(
        lambda: storage.add_user_message("concurrent-messages", "first"),
        first_started,
        first_finished,
        errors,
    )
    assert first_started.wait(1)
    assert dump_started.wait(1)
    # Readers see the last complete snapshot while a replacement is being written.
    assert storage.get_conversation("concurrent-messages")["messages"] == []

    second = _run_in_thread(
        lambda: storage.add_user_message("concurrent-messages", "second"),
        second_started,
        second_finished,
        errors,
    )
    assert second_started.wait(1)
    assert not second_finished.wait(0.2), "same-conversation writer bypassed the lock"

    release_dump.set()
    first.join(2)
    second.join(2)
    assert not first.is_alive()
    assert not second.is_alive()
    assert errors == []

    conversation = storage.get_conversation("concurrent-messages")
    assert conversation is not None
    assert [message["content"] for message in conversation["messages"]] == [
        "first",
        "second",
    ]


def test_conversation_locks_are_scoped_to_user(
    isolated_storage: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The same conversation ID for different users must not share a lock."""
    storage.create_conversation("shared-id", user_id="alice")
    storage.create_conversation("shared-id", user_id="bob")
    dump_started, release_dump = _install_first_write_gate(monkeypatch)
    errors: list[BaseException] = []
    first_started = threading.Event()
    first_finished = threading.Event()
    second_started = threading.Event()
    second_finished = threading.Event()

    first = _run_in_thread(
        lambda: storage.add_user_message("shared-id", "alice-update", user_id="alice"),
        first_started,
        first_finished,
        errors,
    )
    assert first_started.wait(1)
    assert dump_started.wait(1)

    second = _run_in_thread(
        lambda: storage.add_user_message("shared-id", "bob-update", user_id="bob"),
        second_started,
        second_finished,
        errors,
    )
    assert second_started.wait(1)
    assert second_finished.wait(1), "different users unexpectedly share a lock"

    release_dump.set()
    first.join(2)
    second.join(2)
    assert not first.is_alive()
    assert not second.is_alive()
    assert errors == []

    alice = storage.get_conversation("shared-id", user_id="alice")
    bob = storage.get_conversation("shared-id", user_id="bob")
    assert alice is not None
    assert bob is not None
    assert alice["messages"][-1]["content"] == "alice-update"
    assert bob["messages"][-1]["content"] == "bob-update"


def test_delete_serializes_with_in_progress_update(
    isolated_storage: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Deletion waits for a same-conversation update before removing its file."""
    storage.create_conversation("delete-race")
    path = _conversation_path("delete-race")
    dump_started, release_dump = _install_first_write_gate(monkeypatch)
    errors: list[BaseException] = []
    update_started = threading.Event()
    update_finished = threading.Event()
    delete_started = threading.Event()
    delete_finished = threading.Event()

    update = _run_in_thread(
        lambda: storage.add_user_message("delete-race", "update"),
        update_started,
        update_finished,
        errors,
    )
    assert update_started.wait(1)
    assert dump_started.wait(1)

    deleted: list[bool] = []
    delete = _run_in_thread(
        lambda: deleted.append(storage.delete_conversation("delete-race")),
        delete_started,
        delete_finished,
        errors,
    )
    assert delete_started.wait(1)
    assert not delete_finished.wait(0.2), "delete bypassed the conversation lock"

    release_dump.set()
    update.join(2)
    delete.join(2)
    assert not update.is_alive()
    assert not delete.is_alive()
    assert errors == []
    assert deleted == [True]
    assert not path.exists()
