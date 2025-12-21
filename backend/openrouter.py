"""OpenRouter API client for making LLM requests."""

import logging
import time
from typing import Any

import httpx

from .config import OPENROUTER_API_KEY, OPENROUTER_API_URL
from .telemetry import get_tracer, is_telemetry_enabled

logger = logging.getLogger(__name__)


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
