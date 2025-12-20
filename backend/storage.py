"""JSON-based storage for conversations."""

import json
import os
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
from .config import DATA_DIR, DATA_BASE_DIR


def get_user_data_dir(user_id: str) -> str:
    """Get user-specific data directory.

    Args:
        user_id: Username/ID for the user

    Returns:
        Path to user's data directory
    """
    return os.path.join(DATA_BASE_DIR, "users", user_id, "conversations")


def get_data_dir(user_id: Optional[str] = None) -> str:
    """Get the appropriate data directory.

    Args:
        user_id: Optional username for user-scoped storage

    Returns:
        Path to the data directory
    """
    if user_id:
        return get_user_data_dir(user_id)
    return DATA_DIR


def ensure_data_dir(user_id: Optional[str] = None) -> None:
    """Ensure the data directory exists.

    Args:
        user_id: Optional username for user-scoped storage
    """
    Path(get_data_dir(user_id)).mkdir(parents=True, exist_ok=True)


def get_conversation_path(conversation_id: str, user_id: Optional[str] = None) -> str:
    """Get the file path for a conversation.

    Args:
        conversation_id: Unique conversation identifier
        user_id: Optional username for user-scoped storage

    Returns:
        Full path to the conversation JSON file
    """
    return os.path.join(get_data_dir(user_id), f"{conversation_id}.json")


def create_conversation(
    conversation_id: str, user_id: Optional[str] = None
) -> Dict[str, Any]:
    """Create a new conversation.

    Args:
        conversation_id: Unique identifier for the conversation
        user_id: Optional username for user-scoped storage

    Returns:
        New conversation dict
    """
    ensure_data_dir(user_id)

    conversation = {
        "id": conversation_id,
        "created_at": datetime.utcnow().isoformat(),
        "title": "New Conversation",
        "messages": [],
    }

    # Save to file
    path = get_conversation_path(conversation_id, user_id)
    with open(path, "w") as f:
        json.dump(conversation, f, indent=2)

    return conversation


def get_conversation(
    conversation_id: str, user_id: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Load a conversation from storage.

    Args:
        conversation_id: Unique identifier for the conversation
        user_id: Optional username for user-scoped storage

    Returns:
        Conversation dict or None if not found
    """
    path = get_conversation_path(conversation_id, user_id)

    if not os.path.exists(path):
        return None

    with open(path, "r") as f:
        return json.load(f)


def save_conversation(
    conversation: Dict[str, Any], user_id: Optional[str] = None
) -> None:
    """Save a conversation to storage.

    Args:
        conversation: Conversation dict to save
        user_id: Optional username for user-scoped storage
    """
    ensure_data_dir(user_id)

    path = get_conversation_path(conversation["id"], user_id)
    with open(path, "w") as f:
        json.dump(conversation, f, indent=2)


def list_conversations(user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """List all conversations (metadata only).

    Args:
        user_id: Optional username for user-scoped storage

    Returns:
        List of conversation metadata dicts
    """
    ensure_data_dir(user_id)
    data_dir = get_data_dir(user_id)

    conversations = []
    for filename in os.listdir(data_dir):
        if filename.endswith(".json"):
            path = os.path.join(data_dir, filename)
            with open(path, "r") as f:
                data = json.load(f)
                # Return metadata only
                conversations.append(
                    {
                        "id": data["id"],
                        "created_at": data["created_at"],
                        "title": data.get("title", "New Conversation"),
                        "message_count": len(data["messages"]),
                    }
                )

    # Sort by creation time, newest first
    conversations.sort(key=lambda x: x["created_at"], reverse=True)

    return conversations


def add_user_message(
    conversation_id: str, content: str, user_id: Optional[str] = None
) -> None:
    """Add a user message to a conversation.

    Args:
        conversation_id: Conversation identifier
        content: User message content
        user_id: Optional username for user-scoped storage
    """
    conversation = get_conversation(conversation_id, user_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({"role": "user", "content": content})

    save_conversation(conversation, user_id)


def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: List[Dict[str, Any]],
    stage3: Dict[str, Any],
    metrics: Optional[Dict[str, Any]] = None,
    user_id: Optional[str] = None,
) -> None:
    """Add an assistant message with all 3 stages to a conversation.

    Args:
        conversation_id: Conversation identifier
        stage1: List of individual model responses
        stage2: List of model rankings
        stage3: Final synthesized response
        metrics: Optional aggregated metrics for this response
        user_id: Optional username for user-scoped storage
    """
    conversation = get_conversation(conversation_id, user_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message = {
        "role": "assistant",
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3,
    }

    if metrics:
        message["metrics"] = metrics

    conversation["messages"].append(message)
    save_conversation(conversation, user_id)


def update_conversation_title(
    conversation_id: str, title: str, user_id: Optional[str] = None
) -> None:
    """Update the title of a conversation.

    Args:
        conversation_id: Conversation identifier
        title: New title for the conversation
        user_id: Optional username for user-scoped storage
    """
    conversation = get_conversation(conversation_id, user_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["title"] = title
    save_conversation(conversation, user_id)


def add_arena_message(
    conversation_id: str,
    rounds: List[Dict[str, Any]],
    synthesis: Dict[str, Any],
    participant_mapping: Dict[str, str],
    metrics: Optional[Dict[str, Any]] = None,
    user_id: Optional[str] = None,
) -> None:
    """Add an arena debate result as an assistant message.

    Args:
        conversation_id: Conversation identifier
        rounds: List of debate rounds, each with round_number, round_type, and responses
        synthesis: Final synthesis with consensus, answer, and dissents
        participant_mapping: Map of participant labels to model identifiers
        metrics: Optional aggregated metrics for this debate
        user_id: Optional username for user-scoped storage
    """
    conversation = get_conversation(conversation_id, user_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message = {
        "role": "assistant",
        "mode": "arena",
        "rounds": rounds,
        "synthesis": synthesis,
        "participant_mapping": participant_mapping,
    }

    if metrics:
        message["metrics"] = metrics

    conversation["messages"].append(message)
    save_conversation(conversation, user_id)
