"""Regression coverage for live OpenRouter key reloads without real credentials."""

import httpx
import pytest

from backend import config, models, openrouter


@pytest.fixture(autouse=True)
def fake_reload(monkeypatch) -> None:
    """Exercise real reload while masking credentials and unrelated reload effects."""
    monkeypatch.setattr(config, "load_dotenv", lambda **kwargs: None)
    monkeypatch.setattr(config, "OPENROUTER_API_KEY", "fake-old-key")
    # Mask legacy import-time bindings in negative controls too.
    monkeypatch.setattr(openrouter, "OPENROUTER_API_KEY", "fake-old-key", raising=False)
    monkeypatch.setattr(models, "OPENROUTER_API_KEY", "fake-old-key", raising=False)
    monkeypatch.setattr(config, "TAVILY_API_KEY", config.TAVILY_API_KEY)
    monkeypatch.setenv("TAVILY_API_KEY", "")
    monkeypatch.setenv("OPENROUTER_API_KEY", "fake-new-key")
    from backend import auth, websearch

    monkeypatch.setattr(auth, "reload_trusted_proxy_ips", lambda: None)
    monkeypatch.setattr(websearch, "TAVILY_API_KEY", "", raising=False)


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
async def test_requests_use_reloaded_key(monkeypatch, streaming: bool) -> None:
    headers = []

    def handle(request: httpx.Request) -> httpx.Response:
        headers.append(request.headers["Authorization"])
        if streaming:
            return httpx.Response(
                200,
                text='data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n',
            )
        return httpx.Response(200, json={"choices": [{"message": {"content": "answer"}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        monkeypatch.setattr(openrouter, "get_shared_client", lambda timeout: client)
        query = openrouter.query_model_streaming if streaming else openrouter.query_model
        messages = [{"role": "user", "content": "hello"}]
        assert (await query("test/model", messages))["content"] == "answer"
        assert config.reload_config()["openrouter_configured"] is True
        assert (await query("test/model", messages))["content"] == "answer"

    assert headers == ["Bearer fake-old-key", "Bearer fake-new-key"]


@pytest.mark.asyncio
async def test_model_catalog_uses_reloaded_key(monkeypatch) -> None:
    headers = []

    def handle(request: httpx.Request) -> httpx.Response:
        headers.append(request.headers["Authorization"])
        return httpx.Response(200, json={"data": [{"id": "test/model"}]})

    client_type = httpx.AsyncClient
    monkeypatch.setattr(
        models.httpx,
        "AsyncClient",
        lambda **kwargs: client_type(transport=httpx.MockTransport(handle)),
    )
    monkeypatch.setattr(models, "_models_cache", None)
    monkeypatch.setattr(models, "_cache_timestamp", None)
    assert (await models.fetch_available_models())[0]["id"] == "test/model"
    config.reload_config()
    # Match the explicit /api/models/refresh path instead of serving cached metadata.
    models.invalidate_cache()
    assert (await models.fetch_available_models())[0]["id"] == "test/model"
    assert headers == ["Bearer fake-old-key", "Bearer fake-new-key"]
