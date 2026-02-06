"""Tests for pure functions in backend.council."""

import pytest

from backend.council import (
    STAGE1_SYSTEM_PROMPT,
    STAGE2_SYSTEM_PROMPT,
    _build_ranking_prompt,
    _build_stage1_messages,
    _format_model_result,
    aggregate_metrics,
    calculate_aggregate_rankings,
    convert_legacy_message_to_unified,
    convert_to_unified_result,
    generate_response_labels,
    parse_ranking_from_text,
    stage1_collect_responses,
)


# ---------------------------------------------------------------------------
# Stage 1 helpers
# ---------------------------------------------------------------------------

class TestStage1Helpers:
    """Tests for stage1 helper functions and constants."""

    def test_system_prompt_is_non_empty(self):
        assert len(STAGE1_SYSTEM_PROMPT) > 100

    def test_build_messages_plain_query(self):
        messages = _build_stage1_messages("What is 2+2?")
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == STAGE1_SYSTEM_PROMPT
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "What is 2+2?"

    def test_build_messages_with_web_context(self):
        messages = _build_stage1_messages("query", web_search_context="search results")
        assert "search results" in messages[1]["content"]
        assert "query" in messages[1]["content"]

    def test_format_model_result_basic(self):
        result = _format_model_result("openai/gpt-4", {"content": "hello", "metrics": {"tokens": 5}})
        assert result["model"] == "openai/gpt-4"
        assert result["response"] == "hello"
        assert result["metrics"] == {"tokens": 5}
        assert "reasoning_details" not in result

    def test_format_model_result_with_reasoning(self):
        result = _format_model_result("model", {"content": "x", "reasoning_details": "thought"})
        assert result["reasoning_details"] == "thought"

    @pytest.mark.asyncio
    async def test_empty_council_raises_value_error(self):
        with pytest.raises(ValueError, match="No council models configured"):
            await stage1_collect_responses("query", council_models=[])


# ---------------------------------------------------------------------------
# generate_response_labels
# ---------------------------------------------------------------------------

class TestGenerateResponseLabels:
    """Tests for generate_response_labels."""

    def test_zero_labels(self):
        """Zero count returns empty list."""
        assert generate_response_labels(0) == []

    def test_single_label(self):
        """Single label is A."""
        assert generate_response_labels(1) == ["A"]

    def test_first_26_are_single_letters(self):
        """First 26 labels are A through Z."""
        labels = generate_response_labels(26)
        assert labels[0] == "A"
        assert labels[25] == "Z"
        assert len(labels) == 26

    def test_27th_label_is_aa(self):
        """27th label (index 26) is AA, not a non-letter character."""
        labels = generate_response_labels(27)
        assert labels[26] == "AA"

    def test_28th_label_is_ab(self):
        """28th label is AB."""
        labels = generate_response_labels(28)
        assert labels[27] == "AB"

    def test_52nd_label_is_az(self):
        """52nd label (index 51) is AZ."""
        labels = generate_response_labels(52)
        assert labels[51] == "AZ"

    def test_53rd_label_is_ba(self):
        """53rd label (index 52) is BA."""
        labels = generate_response_labels(53)
        assert labels[52] == "BA"

    def test_all_labels_unique(self):
        """100 labels are all unique."""
        labels = generate_response_labels(100)
        assert len(labels) == len(set(labels))

    def test_all_labels_are_uppercase_alpha(self):
        """All generated labels contain only uppercase letters."""
        labels = generate_response_labels(100)
        for label in labels:
            assert label.isalpha() and label.isupper(), f"Bad label: {label!r}"


# ---------------------------------------------------------------------------
# _build_ranking_prompt
# ---------------------------------------------------------------------------

class TestBuildRankingPrompt:
    """Tests for _build_ranking_prompt."""

    def test_contains_user_query(self):
        """Prompt includes the user query."""
        prompt = _build_ranking_prompt("What is Python?", "Response A:\nAnswer")
        assert "What is Python?" in prompt

    def test_contains_responses_text(self):
        """Prompt includes the responses text."""
        prompt = _build_ranking_prompt("Q?", "Response A:\nFoo\n\nResponse B:\nBar")
        assert "Response A:\nFoo" in prompt
        assert "Response B:\nBar" in prompt

    def test_contains_final_ranking_instructions(self):
        """Prompt includes FINAL RANKING format instructions."""
        prompt = _build_ranking_prompt("Q?", "Response A:\nTest")
        assert "FINAL RANKING:" in prompt
        assert "1. Response A" in prompt

    def test_contains_evaluation_criteria(self):
        """Prompt includes evaluation criteria."""
        prompt = _build_ranking_prompt("Q?", "Response A:\nTest")
        assert "Accuracy" in prompt
        assert "Completeness" in prompt


