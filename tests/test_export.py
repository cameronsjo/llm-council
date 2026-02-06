"""Tests for pure functions in backend.export."""

from backend.export import export_to_json, export_to_markdown, format_model_name


# ---------------------------------------------------------------------------
# format_model_name
# ---------------------------------------------------------------------------

class TestFormatModelName:
    """Tests for format_model_name."""

    def test_provider_slash_model(self):
        """'openai/gpt-4' strips provider prefix."""
        assert format_model_name("openai/gpt-4") == "gpt-4"

    def test_no_slash(self):
        """Model id without slash returns unchanged."""
        assert format_model_name("gpt-4") == "gpt-4"

    def test_multiple_slashes(self):
        """Multiple slashes returns only the last segment."""
        assert format_model_name("a/b/c") == "c"


# ---------------------------------------------------------------------------
# export_to_markdown
# ---------------------------------------------------------------------------

class TestExportToMarkdown:
    """Tests for export_to_markdown."""

    def test_full_conversation(self):
        """Full conversation with title, date, and messages exports correctly."""
        conv = {
            "title": "Test Chat",
            "created_at": "2025-01-15T12:00:00Z",
            "messages": [
                {"role": "user", "content": "What is 2+2?"},
            ],
        }

        md = export_to_markdown(conv)

        assert "# Test Chat" in md
        assert "2025-01-15 12:00 UTC" in md
        assert "## User" in md
        assert "What is 2+2?" in md

    def test_council_mode_message(self):
        """Council mode message with stage1/stage2/stage3 renders all stages."""
        conv = {
            "title": "Council Test",
            "created_at": "2025-06-01T00:00:00Z",
            "messages": [
                {"role": "user", "content": "Hello"},
                {
                    "role": "assistant",
                    "stage1": [
                        {"model": "openai/gpt-4", "response": "Stage 1 response"},
                    ],
                    "stage2": [
                        {
                            "model": "openai/gpt-4",
                            "ranking_text": "Evaluation text here",
                            "parsed_ranking": ["Response A"],
                        },
                    ],
                    "stage3": {
                        "model": "google/gemini",
                        "response": "Final answer from chairman",
                    },
                },
            ],
        }

        md = export_to_markdown(conv)

        assert "### Stage 1: Individual Responses" in md
        assert "Stage 1 response" in md
        assert "### Stage 2: Peer Rankings" in md
        assert "### Stage 3: Final Synthesis" in md
        assert "Final answer from chairman" in md

    def test_arena_mode_message(self):
        """Arena mode message with rounds and synthesis renders properly."""
        conv = {
            "title": "Arena Test",
            "created_at": "2025-06-01T00:00:00Z",
            "messages": [
                {"role": "user", "content": "Debate topic"},
                {
                    "role": "assistant",
                    "mode": "arena",
                    "participant_mapping": {
                        "Participant A": "openai/gpt-4",
                    },
                    "rounds": [
                        {
                            "round_number": 1,
                            "round_type": "opening",
                            "responses": [
                                {"participant": "Participant A", "content": "Opening statement"},
                            ],
                        },
                    ],
                    "synthesis": {
                        "answer": "The debate concludes...",
                    },
                },
            ],
        }

        md = export_to_markdown(conv)

        assert "## Arena Debate" in md
        assert "### Participants" in md
        assert "### Round 1: Opening" in md
        assert "Opening statement" in md
        assert "### Final Synthesis" in md
        assert "The debate concludes..." in md

    def test_empty_conversation(self):
        """Conversation with no messages produces header only."""
        conv = {"title": "Empty", "messages": []}

        md = export_to_markdown(conv)

        assert "# Empty" in md
        assert "## User" not in md

    def test_invalid_created_at_falls_back_to_raw_string(self):
        """Invalid date string falls back to displaying the raw value."""
        conv = {
            "title": "Bad Date",
            "created_at": "not-a-date",
            "messages": [],
        }

        md = export_to_markdown(conv)

        assert "not-a-date" in md


# ---------------------------------------------------------------------------
# export_to_json
# ---------------------------------------------------------------------------

class TestExportToJson:
    """Tests for export_to_json."""

    def test_returns_structured_subset(self):
        """Returns expected keys from conversation dict."""
        conv = {
            "id": "abc-123",
            "title": "My Chat",
            "created_at": "2025-01-01T00:00:00Z",
            "council_models": ["openai/gpt-4"],
            "chairman_model": "google/gemini",
            "messages": [{"role": "user", "content": "hi"}],
            "extra_field": "should be excluded",
        }

        result = export_to_json(conv)

        assert result["id"] == "abc-123"
        assert result["title"] == "My Chat"
        assert result["created_at"] == "2025-01-01T00:00:00Z"
        assert result["council_models"] == ["openai/gpt-4"]
        assert result["chairman_model"] == "google/gemini"
        assert len(result["messages"]) == 1
        assert "extra_field" not in result

    def test_missing_optional_fields_default(self):
        """Missing optional fields get default values."""
        conv = {"id": "x"}

        result = export_to_json(conv)

        assert result["title"] is None
        assert result["council_models"] == []
        assert result["messages"] == []
