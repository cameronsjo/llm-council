"""Regression tests for retries before and after streamed content."""

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

import httpx
import pytest

from backend import openrouter


class InterruptedStream(httpx.AsyncByteStream):
    def __init__(self, content: str | None) -> None:
        self.content = content

    async def __aiter__(self) -> AsyncIterator[bytes]:
        import json

        delta = {"content": self.content} if self.content else {"role": "assistant"}
        yield ("data: " + json.dumps({"choices": [{"delta": delta}]}) + "\n\n").encode()
        raise httpx.ReadTimeout("connection stalled")


@pytest.mark.parametrize("initial_content", [None, "partial response"])
async def test_timeout_retries_only_before_content(
    initial_content: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    attempts = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        if len(attempts) == 1:
            return httpx.Response(200, stream=InterruptedStream(initial_content))
        return httpx.Response(
            200,
            text='data: {"choices":[{"delta":{"content":"complete response"}}]}\n\ndata: [DONE]\n\n',
        )

    sleep = AsyncMock()
    on_token = AsyncMock()
    monkeypatch.setattr(openrouter.asyncio, "sleep", sleep)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        monkeypatch.setattr(openrouter, "get_shared_client", lambda timeout: client)
        result = await openrouter.query_model_streaming(
            "test-model", [{"role": "user", "content": "question"}], on_token=on_token
        )

    if initial_content:
        assert openrouter.is_model_error(result)
        assert result.category == "timeout"
        assert len(attempts) == 1
        sleep.assert_not_awaited()
        on_token.assert_awaited_once_with("test-model", initial_content)
    else:
        assert result["content"] == "complete response"
        assert len(attempts) == 2
        sleep.assert_awaited_once_with(openrouter.RETRY_BASE_DELAY)
        on_token.assert_awaited_once_with("test-model", "complete response")
