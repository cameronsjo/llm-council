"""Configuration for the LLM Council."""

import os
import json
from pathlib import Path
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv

load_dotenv()

# OpenRouter API key
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Tavily API key for web search (optional)
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

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

# Data directory for conversation storage
DATA_DIR = "data/conversations"

# User config file path
USER_CONFIG_FILE = "data/user_config.json"


def load_user_config() -> Dict[str, Any]:
    """
    Load user configuration from file.

    Returns:
        Dict with user config or empty dict if not found
    """
    config_path = Path(USER_CONFIG_FILE)
    if config_path.exists():
        try:
            with open(config_path, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def save_user_config(config: Dict[str, Any]) -> None:
    """
    Save user configuration to file.

    Args:
        config: Configuration dict to save
    """
    config_path = Path(USER_CONFIG_FILE)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)


def get_council_models() -> List[str]:
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
    council_models: Optional[List[str]] = None,
    chairman_model: Optional[str] = None
) -> Dict[str, Any]:
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
