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


async def query_model(
    model: str,
    messages: list[dict[str, str]],
    timeout: float = 120.0
) -> dict[str, Any] | None:
    """
    Query a single model via OpenRouter API.

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

        start_time = time.time()

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
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

                # Add response metrics to span
                if is_telemetry_enabled():
                    span.set_attributes({
                        "llm.prompt_tokens": usage.get('prompt_tokens', 0),
                        "llm.completion_tokens": usage.get('completion_tokens', 0),
                        "llm.total_tokens": usage.get('total_tokens', 0),
                        "llm.latency_ms": latency_ms,
                        "llm.provider": data.get('provider', ''),
                    })

                return result

        except Exception as e:
            logger.warning("Error querying model %s: %s", model, e)
            if is_telemetry_enabled():
                span.record_exception(e)
                from opentelemetry.trace import Status, StatusCode
                span.set_status(Status(StatusCode.ERROR, str(e)))
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
        if is_telemetry_enabled():
            success_count = sum(1 for r in responses if r is not None)
            failure_count = len(responses) - success_count
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

        start_time = time.time()
        content_chunks: list[str] = []
        usage = {}

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST",
                    OPENROUTER_API_URL,
                    headers=headers,
                    json=payload
                ) as response:
                    response.raise_for_status()

                    async for line in response.aiter_lines():
                        # Skip empty lines and comments
                        if not line or line.startswith(":"):
                            continue

                        # Parse SSE data
                        if line.startswith("data: "):
                            data_str = line[6:]

                            # Check for end of stream
                            if data_str == "[DONE]":
                                break

                            try:
                                data = json.loads(data_str)

                                # Extract delta content
                                choices = data.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content")
                                    if content:
                                        content_chunks.append(content)
                                        if on_token:
                                            await on_token(model, content)

                                # Extract usage from final chunk
                                if "usage" in data:
                                    usage = data["usage"]

                            except json.JSONDecodeError:
                                # Ignore non-JSON payloads (comments, etc.)
                                continue

            latency_ms = int((time.time() - start_time) * 1000)
            full_content = "".join(content_chunks)

            result = {
                'content': full_content,
                'reasoning_details': None,  # Not available in streaming mode
                'metrics': {
                    'prompt_tokens': usage.get('prompt_tokens', 0),
                    'completion_tokens': usage.get('completion_tokens', 0),
                    'total_tokens': usage.get('total_tokens', 0),
                    'cost': usage.get('cost', 0.0),
                    'latency_ms': latency_ms,
                    'actual_model': None,  # Not available in streaming
                    'request_id': None,
                    'provider': None,
                }
            }

            # Add response metrics to span
            if is_telemetry_enabled():
                span.set_attributes({
                    "llm.prompt_tokens": usage.get('prompt_tokens', 0),
                    "llm.completion_tokens": usage.get('completion_tokens', 0),
                    "llm.total_tokens": usage.get('total_tokens', 0),
                    "llm.latency_ms": latency_ms,
                })

            return result

        except Exception as e:
            logger.warning("Error streaming from model %s: %s", model, e)
            if is_telemetry_enabled():
                span.record_exception(e)
                from opentelemetry.trace import Status, StatusCode
                span.set_status(Status(StatusCode.ERROR, str(e)))
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
        if is_telemetry_enabled():
            success_count = sum(1 for r in results.values() if r is not None)
            failure_count = len(results) - success_count
            span.set_attributes({
                "llm.success_count": success_count,
                "llm.failure_count": failure_count,
            })

        return results