# ---------------------------------------------------------------------------
# STAGE2_SYSTEM_PROMPT
# ---------------------------------------------------------------------------

class TestStage2SystemPrompt:
    """Tests for STAGE2_SYSTEM_PROMPT constant."""

    def test_is_nonempty_string(self):
        """System prompt is a non-empty string."""
        assert isinstance(STAGE2_SYSTEM_PROMPT, str)
        assert len(STAGE2_SYSTEM_PROMPT) > 0

    def test_mentions_evaluator_role(self):
        """System prompt establishes the evaluator role."""
        assert "evaluator" in STAGE2_SYSTEM_PROMPT.lower()


# ---------------------------------------------------------------------------
# parse_ranking_from_text
# ---------------------------------------------------------------------------

class TestParseRankingFromText:
    """Tests for parse_ranking_from_text."""

    def test_standard_numbered_list(self):
        """Standard FINAL RANKING with numbered list parses correctly."""
        text = (
            "Some evaluation text here.\n\n"
            "FINAL RANKING:\n"
            "1. Response C\n"
            "2. Response A\n"
            "3. Response B\n"
        )
        assert parse_ranking_from_text(text) == [
            "Response C",
            "Response A",
            "Response B",
        ]

    def test_extra_text_before_and_after(self):
        """Extra text surrounding the ranking section is ignored."""
        text = (
            "Response A is okay.\n"
            "Response B is better.\n"
            "Response C is best.\n\n"
            "FINAL RANKING:\n"
            "1. Response B\n"
            "2. Response C\n"
            "3. Response A\n\n"
            "That concludes my evaluation.\n"
        )
        assert parse_ranking_from_text(text) == [
            "Response B",
            "Response C",
            "Response A",
        ]

    def test_no_final_ranking_header_falls_back(self):
        """Without FINAL RANKING header, falls back to finding Response X patterns."""
        text = (
            "I think Response B is best, followed by Response A, "
            "and finally Response C."
        )
        assert parse_ranking_from_text(text) == [
            "Response B",
            "Response A",
            "Response C",
        ]

    def test_empty_string(self):
        """Empty input returns empty list."""
        assert parse_ranking_from_text("") == []

    def test_no_response_labels(self):
        """Text with no Response labels returns empty list."""
        text = "This text has no ranking information at all."
        assert parse_ranking_from_text(text) == []

    def test_multiple_final_ranking_sections(self):
        """Multiple FINAL RANKING sections - takes content after first split."""
        text = (
            "Draft:\n"
            "FINAL RANKING:\n"
            "1. Response A\n"
            "2. Response B\n\n"
            "Wait, let me reconsider.\n\n"
            "FINAL RANKING:\n"
            "1. Response B\n"
            "2. Response A\n"
        )
        # split("FINAL RANKING:") produces 3 parts; parts[1] is the first ranking section
        result = parse_ranking_from_text(text)
        assert result == ["Response A", "Response B"]

    def test_multi_letter_labels(self):
        """Labels up to Z are captured correctly."""
        text = (
            "FINAL RANKING:\n"
            "1. Response Z\n"
            "2. Response M\n"
            "3. Response A\n"
        )
        assert parse_ranking_from_text(text) == [
            "Response Z",
            "Response M",
            "Response A",
        ]

    def test_no_spaces_after_number(self):
        """Numbered list without space after period still parses."""
        text = (
            "FINAL RANKING:\n"
            "1.Response A\n"
            "2.Response B\n"
        )
        assert parse_ranking_from_text(text) == ["Response A", "Response B"]

    def test_multi_letter_labels_in_numbered_list(self):
        """Multi-letter labels (AA, AB) parse correctly in numbered format."""
        text = (
            "FINAL RANKING:\n"
            "1. Response AA\n"
            "2. Response AB\n"
            "3. Response Z\n"
        )
        assert parse_ranking_from_text(text) == [
            "Response AA",
            "Response AB",
            "Response Z",
        ]

    def test_multi_letter_labels_fallback(self):
        """Multi-letter labels parse via fallback (no FINAL RANKING header)."""
        text = "Best is Response AA, then Response BA, then Response A."
        assert parse_ranking_from_text(text) == [
            "Response AA",
            "Response BA",
            "Response A",
        ]


