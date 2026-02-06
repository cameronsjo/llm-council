"""Tests for query_model: shared client, retry, differentiated errors."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.openrouter import (
    MAX_RETRIES,
    RETRYABLE_STATUS_CODES,
    close_shared_client,
    get_shared_client,
    query_model,
)


@pytest.fixture(autouse=True)
async def _reset_shared_client():
    """Reset the shared client before/after each test."""
    await close_shared_client()
    yield
    await close_shared_client()


class TestSharedClient:
    """Tests for get_shared_client / close_shared_client."""

    def test_returns_same_instance(self):
        client1 = get_shared_client()
        client2 = get_shared_client()
        assert client1 is client2

    @pytest.mark.asyncio
    async def test_recreates_after_close(self):
        client1 = get_shared_client()
        await close_shared_client()
        client2 = get_shared_client()
        assert client1 is not client2

    @pytest.mark.asyncio
    async def test_close_is_idempotent(self):
        await close_shared_client()
        await close_shared_client()  # should not raise


class TestQueryModel:
    """Tests for query_model function."""

    def _make_success_response(self, status_code: int = 200) -> httpx.Response:
        """Build a mock httpx.Response with valid OpenRouter JSON."""
        data = {
            "choices": [{"message": {"content": "hello world"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            "model": "openai/gpt-4o",
            "id": "req-123",
            "provider": "openai",
        }
        return httpx.Response(
            status_code=status_code,
            json=data,
            request=httpx.Request("POST", "https://example.com"),
        )

    def _make_error_response(self, status_code: int) -> httpx.Response:
        return httpx.Response(
            status_code=status_code,
            text="error",
            request=httpx.Request("POST", "https://example.com"),
        )

    @pytest.mark.asyncio
    async def test_success_returns_content_and_metrics(self):
        resp = self._make_success_response()

        with patch.object(get_shared_client(), "post", new_callable=AsyncMock, return_value=resp):
            result = await query_model("openai/gpt-4o", [{"role": "user", "content": "hi"}])

        assert result is not None
        assert result["content"] == "hello world"
        assert result["metrics"]["total_tokens"] == 15
        assert result["metrics"]["actual_model"] == "openai/gpt-4o"
        assert result["metrics"]["request_id"] == "req-123"

    @pytest.mark.asyncio
    async def test_retries_on_429(self):
        error_resp = self._make_error_response(429)
        success_resp = self._make_success_response()

        mock_post = AsyncMock(side_effect=[
            httpx.HTTPStatusError("rate limited", request=error_resp.request, response=error_resp),
            success_resp,
        ])

        with patch.object(get_shared_client(), "post", mock_post), \
             patch("backend.openrouter.RETRY_BASE_DELAY", 0):
            result = await query_model("model-a", [{"role": "user", "content": "hi"}])

        assert result is not None
        assert result["content"] == "hello world"
        assert mock_post.call_count == 2

    @pytest.mark.asyncio
    async def test_retries_on_502(self):
        error_resp = self._make_error_response(502)
        success_resp = self._make_success_response()

        mock_post = AsyncMock(side_effect=[
            httpx.HTTPStatusError("bad gateway", request=error_resp.request, response=error_resp),
            success_resp,
        ])

        with patch.object(get_shared_client(), "post", mock_post), \
             patch("backend.openrouter.RETRY_BASE_DELAY", 0):
            result = await query_model("model-a", [{"role": "user", "content": "hi"}])

        assert result is not None
        assert mock_post.call_count == 2

    @pytest.mark.asyncio
    async def test_gives_up_after_max_retries(self):
        error_resp = self._make_error_response(429)
        exc = httpx.HTTPStatusError("rate limited", request=error_resp.request, response=error_resp)

        mock_post = AsyncMock(side_effect=[exc] * MAX_RETRIES)

        with patch.object(get_shared_client(), "post", mock_post), \
             patch("backend.openrouter.RETRY_BASE_DELAY", 0):
            result = await query_model("model-a", [{"role": "user", "content": "hi"}])

        assert result is None
        assert mock_post.call_count == MAX_RETRIES

    @pytest.mark.asyncio
    async def test_no_retry_on_400(self):
        """Non-retryable HTTP errors fail immediately."""
        error_resp = self._make_error_response(400)
        exc = httpx.HTTPStatusError("bad request", request=error_resp.request, response=error_resp)

        mock_post = AsyncMock(side_effect=exc)

        with patch.object(get_shared_client(), "post", mock_post):
            result = await query_model("model-a", [{"role": "user", "content": "hi"}])

        assert result is None
        assert mock_post.call_count == 1

    @pytest.mark.asyncio
    async def test_timeout_returns_none(self):
        mock_post = AsyncMock(side_effect=httpx.TimeoutException("timed out"))

        with patch.object(get_shared_client(), "post", mock_post):
            result = await query_model("model-a", [{"role": "user", "content": "hi"}])

        assert result is None

    @pytest.mark.asyncio
    async def test_unexpected_error_returns_none(self):
        mock_post = AsyncMock(side_effect=RuntimeError("something broke"))

        with patch.object(get_shared_client(), "post", mock_post):
            result = await query_model("model-a", [{"role": "user", "content": "hi"}])

        assert result is None
