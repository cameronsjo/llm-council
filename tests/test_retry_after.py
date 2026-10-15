"""Tests for Retry-After handling on both OpenRouter query paths."""

from collections.abc import Callable
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from backend import openrouter

QUERY_PATHS = ("query_model", "query_model_streaming")
RETRY_AFTER_CASES = (
    pytest.param("5", 429, 5.0, id="numeric"),
    pytest.param("2.5", 429, 2.5, id="fractional"),
    pytest.param("999", 429, 30.0, id="capped"),
    pytest.param("0", 429, openrouter.RETRY_BASE_DELAY, id="zero-uses-base"),
    pytest.param("0.5", 429, openrouter.RETRY_BASE_DELAY, id="smaller-uses-base"),
    pytest.param(None, 429, openrouter.RETRY_BASE_DELAY, id="missing"),
    pytest.param("later", 429, openrouter.RETRY_BASE_DELAY, id="invalid"),
    pytest.param("-2", 429, openrouter.RETRY_BASE_DELAY, id="negative"),
    pytest.param("NaN", 429, openrouter.RETRY_BASE_DELAY, id="nan"),
    pytest.param("inf", 429, openrouter.RETRY_BASE_DELAY, id="infinite"),
    pytest.param(
        "Wed, 21 Oct 2015 07:28:00 GMT",
        429,
        openrouter.RETRY_BASE_DELAY,
        id="http-date",
    ),
    pytest.param("10", 503, openrouter.RETRY_BASE_DELAY, id="503-ignores-header"),
)


def _success_response(streaming: bool) -> httpx.Response:
    if streaming:
        content = (
            'data: {"model":"test-model","choices":[{"delta":{"content":"ok"}}]}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(200, text=content)
    return httpx.Response(
        200,
        json={
            "choices": [{"message": {"content": "ok"}}],
            "usage": {},
            "model": "test-model",
        },
    )


def _error_response(status_code: int, retry_after: str | None) -> httpx.Response:
    headers = {"Retry-After": retry_after} if retry_after is not None else {}
    return httpx.Response(
        status_code,
        headers=headers,
        json={"error": {"message": "try again"}},
    )


async def _run_query_path(
    query_path: str,
    handler: Callable[[httpx.Request], httpx.Response],
    sleep: AsyncMock,
) -> dict[str, Any] | openrouter.ModelError:
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with (
            patch.object(openrouter, "get_shared_client", return_value=client),
            patch.object(openrouter.asyncio, "sleep", sleep),
        ):
            if query_path == "query_model":
                return await openrouter.query_model(
                    "test-model", [{"role": "user", "content": "hello"}]
                )
            return await openrouter.query_model_streaming(
                "test-model", [{"role": "user", "content": "hello"}]
            )


@pytest.mark.asyncio
@pytest.mark.parametrize("query_path", QUERY_PATHS)
@pytest.mark.parametrize("retry_after,status_code,expected_delay", RETRY_AFTER_CASES)
async def test_numeric_and_invalid_retry_after_values(
    query_path: str,
    retry_after: str | None,
    status_code: int,
    expected_delay: float,
) -> None:
    """Both public query paths honor only valid numeric 429 Retry-After values."""
    attempts = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        if len(attempts) == 1:
            return _error_response(status_code, retry_after)
        return _success_response(query_path == "query_model_streaming")

    sleep = AsyncMock()
    result = await _run_query_path(query_path, handler, sleep)

    assert not openrouter.is_model_error(result)
    assert result["content"] == "ok"
    assert len(attempts) == 2
    sleep.assert_awaited_once_with(expected_delay)


@pytest.mark.asyncio
@pytest.mark.parametrize("query_path", QUERY_PATHS)
@pytest.mark.parametrize(
    "retry_after,expected_delays",
    [(None, [1.0, 2.0]), ("5", [5.0, 5.0]), ("999", [30.0, 30.0])],
)
async def test_retry_exhaustion_has_one_sleep_per_retry(
    query_path: str, retry_after: str | None, expected_delays: list[float]
) -> None:
    """Exhaustion makes exactly MAX_RETRIES requests and MAX_RETRIES - 1 sleeps."""
    attempts = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        return _error_response(429, retry_after)

    sleep = AsyncMock()
    result = await _run_query_path(query_path, handler, sleep)

    assert openrouter.is_model_error(result)
    assert result.status_code == 429
    assert len(attempts) == openrouter.MAX_RETRIES
    assert sleep.await_count == openrouter.MAX_RETRIES - 1
    assert [call.args[0] for call in sleep.await_args_list] == expected_delays
