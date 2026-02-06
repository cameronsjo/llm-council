"""Tests for stage3_synthesize_final anonymization and retry."""

from unittest.mock import AsyncMock, patch

import pytest

from backend.council import stage3_synthesize_final


STAGE1_RESULTS = [
    {"model": "openai/gpt-4o", "response": "Answer from GPT", "metrics": {}},
    {"model": "anthropic/claude-3", "response": "Answer from Claude", "metrics": {}},
]

STAGE2_RESULTS = [
    {"model": "openai/gpt-4o", "ranking": "Response A is better. FINAL RANKING:\n1. Response A\n2. Response B", "metrics": {}},
    {"model": "anthropic/claude-3", "ranking": "Response B is better. FINAL RANKING:\n1. Response B\n2. Response A", "metrics": {}},
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


class TestStage3Retry:
    """Chairman call retries once on failure."""

    @pytest.mark.asyncio
    async def test_retries_once_on_failure(self):
        mock_query = AsyncMock(side_effect=[None, CHAIRMAN_RESPONSE])

        with patch("backend.council.query_model", mock_query):
            result = await stage3_synthesize_final("test", STAGE1_RESULTS, STAGE2_RESULTS)

        assert result["response"] == "Synthesis result"
        assert mock_query.call_count == 2

    @pytest.mark.asyncio
    async def test_returns_error_after_both_attempts_fail(self):
        mock_query = AsyncMock(return_value=None)

        with patch("backend.council.query_model", mock_query):
            result = await stage3_synthesize_final("test", STAGE1_RESULTS, STAGE2_RESULTS)

        assert "Error" in result["response"]
        assert mock_query.call_count == 2

    @pytest.mark.asyncio
    async def test_no_retry_on_success(self):
        mock_query = AsyncMock(return_value=CHAIRMAN_RESPONSE)

        with patch("backend.council.query_model", mock_query):
            result = await stage3_synthesize_final("test", STAGE1_RESULTS, STAGE2_RESULTS)

        assert result["response"] == "Synthesis result"
        assert mock_query.call_count == 1
