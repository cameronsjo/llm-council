"""Tests for query_model: shared client, retry, differentiated errors."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.openrouter import (
    MAX_RETRIES,
    RETRYABLE_STATUS_CODES,
    ModelError,
    _classify_error,
    close_shared_client,
    get_shared_client,
    is_model_error,
    query_model,
)


class TestModelError:
    """Tests for ModelError dataclass, _classify_error, and is_model_error."""

    def test_model_error_fields(self):
        err = ModelError(model="openai/gpt-4o", status_code=402, category="billing", message="Insufficient credits")
        assert err.model == "openai/gpt-4o"
        assert err.status_code == 402
        assert err.category == "billing"
        assert err.message == "Insufficient credits"

    def test_model_error_is_frozen(self):
        err = ModelError(model="m", status_code=500, category="unknown", message="fail")
        with pytest.raises(AttributeError):
            err.model = "other"

    def test_to_dict(self):
        err = ModelError(model="m", status_code=429, category="rate_limit", message="slow down")
        d = err.to_dict()
        assert d == {"model": "m", "status_code": 429, "category": "rate_limit", "message": "slow down"}

    def test_to_dict_with_none_status(self):
        err = ModelError(model="m", status_code=None, category="timeout", message="timed out")
        assert err.to_dict()["status_code"] is None

    @pytest.mark.parametrize("status,expected", [
        (402, "billing"),
        (401, "auth"),
        (429, "rate_limit"),
        (408, "transient"),
        (502, "transient"),
        (503, "transient"),
        (None, "timeout"),
        (400, "unknown"),
        (500, "unknown"),
        (200, "unknown"),
    ])
    def test_classify_error(self, status: int | None, expected: str):
        assert _classify_error(status) == expected

    def test_is_model_error_true(self):
        err = ModelError(model="m", status_code=500, category="unknown", message="fail")
        assert is_model_error(err) is True

    def test_is_model_error_false_for_dict(self):
        assert is_model_error({"content": "hello"}) is False

    def test_is_model_error_false_for_none(self):
        assert is_model_error(None) is False

    def test_is_model_error_false_for_string(self):
        assert is_model_error("error") is False


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

        assert is_model_error(result)
        assert result.model == "model-a"
        assert result.status_code == 429
        assert result.category == "rate_limit"
        assert mock_post.call_count == MAX_RETRIES

    @pytest.mark.asyncio
    async def test_no_retry_on_400(self):
        """Non-retryable HTTP errors fail immediately."""
        error_resp = self._make_error_response(400)
        exc = httpx.HTTPStatusError("bad request", request=error_resp.request, response=error_resp)

        mock_post = AsyncMock(side_effect=exc)

        with patch.object(get_shared_client(), "post", mock_post):
            result = await query_model("model-a", [{"role": "user", "content": "hi"}])

        assert is_model_error(result)
        assert result.status_code == 400
        assert result.category == "unknown"
        assert mock_post.call_count == 1

    @pytest.mark.asyncio
    async def test_timeout_returns_model_error(self):
        mock_post = AsyncMock(side_effect=httpx.TimeoutException("timed out"))

        with patch.object(get_shared_client(), "post", mock_post):
            result = await query_model("model-a", [{"role": "user", "content": "hi"}])

        assert is_model_error(result)
        assert result.status_code is None
        assert result.category == "timeout"

    @pytest.mark.asyncio
    async def test_unexpected_error_returns_model_error(self):
        mock_post = AsyncMock(side_effect=RuntimeError("something broke"))

        with patch.object(get_shared_client(), "post", mock_post):
            result = await query_model("model-a", [{"role": "user", "content": "hi"}])

        assert is_model_error(result)
        assert result.status_code is None
        assert result.category == "unknown"
        assert "something broke" in result.message