# ---------------------------------------------------------------------------
# aggregate_metrics
# ---------------------------------------------------------------------------

class TestAggregateMetrics:
    """Tests for aggregate_metrics."""

    def _make_result(
        self,
        model: str = "test/model",
        cost: float = 0.001,
        tokens: int = 100,
        latency: int = 500,
        provider: str | None = None,
    ) -> dict:
        metrics: dict = {
            "cost": cost,
            "total_tokens": tokens,
            "latency_ms": latency,
        }
        if provider:
            metrics["provider"] = provider
        return {"model": model, "response": "test", "metrics": metrics}

    def test_normal_metrics_all_stages(self):
        """Normal metrics from all 3 stages aggregate correctly."""
        s1 = [
            self._make_result("a", cost=0.01, tokens=100, latency=200),
            self._make_result("b", cost=0.02, tokens=200, latency=300),
        ]
        s2 = [
            self._make_result("a", cost=0.005, tokens=50, latency=150),
            self._make_result("b", cost=0.003, tokens=30, latency=250),
        ]
        s3 = self._make_result("chairman", cost=0.04, tokens=400, latency=600)

        m = aggregate_metrics(s1, s2, s3)

        # Total cost: 0.01 + 0.02 + 0.005 + 0.003 + 0.04 = 0.078
        assert m["total_cost"] == round(0.078, 6)
        # Total tokens: 100 + 200 + 50 + 30 + 400 = 780
        assert m["total_tokens"] == 780
        # Total latency: max(200,300) + max(150,250) + 600 = 300 + 250 + 600 = 1150
        assert m["total_latency_ms"] == 1150

    def test_empty_stage1_and_stage2(self):
        """Empty stage1 and stage2 still produce valid metrics."""
        s3 = self._make_result("chairman", cost=0.01, tokens=100, latency=500)
        m = aggregate_metrics([], [], s3)

        assert m["total_cost"] == 0.01
        assert m["total_tokens"] == 100
        assert m["total_latency_ms"] == 500
        assert m["by_stage"]["stage1"]["models"] == []
        assert m["by_stage"]["stage2"]["models"] == []

    def test_missing_none_metric_values_default_to_zero(self):
        """Missing or None metric values default to 0."""
        s1 = [{"model": "x", "response": "test", "metrics": {"cost": None, "total_tokens": None, "latency_ms": None}}]
        s3 = {"model": "chairman", "response": "test", "metrics": {}}

        m = aggregate_metrics(s1, [], s3)

        assert m["total_cost"] == 0.0
        assert m["total_tokens"] == 0
        assert m["total_latency_ms"] == 0

    def test_cost_rounding_to_six_decimals(self):
        """Costs are rounded to 6 decimal places."""
        s1 = [self._make_result(cost=0.0000001)]
        s3 = self._make_result(cost=0.0000002)
        m = aggregate_metrics(s1, [], s3)

        assert m["total_cost"] == round(0.0000003, 6)
        assert m["by_stage"]["stage1"]["cost"] == round(0.0000001, 6)

    def test_latency_uses_max_for_parallel_sum_for_sequential(self):
        """Stage 1 and 2 use max latency (parallel); stages sum sequentially."""
        s1 = [
            self._make_result(latency=100),
            self._make_result(latency=400),
        ]
        s2 = [
            self._make_result(latency=200),
            self._make_result(latency=300),
        ]
        s3 = self._make_result(latency=500)

        m = aggregate_metrics(s1, s2, s3)

        # max(100,400) = 400, max(200,300) = 300, + 500 = 1200
        assert m["total_latency_ms"] == 1200
        assert m["by_stage"]["stage1"]["latency_ms"] == 400
        assert m["by_stage"]["stage2"]["latency_ms"] == 300
        assert m["by_stage"]["stage3"]["latency_ms"] == 500


