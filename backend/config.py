"""Configuration for the LLM Council."""

import json
import logging
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

# OpenRouter API key
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Tavily API key for web search (optional)
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

# Base data directory - configurable via environment
DATA_BASE_DIR = os.getenv("LLMCOUNCIL_DATA_DIR", "data")

# Default council members - list of OpenRouter model identifiers
DEFAULT_COUNCIL_MODELS = [
    "openai/gpt-5.1",
    "google/gemini-3-pro-preview",
    "anthropic/claude-sonnet-4.5",
    "x-ai/grok-4",
]

# Default chairman model - synthesizes final response
DEFAULT_CHAIRMAN_MODEL = "google/gemini-3-pro-preview"

# Arena mode defaults
DEFAULT_ARENA_ROUNDS = 3
MIN_ARENA_ROUNDS = 2
MAX_ARENA_ROUNDS = 10

# Keep backwards compatibility
COUNCIL_MODELS = DEFAULT_COUNCIL_MODELS
CHAIRMAN_MODEL = DEFAULT_CHAIRMAN_MODEL

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Data directory for conversation storage (used when auth disabled)
DATA_DIR = os.path.join(DATA_BASE_DIR, "conversations")

# User config file path
USER_CONFIG_FILE = os.path.join(DATA_BASE_DIR, "user_config.json")


def load_user_config() -> dict[str, Any]:
    """
    Load user configuration from file.

    Returns:
        Dict with user config or empty dict if not found
    """
    config_path = Path(USER_CONFIG_FILE)
    if config_path.exists():
        try:
            with open(config_path) as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return {}
    return {}


def save_user_config(config: dict[str, Any]) -> None:
    """
    Save user configuration to file.

    Args:
        config: Configuration dict to save
    """
    config_path = Path(USER_CONFIG_FILE)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)


def get_council_models() -> list[str]:
    """
    Get effective council models (user config or defaults).

    Returns:
        List of model identifiers
    """
    user_config = load_user_config()
    return user_config.get('council_models', DEFAULT_COUNCIL_MODELS)


def get_chairman_model() -> str:
    """
    Get effective chairman model (user config or default).

    Returns:
        Model identifier string
    """
    user_config = load_user_config()
    return user_config.get('chairman_model', DEFAULT_CHAIRMAN_MODEL)


def update_council_config(
    council_models: list[str] | None = None,
    chairman_model: str | None = None
) -> dict[str, Any]:
    """
    Update council configuration.

    Args:
        council_models: New list of council models (None to keep current)
        chairman_model: New chairman model (None to keep current)

    Returns:
        Updated config dict
    """
    config = load_user_config()

    if council_models is not None:
        config['council_models'] = council_models
    if chairman_model is not None:
        config['chairman_model'] = chairman_model

    save_user_config(config)
    return config


def get_curated_models() -> list[str]:
    """
    Get user's curated model list.

    Returns:
        List of curated model identifiers, or empty list if none curated
    """
    user_config = load_user_config()
    return user_config.get('curated_models', [])


def update_curated_models(model_ids: list[str]) -> list[str]:
    """
    Update the curated models list.

    Args:
        model_ids: List of model identifiers to save as curated

    Returns:
        Updated curated models list
    """
    config = load_user_config()
    config['curated_models'] = model_ids
    save_user_config(config)
    return model_ids


def reload_config() -> dict[str, Any]:
    """
    Reload configuration from .env and user config files.

    This allows updating API keys and other settings without restarting
    the server.

    Returns:
        Dict with reload status and current config
    """
    global OPENROUTER_API_KEY, TAVILY_API_KEY

    # Reload .env file
    load_dotenv(override=True)

    # Update module-level variables
    OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
    TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

    # Also update the websearch module's reference
    try:
        from . import websearch
        websearch.TAVILY_API_KEY = TAVILY_API_KEY
    except ImportError:
        pass

    logger.info("Configuration reloaded")

    return {
        "status": "reloaded",
        "openrouter_configured": bool(OPENROUTER_API_KEY),
        "tavily_configured": bool(TAVILY_API_KEY),
        "council_models": get_council_models(),
        "chairman_model": get_chairman_model(),
    }
