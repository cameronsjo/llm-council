"""OpenRouter API client for making LLM requests."""

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator, Callable, Awaitable

import httpx

from .config import OPENROUTER_API_KEY, OPENROUTER_API_URL
from .telemetry import get_tracer, is_telemetry_enabled

logger = logging.getLogger(__name__)


# Type aliases for streaming callbacks
OnTokenCallback = Callable[[str, str], Awaitable[None]]  # (model, token) -> None
OnModelCompleteCallback = Callable[[str, dict | None], Awaitable[None]]  # (model, result) -> None
OnProgressCallback = Callable[[int, int, list[str], list[str]], Awaitable[None]]  # (completed, total, completed_models, pending_models) -> None

# Retry configuration
RETRYABLE_STATUS_CODES = {408, 429, 502, 503}
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # seconds, doubles each retry

async def _extract_error_message(response: httpx.Response) -> str:
    """Extract the error message from an OpenRouter error response body.

    OpenRouter returns: { "error": { "code": int, "message": str, "metadata": {...} } }
    Falls back to the raw status text if parsing fails.

    Calls aread() first to ensure the body is buffered — required when the
    response comes from a streaming request (client.stream()).
    """
    try:
        await response.aread()
        body = response.json()
        return body.get("error", {}).get("message", response.text[:200])
    except Exception:
        return f"HTTP {response.status_code}"


# Module-level shared client (lazy-initialized)
_shared_client: httpx.AsyncClient | None = None


def get_shared_client(timeout: float = 120.0) -> httpx.AsyncClient:
    """Get or create the shared httpx.AsyncClient for connection pooling."""
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient(
            timeout=timeout,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _shared_client


async def close_shared_client() -> None:
    """Close the shared client. Call on application shutdown."""
    global _shared_client
    if _shared_client is not None and not _shared_client.is_closed:
        await _shared_client.aclose()
        _shared_client = None


async def query_model(
    model: str,
    messages: list[dict[str, str]],
    timeout: float = 120.0
) -> dict[str, Any] | None:
    """
    Query a single model via OpenRouter API.

    Uses a shared connection pool and retries on transient errors (429/502/503).

    Args:
        model: OpenRouter model identifier (e.g., "openai/gpt-4o")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds

    Returns:
        Response dict with 'content', optional 'reasoning_details', and 'metrics', or None if failed
    """
    tracer = get_tracer()
    span_attributes = {
        "llm.model": model,
        "llm.message_count": len(messages),
    }

    with tracer.start_as_current_span("llm.query_model", attributes=span_attributes) as span:
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": model,
            "messages": messages,
        }

        client = get_shared_client(timeout)
        start_time = time.time()
        logger.debug("Beginning query_model. Model: %s, Messages: %d", model, len(messages))

        for attempt in range(MAX_RETRIES):
            try:
                response = await client.post(
                    OPENROUTER_API_URL,
                    headers=headers,
                    json=payload
                )
                response.raise_for_status()

                latency_ms = int((time.time() - start_time) * 1000)
                data = response.json()
                message = data['choices'][0]['message']
                usage = data.get('usage', {})

                result = {
                    'content': message.get('content'),
                    'reasoning_details': message.get('reasoning_details'),
                    'metrics': {
                        'prompt_tokens': usage.get('prompt_tokens', 0),
                        'completion_tokens': usage.get('completion_tokens', 0),
                        'total_tokens': usage.get('total_tokens', 0),
                        'cost': usage.get('cost', 0.0),
                        'latency_ms': latency_ms,
                        'actual_model': data.get('model'),
                        'request_id': data.get('id'),
                        'provider': data.get('provider'),
                    }
                }

                if is_telemetry_enabled():
                    span.set_attributes({
                        "llm.prompt_tokens": usage.get('prompt_tokens', 0),
                        "llm.completion_tokens": usage.get('completion_tokens', 0),
                        "llm.total_tokens": usage.get('total_tokens', 0),
                        "llm.latency_ms": latency_ms,
                        "llm.provider": data.get('provider', ''),
                    })

                logger.info(
                    "Successfully queried model. Model: %s, Tokens: %d, Duration: %dms",
                    model, usage.get('total_tokens', 0), latency_ms,
                )
                return result

            except httpx.HTTPStatusError as e:
                status = e.response.status_code
                error_msg = await _extract_error_message(e.response)

                if status in RETRYABLE_STATUS_CODES and attempt < MAX_RETRIES - 1:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(
                        "Retryable error querying %s (HTTP %d), attempt %d/%d. Retrying in %.1fs. Detail: %s",
                        model, status, attempt + 1, MAX_RETRIES, delay, error_msg,
                    )
                    await asyncio.sleep(delay)
                    continue

                if status == 402:
                    logger.error(
                        "Billing error querying %s: insufficient credits or payment required. Detail: %s",
                        model, error_msg,
                    )
                elif status == 401:
                    logger.error(
                        "Authentication error querying %s: invalid API key. Detail: %s",
                        model, error_msg,
                    )
                else:
                    logger.error(
                        "HTTP error querying %s (status %d). Detail: %s",
                        model, status, error_msg,
                    )

                if is_telemetry_enabled():
                    span.record_exception(e)
                    from opentelemetry.trace import Status, StatusCode
                    span.set_status(Status(StatusCode.ERROR, f"HTTP {status}: {error_msg}"))
                return None

            except httpx.TimeoutException as e:
                logger.error("Timeout querying %s after %.0fs: %s", model, timeout, e)
                if is_telemetry_enabled():
                    span.record_exception(e)
                    from opentelemetry.trace import Status, StatusCode
                    span.set_status(Status(StatusCode.ERROR, f"Timeout: {e}"))
                return None

            except Exception as e:
                logger.error("Unexpected error querying %s: %s", model, e)
                if is_telemetry_enabled():
                    span.record_exception(e)
                    from opentelemetry.trace import Status, StatusCode
                    span.set_status(Status(StatusCode.ERROR, str(e)))
                return None

        return None


