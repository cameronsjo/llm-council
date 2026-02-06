"""Tests for pure functions in backend.storage."""

from backend.storage import _extract_conversation_metadata, _should_migrate_message


# ---------------------------------------------------------------------------
# _should_migrate_message
# ---------------------------------------------------------------------------

class TestShouldMigrateMessage:
    """Tests for _should_migrate_message."""

    def test_legacy_council_message_needs_migration(self):
        """Assistant message with stage1 but no rounds needs migration."""
        msg = {"role": "assistant", "stage1": [{"model": "m", "response": "r"}]}
        assert _should_migrate_message(msg) is True

    def test_unified_message_does_not_need_migration(self):
        """Assistant message with rounds does NOT need migration."""
        msg = {
            "role": "assistant",
            "stage1": [{"model": "m", "response": "r"}],
            "rounds": [{"round_number": 1}],
        }
        assert _should_migrate_message(msg) is False

    def test_user_message_does_not_need_migration(self):
        """User messages never need migration."""
        msg = {"role": "user", "content": "Hello"}
        assert _should_migrate_message(msg) is False

    def test_assistant_without_stage1_does_not_need_migration(self):
        """Assistant message without stage1 (e.g., arena) does not need migration."""
        msg = {"role": "assistant", "mode": "arena", "rounds": []}
        assert _should_migrate_message(msg) is False

    def test_empty_dict_does_not_need_migration(self):
        """Empty dict does not need migration."""
        assert _should_migrate_message({}) is False

    def test_assistant_with_empty_stage1_needs_migration(self):
        """Assistant with stage1=[] but no rounds still needs migration."""
        msg = {"role": "assistant", "stage1": []}
        assert _should_migrate_message(msg) is True


# ---------------------------------------------------------------------------
# _extract_conversation_metadata
# ---------------------------------------------------------------------------

class TestExtractConversationMetadata:
    """Tests for _extract_conversation_metadata."""

    def test_normal_conversation(self):
        """Normal conversation extracts all metadata fields."""
        data = {
            "id": "conv-123",
            "created_at": "2026-01-15T10:00:00",
            "title": "Test Question",
            "messages": [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "stage1": []},
            ],
        }
        result = _extract_conversation_metadata(data)
        assert result == {
            "id": "conv-123",
            "created_at": "2026-01-15T10:00:00",
            "title": "Test Question",
            "message_count": 2,
        }

    def test_missing_title_defaults(self):
        """Missing title defaults to 'New Conversation'."""
        data = {
            "id": "conv-456",
            "created_at": "2026-01-15T10:00:00",
            "messages": [],
        }
        result = _extract_conversation_metadata(data)
        assert result["title"] == "New Conversation"

    def test_empty_messages(self):
        """Empty messages list gives message_count 0."""
        data = {
            "id": "conv-789",
            "created_at": "2026-01-15T10:00:00",
            "title": "Empty",
            "messages": [],
        }
        result = _extract_conversation_metadata(data)
        assert result["message_count"] == 0

    def test_missing_messages_key(self):
        """Missing messages key defaults to count 0."""
        data = {
            "id": "conv-000",
            "created_at": "2026-01-15T10:00:00",
            "title": "No Messages Key",
        }
        result = _extract_conversation_metadata(data)
        assert result["message_count"] == 0

    def test_does_not_include_full_messages(self):
        """Extracted metadata does not include full messages array."""
        data = {
            "id": "conv-111",
            "created_at": "2026-01-15T10:00:00",
            "title": "T",
            "messages": [{"role": "user", "content": "sensitive data"}],
        }
        result = _extract_conversation_metadata(data)
        assert "messages" not in result
        assert "content" not in str(result)
