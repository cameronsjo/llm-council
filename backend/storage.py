"""JSON-based storage for conversations."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import DATA_BASE_DIR, DATA_DIR, get_chairman_model, get_council_models
from .deliberation import DeliberationResult

# Timeout for stale pending responses (10 minutes)
PENDING_STALE_TIMEOUT_SECONDS = 600


def get_user_data_dir(user_id: str) -> str:
    """Get user-specific data directory.

    Args:
        user_id: Username/ID for the user

    Returns:
        Path to user's data directory
    """
    return os.path.join(DATA_BASE_DIR, "users", user_id, "conversations")


def get_data_dir(user_id: str | None = None) -> str:
    """Get the appropriate data directory.

    Args:
        user_id: Optional username for user-scoped storage

    Returns:
        Path to the data directory
    """
    if user_id:
        return get_user_data_dir(user_id)
    return DATA_DIR


def ensure_data_dir(user_id: str | None = None) -> None:
    """Ensure the data directory exists.

    Args:
        user_id: Optional username for user-scoped storage
    """
    Path(get_data_dir(user_id)).mkdir(parents=True, exist_ok=True)


def get_conversation_path(conversation_id: str, user_id: str | None = None) -> str:
    """Get the file path for a conversation.

    Args:
        conversation_id: Unique conversation identifier
        user_id: Optional username for user-scoped storage

    Returns:
        Full path to the conversation JSON file
    """
    return os.path.join(get_data_dir(user_id), f"{conversation_id}.json")


def create_conversation(
    conversation_id: str,
    user_id: str | None = None,
    council_models: list[str] | None = None,
    chairman_model: str | None = None,
) -> dict[str, Any]:
    """Create a new conversation.

    Args:
        conversation_id: Unique identifier for the conversation
        user_id: Optional username for user-scoped storage
        council_models: Optional list of council models (inherits global if None)
        chairman_model: Optional chairman model (inherits global if None)

    Returns:
        New conversation dict
    """
    ensure_data_dir(user_id)

    # Inherit from global config if not specified
    effective_council = council_models if council_models else get_council_models()
    effective_chairman = chairman_model if chairman_model else get_chairman_model()

    conversation = {
        "id": conversation_id,
        "created_at": datetime.utcnow().isoformat(),
        "title": "New Conversation",
        "council_models": effective_council,
        "chairman_model": effective_chairman,
        "messages": [],
    }

    # Save to file
    path = get_conversation_path(conversation_id, user_id)
    with open(path, "w") as f:
        json.dump(conversation, f, indent=2)

    return conversation


def get_conversation_config(
    conversation_id: str, user_id: str | None = None
) -> tuple[list[str], str]:
    """Get council configuration for a conversation with fallback to global.

    Args:
        conversation_id: Conversation identifier
        user_id: Optional username for user-scoped storage

    Returns:
        Tuple of (council_models, chairman_model)
    """
    conversation = get_conversation(conversation_id, user_id)
    if conversation:
        council = conversation.get("council_models")
        chairman = conversation.get("chairman_model")
        # Fall back to global if not set in conversation
        if council is None:
            council = get_council_models()
        if chairman is None:
            chairman = get_chairman_model()
        return council, chairman
    return get_council_models(), get_chairman_model()


def get_conversation(
    conversation_id: str,
    user_id: str | None = None,
    migrate_messages: bool = True,
) -> dict[str, Any] | None:
    """Load a conversation from storage.

    Args:
        conversation_id: Unique identifier for the conversation
        user_id: Optional username for user-scoped storage
        migrate_messages: Whether to convert legacy messages to unified format

    Returns:
        Conversation dict or None if not found
    """
    path = get_conversation_path(conversation_id, user_id)

    if not os.path.exists(path):
        return None

    with open(path) as f:
        conversation = json.load(f)

    # Optionally migrate legacy messages to unified format
    if migrate_messages:
        conversation = migrate_legacy_messages(conversation)

    return conversation


def migrate_legacy_messages(conversation: dict[str, Any]) -> dict[str, Any]:
    """Migrate legacy messages to unified format in-memory.

    This converts old stage1/stage2/stage3 format to the unified rounds format
    without modifying the stored file (lazy migration).

    Args:
        conversation: Conversation dict

    Returns:
        Conversation with migrated messages
    """
    from .council import convert_legacy_message_to_unified

    messages = conversation.get("messages", [])
    migrated_messages = []

    for msg in messages:
        if msg.get("role") == "assistant":
            # Check if it's legacy council format (has stage1 but no rounds)
            if "stage1" in msg and "rounds" not in msg:
                migrated_messages.append(convert_legacy_message_to_unified(msg))
            else:
                migrated_messages.append(msg)
        else:
            migrated_messages.append(msg)

    conversation["messages"] = migrated_messages
    return conversation


def save_conversation(
    conversation: dict[str, Any], user_id: str | None = None
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


def list_conversations(user_id: str | None = None) -> list[dict[str, Any]]:
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
            with open(path) as f:
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
    conversation_id: str, content: str, user_id: str | None = None
) -> None:
    """Add a user message to a conversation.

    Args:
        conversation_id: Conversation identifier
        content: User message content
        user_id: Optional username for user-scoped storage
    """
    conversation = get_conversation(conversation_id, user_id, migrate_messages=False)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({"role": "user", "content": content})

    save_conversation(conversation, user_id)


def add_assistant_message(
    conversation_id: str,
    stage1: list[dict[str, Any]],
    stage2: list[dict[str, Any]],
    stage3: dict[str, Any],
    metrics: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> None:
    """Add an assistant message with all 3 stages to a conversation.

    Note: This is the legacy format. New code should use add_unified_message().

    Args:
        conversation_id: Conversation identifier
        stage1: List of individual model responses
        stage2: List of model rankings
        stage3: Final synthesized response
        metrics: Optional aggregated metrics for this response
        user_id: Optional username for user-scoped storage
    """
    conversation = get_conversation(conversation_id, user_id, migrate_messages=False)
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
    conversation_id: str, title: str, user_id: str | None = None
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


def delete_conversation(
    conversation_id: str, user_id: str | None = None
) -> bool:
    """Delete a conversation from storage.

    Args:
        conversation_id: Conversation identifier
        user_id: Optional username for user-scoped storage

    Returns:
        True if deleted, False if not found
    """
    path = get_conversation_path(conversation_id, user_id)

    if not os.path.exists(path):
        return False

    os.remove(path)
    return True


def add_arena_message(
    conversation_id: str,
    rounds: list[dict[str, Any]],
    synthesis: dict[str, Any],
    participant_mapping: dict[str, str],
    metrics: dict[str, Any] | None = None,
    user_id: str | None = None,
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
    conversation = get_conversation(conversation_id, user_id, migrate_messages=False)
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


def add_unified_message(
    conversation_id: str,
    result: DeliberationResult,
    user_id: str | None = None,
) -> None:
    """Add a unified deliberation result as an assistant message.

    This is the preferred method for storing new messages in the unified format.

    Args:
        conversation_id: Conversation identifier
        result: DeliberationResult from either council or arena mode
        user_id: Optional username for user-scoped storage
    """
    conversation = get_conversation(conversation_id, user_id, migrate_messages=False)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message = result.to_dict()
    message["role"] = "assistant"

    conversation["messages"].append(message)
    save_conversation(conversation, user_id)


def update_last_arena_message(
    conversation_id: str,
    result: DeliberationResult,
    user_id: str | None = None,
) -> None:
    """Update the last arena message with extended debate results.

    This replaces the last assistant message (which should be an arena debate)
    with updated rounds and synthesis.

    Args:
        conversation_id: Conversation identifier
        result: Updated DeliberationResult with extended debate
        user_id: Optional username for user-scoped storage
    """
    conversation = get_conversation(conversation_id, user_id, migrate_messages=False)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    # Find and replace the last arena message
    for i in range(len(conversation["messages"]) - 1, -1, -1):
        msg = conversation["messages"][i]
        if msg.get("role") == "assistant" and msg.get("mode") == "arena":
            message = result.to_dict()
            message["role"] = "assistant"
            conversation["messages"][i] = message
            save_conversation(conversation, user_id)
            return

    raise ValueError("No arena message found to update")


# =============================================================================
# Pending Message Tracking
# =============================================================================


def get_pending_file_path(user_id: str | None = None) -> str:
    """Get the path to the pending messages file.

    Args:
        user_id: Optional username for user-scoped storage

    Returns:
        Path to pending.json
    """
    if user_id:
        base_dir = os.path.join(DATA_BASE_DIR, "users", user_id)
    else:
        base_dir = DATA_BASE_DIR
    return os.path.join(base_dir, "pending.json")


def load_pending_messages(user_id: str | None = None) -> dict[str, Any]:
    """Load all pending messages from file.

    Args:
        user_id: Optional username for user-scoped storage

    Returns:
        Dict of conversation_id -> pending message info
    """
    path = get_pending_file_path(user_id)
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return {}
    return {}


def save_pending_messages(
    pending: dict[str, Any], user_id: str | None = None
) -> None:
    """Save pending messages to file.

    Args:
        pending: Dict of pending messages
        user_id: Optional username for user-scoped storage
    """
    path = get_pending_file_path(user_id)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(pending, f, indent=2)


def mark_response_pending(
    conversation_id: str,
    mode: str,
    user_content: str,
    user_id: str | None = None,
) -> None:
    """Mark a response as pending (in-progress).

    Args:
        conversation_id: Conversation identifier
        mode: "council" or "arena"
        user_content: The user's original question
        user_id: Optional username for user-scoped storage
    """
    pending = load_pending_messages(user_id)
    pending[conversation_id] = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "user_content": user_content,
        "partial_data": {},
        "last_update": datetime.now(timezone.utc).isoformat(),
    }
    save_pending_messages(pending, user_id)


def update_pending_progress(
    conversation_id: str,
    partial_data: dict[str, Any],
    user_id: str | None = None,
) -> None:
    """Update the progress of a pending response.

    Args:
        conversation_id: Conversation identifier
        partial_data: Partial results to store
        user_id: Optional username for user-scoped storage
    """
    pending = load_pending_messages(user_id)
    if conversation_id in pending:
        pending[conversation_id]["partial_data"] = partial_data
        pending[conversation_id]["last_update"] = datetime.now(timezone.utc).isoformat()
        save_pending_messages(pending, user_id)


def clear_pending(
    conversation_id: str, user_id: str | None = None
) -> None:
    """Clear a pending response marker (on success).

    Args:
        conversation_id: Conversation identifier
        user_id: Optional username for user-scoped storage
    """
    pending = load_pending_messages(user_id)
    if conversation_id in pending:
        del pending[conversation_id]
        save_pending_messages(pending, user_id)


def get_pending_message(
    conversation_id: str, user_id: str | None = None
) -> dict[str, Any] | None:
    """Get pending message info for a conversation.

    Args:
        conversation_id: Conversation identifier
        user_id: Optional username for user-scoped storage

    Returns:
        Pending message info or None
    """
    pending = load_pending_messages(user_id)
    return pending.get(conversation_id)


def is_pending_stale(
    pending_info: dict[str, Any],
    timeout_seconds: int = PENDING_STALE_TIMEOUT_SECONDS,
) -> bool:
    """Check if a pending response is stale (timed out).

    Args:
        pending_info: Pending message info dict
        timeout_seconds: Timeout threshold in seconds

    Returns:
        True if stale, False otherwise
    """
    last_update_str = pending_info.get("last_update") or pending_info.get("started_at")
    if not last_update_str:
        return True

    try:
        last_update = datetime.fromisoformat(last_update_str.replace("Z", "+00:00"))
        if last_update.tzinfo is None:
            last_update = last_update.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        elapsed = (now - last_update).total_seconds()
        return elapsed > timeout_seconds
    except (ValueError, TypeError):
        return True


def remove_last_user_message(
    conversation_id: str, user_id: str | None = None
) -> bool:
    """Remove the last user message from a conversation (for retry cleanup).

    Args:
        conversation_id: Conversation identifier
        user_id: Optional username for user-scoped storage

    Returns:
        True if message was removed, False otherwise
    """
    conversation = get_conversation(conversation_id, user_id)
    if conversation and conversation["messages"]:
        if conversation["messages"][-1].get("role") == "user":
            conversation["messages"] = conversation["messages"][:-1]
            save_conversation(conversation, user_id)
            return True
    return False
