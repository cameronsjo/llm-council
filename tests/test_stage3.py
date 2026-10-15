"""Tests for stage3_synthesize_final anonymization and transport-owned retries."""

from unittest.mock import AsyncMock, patch

import pytest

from backend.council import stage3_synthesize_final
from backend.openrouter import ModelError

STAGE1_RESULTS = [
    {"model": "openai/gpt-4o", "response": "Answer from GPT", "metrics": {}},
    {"model": "anthropic/claude-3", "response": "Answer from Claude", "metrics": {}},
]

STAGE2_RESULTS = [
    {
        "model": "openai/gpt-4o",
        "ranking": "Response A is better. FINAL RANKING:\n1. Response A\n2. Response B",
        "metrics": {},
    },
    {
        "model": "anthropic/claude-3",
        "ranking": "Response B is better. FINAL RANKING:\n1. Response B\n2. Response A",
        "metrics": {},
    },
]

CHAIRMAN_RESPONSE = {"content": "Synthesis result", "metrics": {"total_tokens": 100}}


class TestStage3Anonymization:
    """Chairman prompt must NOT contain real model names."""

    @pytest.mark.asyncio
    async def test_chairman_prompt_uses_anonymous_labels(self):
        """Verify the chairman sees 'Response A/B' not 'openai/gpt-4o'."""
        captured_messages = []

        async def capture_query(model, messages, **kwargs):
            captured_messages.append(messages)
            return CHAIRMAN_RESPONSE

        with patch("backend.council.query_model", side_effect=capture_query):
            await stage3_synthesize_final("test question", STAGE1_RESULTS, STAGE2_RESULTS)

        prompt_text = captured_messages[0][0]["content"]

        # Anonymous labels MUST appear
        assert "Response A:" in prompt_text
        assert "Response B:" in prompt_text
        assert "Evaluator 1:" in prompt_text
        assert "Evaluator 2:" in prompt_text

        # Real model names MUST NOT appear
        assert "openai/gpt-4o" not in prompt_text
        assert "anthropic/claude-3" not in prompt_text
        assert "gpt-4o" not in prompt_text
        assert "claude-3" not in prompt_text

    @pytest.mark.asyncio
    async def test_chairman_prompt_contains_responses(self):
        """Verify response content is included in the prompt."""
        captured_messages = []

        async def capture_query(model, messages, **kwargs):
            captured_messages.append(messages)
            return CHAIRMAN_RESPONSE

        with patch("backend.council.query_model", side_effect=capture_query):
            await stage3_synthesize_final("test question", STAGE1_RESULTS, STAGE2_RESULTS)

        prompt_text = captured_messages[0][0]["content"]
        assert "Answer from GPT" in prompt_text
        assert "Answer from Claude" in prompt_text


class TestStage3RetryPolicy:
    """Stage 3 invokes the transport once and preserves its final failure."""

    @pytest.mark.parametrize(
        "status,category,error_fragment",
        [
            (401, "auth", "API key invalid"),
            (402, "billing", "insufficient OpenRouter credits"),
            (429, "rate_limit", "Unable to generate final synthesis"),
            (503, "transient", "Unable to generate final synthesis"),
            (None, "timeout", "Unable to generate final synthesis"),
            (500, "unknown", "Unable to generate final synthesis"),
        ],
    )
    async def test_does_not_repeat_a_failed_transport_call(
        self, status: int | None, category: str, error_fragment: str
    ) -> None:
        failure = ModelError("chairman", status, category, "provider failure")
        # A second call would appear to recover, masking an unwanted outer retry.
        mock_query = AsyncMock(side_effect=[failure, CHAIRMAN_RESPONSE])
        with patch("backend.council.query_model", mock_query):
            result = await stage3_synthesize_final("test", STAGE1_RESULTS, STAGE2_RESULTS)
        assert error_fragment in result["response"]
        mock_query.assert_awaited_once()

    async def test_legacy_none_failure_is_not_retried(self) -> None:
        mock_query = AsyncMock(return_value=None)
        with patch("backend.council.query_model", mock_query):
            result = await stage3_synthesize_final("test", STAGE1_RESULTS, STAGE2_RESULTS)
        assert "Error" in result["response"]
        mock_query.assert_awaited_once()

    async def test_no_retry_on_success(self) -> None:
        mock_query = AsyncMock(return_value=CHAIRMAN_RESPONSE)
        with patch("backend.council.query_model", mock_query):
            result = await stage3_synthesize_final("test", STAGE1_RESULTS, STAGE2_RESULTS)
        assert result["response"] == "Synthesis result"
        mock_query.assert_awaited_once()
