"""Creation timestamp and legacy date-ordering regressions."""

from datetime import datetime, timedelta
from pathlib import Path

import pytest

from backend import storage


@pytest.fixture()
def isolated_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(storage, "DATA_BASE_DIR", str(tmp_path))
    monkeypatch.setattr(storage, "DATA_DIR", str(tmp_path / "conversations"))


@pytest.mark.parametrize("user_id", [None, "alice"])
def test_new_creation_timestamp_is_utc_aware(isolated_storage: None, user_id: str | None) -> None:
    conversation = storage.create_conversation(
        "new", user_id=user_id, council_models=["model"], chairman_model="chairman"
    )
    created_at = datetime.fromisoformat(conversation["created_at"])
    assert created_at.tzinfo is not None
    assert created_at.utcoffset() == timedelta(0)
    assert conversation["created_at"].endswith("+00:00")
    saved = storage.get_conversation("new", user_id=user_id)
    assert saved is not None
    assert saved["created_at"] == conversation["created_at"]


@pytest.mark.parametrize("user_id", [None, "alice"])
def test_mixed_timestamp_formats_sort_by_instant_without_rewriting_files(
    isolated_storage: None, user_id: str | None
) -> None:
    timestamps = {
        "early-positive-offset": "2026-01-15T12:00:00+05:00",
        "legacy-naive": "2026-01-15T10:00:00.000001",
        "explicit-utc": "2026-01-15T10:00:00+00:00",
        "zulu": "2026-01-15T11:00:00Z",
        "late-negative-offset": "2026-01-15T09:00:00-04:00",
    }
    original_files = {}
    for conversation_id, timestamp in timestamps.items():
        conversation = storage.create_conversation(
            conversation_id,
            user_id=user_id,
            council_models=["model"],
            chairman_model="chairman",
        )
        conversation["created_at"] = timestamp
        storage.save_conversation(conversation, user_id=user_id)
        path = Path(storage.get_conversation_path(conversation_id, user_id))
        original_files[path] = path.read_bytes()

    listed = storage.list_conversations(user_id=user_id)
    assert [item["id"] for item in listed] == [
        "late-negative-offset",
        "zulu",
        "legacy-naive",
        "explicit-utc",
        "early-positive-offset",
    ]
    assert {item["id"]: item["created_at"] for item in listed} == timestamps
    assert all(path.read_bytes() == contents for path, contents in original_files.items())


@pytest.mark.parametrize("user_id", [None, "alice"])
def test_invalid_timestamps_sort_last_without_breaking_or_rewriting_files(
    isolated_storage: None, user_id: str | None
) -> None:
    timestamps = {
        "latest": "2026-01-15T12:00:00+00:00",
        "earlier": "2026-01-15T11:00:00+00:00",
        "empty": "",
        "malformed": "not-a-date",
        "null": None,
    }
    missing_id = "missing"
    original_files = {}

    for conversation_id, timestamp in timestamps.items():
        conversation = storage.create_conversation(
            conversation_id,
            user_id=user_id,
            council_models=["model"],
            chairman_model="chairman",
        )
        conversation["created_at"] = timestamp
        storage.save_conversation(conversation, user_id=user_id)

    missing = storage.create_conversation(
        missing_id,
        user_id=user_id,
        council_models=["model"],
        chairman_model="chairman",
    )
    missing.pop("created_at")
    storage.save_conversation(missing, user_id=user_id)

    for conversation_id in (*timestamps, missing_id):
        path = Path(storage.get_conversation_path(conversation_id, user_id))
        original_files[path] = path.read_bytes()

    listed = storage.list_conversations(user_id=user_id)
    assert [item["id"] for item in listed[:2]] == ["latest", "earlier"]
    assert {item["id"] for item in listed[2:]} == {
        "empty",
        "malformed",
        "null",
        "missing",
    }
    assert all(path.read_bytes() == contents for path, contents in original_files.items())
