"""OpenRouter API client for making LLM requests."""

import time
import httpx
from typing import List, Dict, Any, Optional
from .config import OPENROUTER_API_KEY, OPENROUTER_API_URL


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = 120.0
) -> Optional[Dict[str, Any]]:
    """
    Query a single model via OpenRouter API.

    Args:
        model: OpenRouter model identifier (e.g., "openai/gpt-4o")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds

    Returns:
        Response dict with 'content', optional 'reasoning_details', and 'metrics', or None if failed
    """
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

            return {
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

    except Exception as e:
        print(f"Error querying model {model}: {e}")
        return None


async def query_models_parallel(
    models: List[str],
    messages: Optional[List[Dict[str, str]]] = None,
    custom_messages: Optional[Dict[str, List[Dict[str, str]]]] = None,
) -> Dict[str, Optional[Dict[str, Any]]]:
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
    return {model: response for model, response in zip(models, responses)}