# ---------------------------------------------------------------------------
# calculate_aggregate_rankings
# ---------------------------------------------------------------------------

class TestCalculateAggregateRankings:
    """Tests for calculate_aggregate_rankings."""

    def test_normal_rankings_from_three_models(self):
        """Three models ranking three responses aggregates correctly."""
        label_to_model = {
            "Response A": "openai/gpt-4",
            "Response B": "anthropic/claude-3",
            "Response C": "google/gemini",
        }
        stage2 = [
            {"model": "m1", "ranking": "", "parsed_ranking": ["Response A", "Response B", "Response C"]},
            {"model": "m2", "ranking": "", "parsed_ranking": ["Response B", "Response A", "Response C"]},
            {"model": "m3", "ranking": "", "parsed_ranking": ["Response A", "Response C", "Response B"]},
        ]

        result = calculate_aggregate_rankings(stage2, label_to_model)

        # Response A: positions 1, 2, 1 -> avg 1.33
        # Response B: positions 2, 1, 3 -> avg 2.0
        # Response C: positions 3, 3, 2 -> avg 2.67
        models = {r["model"]: r for r in result}
        assert models["openai/gpt-4"]["average_rank"] == round(4 / 3, 2)
        assert models["anthropic/claude-3"]["average_rank"] == 2.0
        assert models["google/gemini"]["average_rank"] == round(8 / 3, 2)

        # Sorted by average rank (best first)
        assert result[0]["model"] == "openai/gpt-4"

    def test_single_model_ranking(self):
        """Single ranking still produces valid aggregate."""
        label_to_model = {"Response A": "model-a", "Response B": "model-b"}
        stage2 = [
            {"model": "m1", "ranking": "", "parsed_ranking": ["Response B", "Response A"]},
        ]

        result = calculate_aggregate_rankings(stage2, label_to_model)

        models = {r["model"]: r for r in result}
        assert models["model-b"]["average_rank"] == 1.0
        assert models["model-a"]["average_rank"] == 2.0
        assert models["model-b"]["rankings_count"] == 1

    def test_empty_stage2_results(self):
        """Empty stage2 returns empty list."""
        assert calculate_aggregate_rankings([], {"Response A": "m"}) == []

    def test_unknown_labels_skipped(self):
        """Labels not in label_to_model are silently ignored."""
        label_to_model = {"Response A": "model-a"}
        stage2 = [
            {"model": "m1", "ranking": "", "parsed_ranking": ["Response Z", "Response A"]},
        ]

        result = calculate_aggregate_rankings(stage2, label_to_model)

        # Only Response A should appear (position 2)
        assert len(result) == 1
        assert result[0]["model"] == "model-a"
        assert result[0]["average_rank"] == 2.0

    def test_uses_pre_parsed_ranking(self):
        """Pre-parsed ranking in parsed_ranking field is used directly."""
        label_to_model = {"Response A": "m-a", "Response B": "m-b"}
        stage2 = [
            {"model": "m1", "parsed_ranking": ["Response B", "Response A"], "ranking": "ignored text"},
        ]

        result = calculate_aggregate_rankings(stage2, label_to_model)
        assert result[0]["model"] == "m-b"

    def test_falls_back_to_parsing_text_when_no_parsed_ranking(self):
        """Falls back to parsing ranking text when parsed_ranking is None."""
        label_to_model = {"Response A": "m-a", "Response B": "m-b"}
        stage2 = [
            {
                "model": "m1",
                "parsed_ranking": None,
                "ranking": "FINAL RANKING:\n1. Response A\n2. Response B",
            },
        ]

        result = calculate_aggregate_rankings(stage2, label_to_model)
        assert result[0]["model"] == "m-a"
        assert result[0]["average_rank"] == 1.0


# ---------------------------------------------------------------------------
# convert_legacy_message_to_unified
# ---------------------------------------------------------------------------

