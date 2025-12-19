"""Model management for OpenRouter integration."""

import httpx
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from .config import OPENROUTER_API_KEY

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

# In-memory cache
_models_cache: Optional[Dict[str, Any]] = None
_cache_timestamp: Optional[datetime] = None
CACHE_DURATION = timedelta(hours=1)


async def fetch_available_models() -> List[Dict[str, Any]]:
    """
    Fetch available models from OpenRouter API.

    Returns:
        List of model dicts with id, name, pricing, context_length, provider
    """
    global _models_cache, _cache_timestamp

    # Return cached data if valid
    if _models_cache and _cache_timestamp:
        if datetime.utcnow() - _cache_timestamp < CACHE_DURATION:
            return _models_cache['data']

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(OPENROUTER_MODELS_URL, headers=headers)
            response.raise_for_status()
            data = response.json()

            # Filter and transform models
            models = []
            for model in data.get('data', []):
                # Filter for text-capable models
                if _is_text_model(model):
                    pricing = model.get('pricing', {})
                    models.append({
                        'id': model['id'],
                        'name': model.get('name', model['id']),
                        'context_length': model.get('context_length', 0),
                        'pricing': {
                            'prompt': float(pricing.get('prompt', 0) or 0),
                            'completion': float(pricing.get('completion', 0) or 0),
                        },
                        'provider': model['id'].split('/')[0] if '/' in model['id'] else 'unknown',
                    })

            # Sort by provider, then by name
            models.sort(key=lambda m: (m['provider'], m['name']))

            # Update cache
            _models_cache = {'data': models}
            _cache_timestamp = datetime.utcnow()

            return models

    except Exception as e:
        print(f"Error fetching models: {e}")
        # Return cached data even if stale, or empty list
        if _models_cache:
            return _models_cache['data']
        return []


def _is_text_model(model: Dict[str, Any]) -> bool:
    """
    Check if model supports text-to-text generation.

    Args:
        model: Model dict from OpenRouter API

    Returns:
        True if model is text-capable
    """
    model_id = model.get('id', '').lower()

    # Exclude known non-text models
    exclusion_patterns = [
        'dall-e',
        'whisper',
        'tts',
        'text-to-speech',
        'speech-to-text',
        'embedding',
        'moderation',
    ]

    for pattern in exclusion_patterns:
        if pattern in model_id:
            return False

    # Check architecture if available
    arch = model.get('architecture', {})
    modality = arch.get('modality', '')

    # Accept text->text or text+image->text (multimodal that outputs text)
    if modality:
        if 'text' not in modality.lower():
            return False

    return True


def invalidate_cache() -> None:
    """Force cache invalidation."""
    global _models_cache, _cache_timestamp
    _models_cache = None
    _cache_timestamp = None
