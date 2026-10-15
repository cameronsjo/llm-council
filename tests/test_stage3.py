"""Tests for stage3_synthesize_final anonymization and retry policy."""

from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

import backend.openrouter as openrouter_module
from backend.council import stage3_synthesize_final
from backend.openrouter import MAX_RETRIES, RETRY_BASE_DELAY, ModelError

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
    """Stage 3 retries only failures the transport returns without retrying."""

    @pytest.mark.parametrize(
        "status,category,error_fragment,should_retry",
        [
            (401, "auth", "API key invalid", False),
            (402, "billing", "insufficient OpenRouter credits", False),
            (400, "unknown", "Unable to generate final synthesis", False),
            (None, "timeout", "", True),
            (None, "unknown", "Unable to generate final synthesis", False),
            (None, "transient", "", True),
            (500, "unknown", "", True),
            (504, "unknown", "", True),
        ],
    )
    async def test_gated_retry_for_immediate_failures(
        self,
        status: int | None,
        category: str,
        error_fragment: str,
        should_retry: bool,
    ) -> None:
        failure = ModelError("chairman", status, category, "provider failure")
        mock_query = AsyncMock(side_effect=[failure, CHAIRMAN_RESPONSE])
        with patch("backend.council.query_model", mock_query):
            result = await stage3_synthesize_final("test", STAGE1_RESULTS, STAGE2_RESULTS)
        if should_retry:
            assert result["response"] == "Synthesis result"
            assert mock_query.await_count == 2
        else:
            assert error_fragment in result["response"]
            mock_query.assert_awaited_once()

    async def _run_real_transport_stage3(
        self, status_code: int, succeed_on_attempt: int | None = 2
    ) -> tuple[dict[str, Any], list[httpx.Request], AsyncMock, int]:
        attempts: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            attempts.append(request)
            if succeed_on_attempt is not None and len(attempts) == succeed_on_attempt:
                return httpx.Response(
                    200,
                    json={
                        "choices": [{"message": {"content": "Synthesis result"}}],
                        "usage": {},
                    },
                )
            return httpx.Response(
                status_code,
                json={"error": {"message": "provider failure"}},
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            sleep = AsyncMock()
            query_calls = 0
            real_query = openrouter_module.query_model

            async def counted_query(
                model: str, messages: list[dict[str, str]]
            ) -> dict[str, Any] | ModelError:
                nonlocal query_calls
                query_calls += 1
                return await real_query(model, messages)

            with (
                patch("backend.council.query_model", side_effect=counted_query),
                patch.object(openrouter_module, "get_shared_client", return_value=client),
                patch.object(openrouter_module.asyncio, "sleep", sleep),
            ):
                result = await stage3_synthesize_final("test", STAGE1_RESULTS, STAGE2_RESULTS)

        return result, attempts, sleep, query_calls

    @pytest.mark.parametrize("status_code", [429, 503])
    async def test_real_transport_retries_429_and_503_once(self, status_code: int) -> None:
        result, attempts, sleep, query_calls = await self._run_real_transport_stage3(status_code)

        assert result["response"] == "Synthesis result"
        assert len(attempts) == 2
        assert query_calls == 1
        sleep.assert_awaited_once_with(RETRY_BASE_DELAY)

    @pytest.mark.parametrize("status_code", [429, 503])
    async def test_real_transport_exhaustion_is_not_retried_by_stage3(
        self, status_code: int
    ) -> None:
        result, attempts, sleep, query_calls = await self._run_real_transport_stage3(
            status_code, succeed_on_attempt=None
        )

        assert "Unable to generate final synthesis" in result["response"]
        assert len(attempts) == MAX_RETRIES
        assert query_calls == 1
        assert sleep.await_count == MAX_RETRIES - 1

    @pytest.mark.parametrize(
        "status,category",
        [(None, "timeout"), (None, "transient"), (500, "unknown"), (504, "unknown")],
    )
    async def test_immediate_failure_retry_is_bounded(
        self, status: int | None, category: str
    ) -> None:
        mock_query = AsyncMock(return_value=ModelError("chairman", status, category, "failure"))
        with patch("backend.council.query_model", mock_query):
            result = await stage3_synthesize_final("test", STAGE1_RESULTS, STAGE2_RESULTS)
        assert "Unable to generate final synthesis" in result["response"]
        assert mock_query.await_count == 2

    @pytest.mark.parametrize("error_type", [httpx.ReadTimeout, httpx.ConnectError])
    @pytest.mark.parametrize("fail_always", [False, True])
    async def test_real_transport_connection_and_timeout_retry(
        self, error_type: type[httpx.RequestError], fail_always: bool
    ) -> None:
        attempts = []

        def handler(request: httpx.Request) -> httpx.Response:
            attempts.append(request)
            if fail_always or len(attempts) == 1:
                raise error_type("transient transport failure", request=request)
            return httpx.Response(200, json={"choices": [{"message": {"content": "recovered"}}]})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with (
                patch.object(openrouter_module, "get_shared_client", return_value=client),
                patch.object(openrouter_module.asyncio, "sleep", new_callable=AsyncMock) as sleep,
                patch("backend.council.query_model", wraps=openrouter_module.query_model) as query,
            ):
                result = await stage3_synthesize_final("test", STAGE1_RESULTS, STAGE2_RESULTS)
        assert len(attempts) == 2
        assert query.await_count == 2
        sleep.assert_not_awaited()
        if fail_always:
            assert "Unable to generate final synthesis" in result["response"]
        else:
            assert result["response"] == "recovered"

    @pytest.mark.parametrize("failure", ["runtime", "malformed-response"])
    async def test_real_transport_unknown_failure_is_single_shot(self, failure: str) -> None:
        attempts = []

        def handler(request: httpx.Request) -> httpx.Response:
            attempts.append(request)
            if failure == "runtime":
                raise RuntimeError("unexpected failure")
            return httpx.Response(200, json={"choices": []})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with (
                patch.object(openrouter_module, "get_shared_client", return_value=client),
                patch("backend.council.query_model", wraps=openrouter_module.query_model) as query,
            ):
                result = await stage3_synthesize_final("test", STAGE1_RESULTS, STAGE2_RESULTS)
        assert "Unable to generate final synthesis" in result["response"]
        assert len(attempts) == 1
        query.assert_awaited_once()

    @pytest.mark.parametrize("status_code", [500, 504])
    async def test_real_transport_immediate_5xx_gets_one_stage3_retry(
        self, status_code: int
    ) -> None:
        result, attempts, sleep, query_calls = await self._run_real_transport_stage3(status_code)
        assert result["response"] == "Synthesis result"
        assert len(attempts) == 2
        assert query_calls == 2
        sleep.assert_not_awaited()

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
