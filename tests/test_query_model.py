"""Tests for query_model: shared client, retry, differentiated errors."""

import asyncio
from contextlib import ExitStack
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

import backend.openrouter as openrouter_module
from backend.openrouter import (
    MAX_RETRIES,
    RETRYABLE_STATUS_CODES,
    ModelError,
    _classify_error,
    close_shared_client,
    get_shared_client,
    is_model_error,
    query_model,
    query_model_streaming,
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


_OPENROUTER_LOGGER = "backend.openrouter"


def _records(caplog, level: str) -> list:
    """Return caplog records emitted by the openrouter logger at ``level``."""
    return [
        r for r in caplog.records
        if r.levelname == level and r.name == _OPENROUTER_LOGGER
    ]


def _assert_log_severity(
    caplog,
    *,
    expect_warning: bool,
    expect_error: bool,
    context: str,
) -> None:
    """Assert openrouter log records match the expected severity contract.

    ``expect_warning`` requires at least one WARNING record; ``expect_error``
    flips between requiring at least one ERROR record (True) or none (False).
    Used by both TestQueryModelLogLevels and TestQueryModelStreamingLogLevels.
    """
    warning_records = _records(caplog, "WARNING")
    error_records = _records(caplog, "ERROR")
    if expect_warning:
        assert warning_records, f"{context} should emit a WARNING breadcrumb"
    else:
        assert warning_records == [], (
            f"{context} should not emit WARNING; got: "
            f"{[r.getMessage() for r in warning_records]}"
        )
    if expect_error:
        assert error_records, f"{context} should log at ERROR for Sentry visibility"
    else:
        assert error_records == [], (
            f"{context} must not log at ERROR; got: "
            f"{[r.getMessage() for r in error_records]}"
        )


class TestQueryModelLogLevels:
    """Per-model failures that the pipeline gracefully handles must not log at ERROR.

    Sentry's LoggingIntegration captures ERROR-level records as events. When the
    council pipeline degrades gracefully (some models fail, others succeed), each
    per-model failure becoming a Sentry event is noise. Genuine cross-cutting
    failures (auth, billing, unexpected exceptions) still escalate to ERROR.
    """

    def _make_status_error(self, status_code: int) -> httpx.HTTPStatusError:
        resp = httpx.Response(
            status_code=status_code,
            text="error",
            request=httpx.Request("POST", "https://example.com"),
        )
        return httpx.HTTPStatusError("err", request=resp.request, response=resp)

    async def _run_with_post_side_effect(self, side_effect, caplog, model="model-a"):
        with (
            patch.object(get_shared_client(), "post", AsyncMock(side_effect=side_effect)),
            caplog.at_level("DEBUG", logger=_OPENROUTER_LOGGER),
        ):
            return await query_model(model, [{"role": "user", "content": "hi"}])

    @pytest.mark.asyncio
    async def test_404_logs_at_warning_not_error(self, caplog):
        result = await self._run_with_post_side_effect(
            self._make_status_error(404), caplog, model="dead-model",
        )
        assert is_model_error(result)
        _assert_log_severity(
            caplog, expect_warning=True, expect_error=False, context="Per-model 404",
        )

    @pytest.mark.asyncio
    async def test_500_logs_at_warning_not_error(self, caplog):
        result = await self._run_with_post_side_effect(
            self._make_status_error(500), caplog,
        )
        assert is_model_error(result)
        _assert_log_severity(
            caplog, expect_warning=True, expect_error=False, context="Per-model 500",
        )

    @pytest.mark.asyncio
    async def test_401_still_logs_at_error(self, caplog):
        result = await self._run_with_post_side_effect(
            self._make_status_error(401), caplog,
        )
        assert is_model_error(result)
        _assert_log_severity(
            caplog, expect_warning=False, expect_error=True, context="401 auth failure",
        )

    @pytest.mark.asyncio
    async def test_402_still_logs_at_error(self, caplog):
        result = await self._run_with_post_side_effect(
            self._make_status_error(402), caplog,
        )
        assert is_model_error(result)
        _assert_log_severity(
            caplog, expect_warning=False, expect_error=True, context="402 billing failure",
        )

    @pytest.mark.asyncio
    async def test_timeout_logs_at_warning(self, caplog):
        result = await self._run_with_post_side_effect(
            httpx.TimeoutException("timed out"), caplog,
        )
        assert is_model_error(result)
        _assert_log_severity(
            caplog, expect_warning=True, expect_error=False, context="Per-model timeout",
        )

    @pytest.mark.asyncio
    async def test_unexpected_exception_still_logs_at_error(self, caplog):
        result = await self._run_with_post_side_effect(
            RuntimeError("something broke"), caplog,
        )
        assert is_model_error(result)
        _assert_log_severity(
            caplog, expect_warning=False, expect_error=True, context="Unexpected exception",
        )


class TestQueryModelStreamingLogLevels:
    """Mirror TestQueryModelLogLevels for the streaming code path.

    The streaming function has its own HTTP error / timeout / unexpected-exception
    branches. They must follow the same severity policy as the parallel path:
    per-model failures are warnings, cross-cutting failures (auth/billing/unknown)
    stay at error.
    """

    def _install_streaming_handler(self, handler):
        """Replace the shared client with one whose transport is driven by ``handler``.

        Returns a teardown callable that restores the previous client.
        """
        prev = openrouter_module._shared_client
        transport = httpx.MockTransport(handler)
        openrouter_module._shared_client = httpx.AsyncClient(transport=transport)

        async def teardown():
            await openrouter_module._shared_client.aclose()
            openrouter_module._shared_client = prev

        return teardown

    async def _run_streaming(self, handler, caplog, model="model-a", *, retry_zero=False):
        teardown = self._install_streaming_handler(handler)
        try:
            ctx_managers = [caplog.at_level("DEBUG", logger=_OPENROUTER_LOGGER)]
            if retry_zero:
                ctx_managers.append(patch("backend.openrouter.RETRY_BASE_DELAY", 0))
            with ExitStack() as stack:
                for cm in ctx_managers:
                    stack.enter_context(cm)
                return await query_model_streaming(
                    model, [{"role": "user", "content": "hi"}],
                )
        finally:
            await teardown()

    @pytest.mark.asyncio
    async def test_streaming_404_logs_at_warning_not_error(self, caplog):
        result = await self._run_streaming(
            lambda req: httpx.Response(404, json={"error": {"message": "no endpoints"}}),
            caplog, model="dead-model",
        )
        assert is_model_error(result)
        _assert_log_severity(
            caplog, expect_warning=True, expect_error=False, context="Streaming-mode 404",
        )

    @pytest.mark.asyncio
    async def test_streaming_500_logs_at_warning_not_error(self, caplog):
        result = await self._run_streaming(
            lambda req: httpx.Response(500, text="server error"),
            caplog,
        )
        assert is_model_error(result)
        _assert_log_severity(
            caplog, expect_warning=True, expect_error=False, context="Streaming-mode 500",
        )

    @pytest.mark.asyncio
    async def test_streaming_401_still_logs_at_error(self, caplog):
        result = await self._run_streaming(
            lambda req: httpx.Response(401, json={"error": {"message": "unauthorized"}}),
            caplog,
        )
        assert is_model_error(result)
        _assert_log_severity(
            caplog, expect_warning=False, expect_error=True, context="Streaming 401",
        )

    @pytest.mark.asyncio
    async def test_streaming_402_still_logs_at_error(self, caplog):
        result = await self._run_streaming(
            lambda req: httpx.Response(402, json={"error": {"message": "insufficient credits"}}),
            caplog,
        )
        assert is_model_error(result)
        _assert_log_severity(
            caplog, expect_warning=False, expect_error=True, context="Streaming 402",
        )

    @pytest.mark.asyncio
    async def test_streaming_timeout_logs_at_warning(self, caplog):
        def raise_timeout(req: httpx.Request) -> httpx.Response:
            raise httpx.TimeoutException("timed out", request=req)

        result = await self._run_streaming(raise_timeout, caplog, retry_zero=True)
        assert is_model_error(result)
        _assert_log_severity(
            caplog, expect_warning=True, expect_error=False, context="Streaming-mode timeout",
        )

    @pytest.mark.asyncio
    async def test_streaming_unexpected_exception_still_logs_at_error(self, caplog):
        def raise_runtime(req: httpx.Request) -> httpx.Response:
            raise RuntimeError("something broke")

        result = await self._run_streaming(raise_runtime, caplog)
        assert is_model_error(result)
        _assert_log_severity(
            caplog, expect_warning=False, expect_error=True, context="Streaming unexpected exception",
        )