class TestConvertLegacyMessageToUnified:
    """Tests for convert_legacy_message_to_unified."""

    def test_legacy_council_message(self):
        """Legacy message with stage1/stage2/stage3 converts to unified format."""
        message = {
            "role": "assistant",
            "stage1": [
                {"model": "openai/gpt-4", "response": "Answer A", "metrics": {}},
                {"model": "anthropic/claude-3", "response": "Answer B", "metrics": {}},
            ],
            "stage2": [
                {
                    "model": "openai/gpt-4",
                    "ranking": "FINAL RANKING:\n1. Response A\n2. Response B",
                    "parsed_ranking": ["Response A", "Response B"],
                    "metrics": {},
                },
            ],
            "stage3": {
                "model": "google/gemini",
                "response": "Synthesis here",
                "metrics": {},
            },
        }

        result = convert_legacy_message_to_unified(message)

        assert result["role"] == "assistant"
        assert result["mode"] == "council"
        assert "rounds" in result
        assert len(result["rounds"]) == 2
        assert result["rounds"][0]["round_type"] == "responses"
        assert result["rounds"][1]["round_type"] == "rankings"
        assert result["synthesis"]["content"] == "Synthesis here"
        # Should NOT contain legacy keys
        assert "stage1" not in result
        assert "stage2" not in result
        assert "stage3" not in result

    def test_already_unified_message(self):
        """Message that already has rounds is returned as-is."""
        message = {
            "role": "assistant",
            "rounds": [{"round_number": 1, "round_type": "responses", "responses": []}],
            "synthesis": {"model": "m", "content": "s"},
        }

        result = convert_legacy_message_to_unified(message)

        assert result is message  # Same object, not converted

    def test_arena_mode_message(self):
        """Arena mode messages pass through unchanged."""
        message = {
            "role": "assistant",
            "mode": "arena",
            "rounds": [],
            "synthesis": {},
        }

        result = convert_legacy_message_to_unified(message)

        assert result is message

    def test_user_message_passes_through(self):
        """User messages are returned unchanged."""
        message = {"role": "user", "content": "Hello"}

        result = convert_legacy_message_to_unified(message)

        assert result is message

    def test_empty_stage1_passes_through(self):
        """Assistant message with empty stage1 is not treated as council message."""
        message = {"role": "assistant", "stage1": [], "content": "Fallback"}

        result = convert_legacy_message_to_unified(message)

        assert result is message


# ---------------------------------------------------------------------------
# convert_to_unified_result
# ---------------------------------------------------------------------------

class TestConvertToUnifiedResult:
    """Tests for convert_to_unified_result."""

    def test_converts_all_stages_to_deliberation_result(self):
        """Full stage1/stage2/stage3 data produces correct DeliberationResult."""
        stage1 = [
            {"model": "openai/gpt-4", "response": "Answer A", "metrics": {"cost": 0.01}},
            {"model": "anthropic/claude-3", "response": "Answer B", "metrics": {"cost": 0.02}},
        ]
        stage2 = [
            {
                "model": "openai/gpt-4",
                "ranking": "eval text",
                "parsed_ranking": ["Response A", "Response B"],
                "metrics": {"cost": 0.005},
            },
        ]
        stage3 = {
            "model": "google/gemini",
            "response": "Final synthesis",
            "metrics": {"cost": 0.03},
        }
        label_to_model = {
            "Response A": "openai/gpt-4",
            "Response B": "anthropic/claude-3",
        }
        aggregate_rankings_data = [
            {"model": "openai/gpt-4", "average_rank": 1.0, "rankings_count": 1},
            {"model": "anthropic/claude-3", "average_rank": 2.0, "rankings_count": 1},
        ]
        metrics = {"total_cost": 0.065}

        result = convert_to_unified_result(
            stage1, stage2, stage3, label_to_model, aggregate_rankings_data, metrics
        )

        assert result.mode == "council"
        assert len(result.rounds) == 2

        # Round 1: responses
        r1 = result.rounds[0]
        assert r1.round_number == 1
        assert r1.round_type.value == "responses"
        assert len(r1.responses) == 2
        assert r1.responses[0].participant == "Response A"
        assert r1.responses[0].model == "openai/gpt-4"
        assert r1.responses[0].content == "Answer A"

        # Round 2: rankings
        r2 = result.rounds[1]
        assert r2.round_number == 2
        assert r2.round_type.value == "rankings"
        assert r2.metadata["label_to_model"] == label_to_model

        # Synthesis
        assert result.synthesis is not None
        assert result.synthesis.model == "google/gemini"
        assert result.synthesis.content == "Final synthesis"

        assert result.participant_mapping == label_to_model
        assert result.metrics == metrics