async def query_models_parallel(
    models: list[str],
    messages: list[dict[str, str]] | None = None,
    custom_messages: dict[str, list[dict[str, str]]] | None = None,
) -> dict[str, dict[str, Any] | None]:
    """
    Query multiple models in parallel.

    Args:
        models: List of OpenRouter model identifiers
        messages: List of message dicts to send to ALL models (used if custom_messages not provided)
        custom_messages: Dict mapping model ID to its specific messages (for per-model prompts)

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    import asyncio

    tracer = get_tracer()
    span_attributes = {
        "llm.parallel_query": True,
        "llm.model_count": len(models),
        "llm.models": ",".join(models),
    }

    with tracer.start_as_current_span("llm.query_models_parallel", attributes=span_attributes) as span:
        logger.info(
            "Beginning parallel query. Models: %d (%s)",
            len(models), ", ".join(models),
        )
        parallel_start = time.time()

        # Create tasks for all models
        tasks = []
        for model in models:
            if custom_messages and model in custom_messages:
                model_messages = custom_messages[model]
            elif messages is not None:
                model_messages = messages
            else:
                raise ValueError(f"No messages provided for model {model}")
            tasks.append(query_model(model, model_messages))

        # Wait for all to complete
        responses = await asyncio.gather(*tasks)

        # Map models to their responses
        result = dict(zip(models, responses))

        # Record success/failure counts
        success_count = sum(1 for r in responses if r is not None)
        failure_count = len(responses) - success_count
        parallel_duration_ms = int((time.time() - parallel_start) * 1000)

        if failure_count > 0:
            failed_models = [m for m, r in result.items() if r is None]
            logger.warning(
                "Parallel query completed with failures. Succeeded: %d, Failed: %d, FailedModels: %s, Duration: %dms",
                success_count, failure_count, ", ".join(failed_models), parallel_duration_ms,
            )
        else:
            logger.info(
                "Successfully completed parallel query. Models: %d, Duration: %dms",
                success_count, parallel_duration_ms,
            )

        if is_telemetry_enabled():
            span.set_attributes({
                "llm.success_count": success_count,
                "llm.failure_count": failure_count,
            })

        return result


async def query_model_streaming(
    model: str,
    messages: list[dict[str, str]],
    on_token: OnTokenCallback | None = None,
    timeout: float = 120.0
) -> dict[str, Any] | None:
    """
    Query a single model via OpenRouter API with token-level streaming.

    Args:
        model: OpenRouter model identifier (e.g., "openai/gpt-4o")
        messages: List of message dicts with 'role' and 'content'
        on_token: Async callback for each token chunk: (model, token) -> None
        timeout: Request timeout in seconds

    Returns:
        Response dict with 'content', optional 'reasoning_details', and 'metrics', or None if failed
    """
    tracer = get_tracer()
    span_attributes = {
        "llm.model": model,
        "llm.message_count": len(messages),
        "llm.streaming": True,
    }

    with tracer.start_as_current_span("llm.query_model_streaming", attributes=span_attributes) as span:
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
        }

        client = get_shared_client(timeout)
        logger.debug("Beginning streaming query. Model: %s, Messages: %d", model, len(messages))

        for attempt in range(MAX_RETRIES):
            start_time = time.time()
            content_chunks: list[str] = []
            usage = {}

            try:
                async with client.stream(
                    "POST",
                    OPENROUTER_API_URL,
                    headers=headers,
                    json=payload
                ) as response:
                    response.raise_for_status()

                    # Extract metadata from first chunk
                    stream_model = None
                    stream_id = None
                    stream_provider = None

                    async for line in response.aiter_lines():
                        if not line or line.startswith(":"):
                            continue

                        if line.startswith("data: "):
                            data_str = line[6:]

                            if data_str == "[DONE]":
                                break

                            try:
                                data = json.loads(data_str)

                                # Capture metadata from first chunk
                                if stream_id is None:
                                    stream_model = data.get("model")
                                    stream_id = data.get("id")
                                    stream_provider = data.get("provider")

                                choices = data.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content")
                                    if content:
                                        content_chunks.append(content)
                                        if on_token:
                                            await on_token(model, content)

                                if "usage" in data:
                                    usage = data["usage"]

                            except json.JSONDecodeError:
                                continue

                latency_ms = int((time.time() - start_time) * 1000)
                full_content = "".join(content_chunks)

                result = {
                    'content': full_content,
                    'reasoning_details': None,
                    'metrics': {
                        'prompt_tokens': usage.get('prompt_tokens', 0),
                        'completion_tokens': usage.get('completion_tokens', 0),
                        'total_tokens': usage.get('total_tokens', 0),
                        'cost': usage.get('cost', 0.0),
                        'latency_ms': latency_ms,
                        'actual_model': stream_model,
                        'request_id': stream_id,
                        'provider': stream_provider,
                    }
                }

                if is_telemetry_enabled():
                    span.set_attributes({
                        "llm.prompt_tokens": usage.get('prompt_tokens', 0),
                        "llm.completion_tokens": usage.get('completion_tokens', 0),
                        "llm.total_tokens": usage.get('total_tokens', 0),
                        "llm.latency_ms": latency_ms,
                    })

                logger.info(
                    "Successfully streamed model. Model: %s, Tokens: %d, Duration: %dms",
                    model, usage.get('total_tokens', 0), latency_ms,
                )
                return result

            except httpx.HTTPStatusError as e:
                status = e.response.status_code
                error_msg = await _extract_error_message(e.response)

                if status in RETRYABLE_STATUS_CODES and attempt < MAX_RETRIES - 1:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(
                        "Retryable error streaming %s (HTTP %d), attempt %d/%d. Retrying in %.1fs. Detail: %s",
                        model, status, attempt + 1, MAX_RETRIES, delay, error_msg,
                    )
                    await asyncio.sleep(delay)
                    continue

                if status == 402:
                    logger.error(
                        "Billing error streaming %s: insufficient credits or payment required. Detail: %s",
                        model, error_msg,
                    )
                elif status == 401:
                    logger.error(
                        "Authentication error streaming %s: invalid API key. Detail: %s",
                        model, error_msg,
                    )
                else:
                    logger.error(
                        "HTTP error streaming %s (status %d). Detail: %s",
                        model, status, error_msg,
                    )

                if is_telemetry_enabled():
                    span.record_exception(e)
                    from opentelemetry.trace import Status, StatusCode
                    span.set_status(Status(StatusCode.ERROR, f"HTTP {status}: {error_msg}"))
                return None

            except httpx.TimeoutException as e:
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(
                        "Timeout streaming %s, attempt %d/%d. Retrying in %.1fs.",
                        model, attempt + 1, MAX_RETRIES, delay,
                    )
                    await asyncio.sleep(delay)
                    continue

                logger.error("Timeout streaming %s after %d attempts (%.0fs each): %s", model, MAX_RETRIES, timeout, e)
                if is_telemetry_enabled():
                    span.record_exception(e)
                    from opentelemetry.trace import Status, StatusCode
                    span.set_status(Status(StatusCode.ERROR, f"Timeout: {e}"))
                return None

            except Exception as e:
                logger.error("Unexpected error streaming %s: %s", model, e)
                if is_telemetry_enabled():
                    span.record_exception(e)
                    from opentelemetry.trace import Status, StatusCode
                    span.set_status(Status(StatusCode.ERROR, str(e)))
                return None

        return None


async def query_models_progressive(
    models: list[str],
    messages: list[dict[str, str]] | None = None,
    custom_messages: dict[str, list[dict[str, str]]] | None = None,
    on_model_complete: OnModelCompleteCallback | None = None,
    on_progress: OnProgressCallback | None = None,
    stream_tokens: bool = False,
    on_token: OnTokenCallback | None = None,
) -> dict[str, dict[str, Any] | None]:
    """
    Query multiple models in parallel with progressive results.

    Unlike query_models_parallel, this yields results as each model completes,
    allowing the caller to process responses immediately.

    Args:
        models: List of OpenRouter model identifiers
        messages: List of message dicts to send to ALL models
        custom_messages: Dict mapping model ID to its specific messages
        on_model_complete: Async callback when a model completes: (model, result) -> None
        on_progress: Async callback for progress updates: (completed, total, completed_models, pending_models) -> None
        stream_tokens: Whether to stream tokens from each model
        on_token: Async callback for token streaming: (model, token) -> None

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    tracer = get_tracer()
    span_attributes = {
        "llm.parallel_query": True,
        "llm.progressive": True,
        "llm.model_count": len(models),
        "llm.models": ",".join(models),
        "llm.stream_tokens": stream_tokens,
    }

    with tracer.start_as_current_span("llm.query_models_progressive", attributes=span_attributes) as span:
        logger.info(
            "Beginning progressive query. Models: %d, Streaming: %s",
            len(models), stream_tokens,
        )
        progressive_start = time.time()

        # Create tasks with model tracking
        task_to_model: dict[asyncio.Task, str] = {}
        pending_models = list(models)
        completed_models: list[str] = []
        results: dict[str, dict[str, Any] | None] = {}

        for model in models:
            if custom_messages and model in custom_messages:
                model_messages = custom_messages[model]
            elif messages is not None:
                model_messages = messages
            else:
                raise ValueError(f"No messages provided for model {model}")

            # Choose streaming or non-streaming query
            if stream_tokens:
                task = asyncio.create_task(
                    query_model_streaming(model, model_messages, on_token)
                )
            else:
                task = asyncio.create_task(
                    query_model(model, model_messages)
                )
            task_to_model[task] = model

        # Process tasks as they complete — asyncio.wait preserves Task identity
        pending: set[asyncio.Task] = set(task_to_model.keys())
        while pending:
            done, pending = await asyncio.wait(
                pending, return_when=asyncio.FIRST_COMPLETED
            )
            for completed_task in done:
                result = completed_task.result()
                model = task_to_model[completed_task]

                results[model] = result
                pending_models.remove(model)
                completed_models.append(model)

                if on_model_complete:
                    await on_model_complete(model, result)

                if on_progress:
                    await on_progress(
                        len(completed_models),
                        len(models),
                        completed_models.copy(),
                        pending_models.copy()
                    )

        # Record success/failure counts
        success_count = sum(1 for r in results.values() if r is not None)
        failure_count = len(results) - success_count
        progressive_duration_ms = int((time.time() - progressive_start) * 1000)

        if failure_count > 0:
            failed_models = [m for m, r in results.items() if r is None]
            logger.warning(
                "Progressive query completed with failures. Succeeded: %d, Failed: %d, FailedModels: %s, Duration: %dms",
                success_count, failure_count, ", ".join(failed_models), progressive_duration_ms,
            )
        else:
            logger.info(
                "Successfully completed progressive query. Models: %d, Duration: %dms",
                success_count, progressive_duration_ms,
            )

        if is_telemetry_enabled():
            span.set_attributes({
                "llm.success_count": success_count,
                "llm.failure_count": failure_count,
            })

        return results
