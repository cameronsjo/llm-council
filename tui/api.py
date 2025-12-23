"""API client for the LLM Council TUI."""

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class Conversation:
    """Represents a conversation."""

    id: str
    title: str
    created_at: str
    message_count: int


@dataclass
class Stage1Response:
    """Individual model response from Stage 1."""

    model: str
    response: str
    reasoning_details: str | None = None


@dataclass
class Stage3Response:
    """Final synthesis from Stage 3."""

    model: str
    response: str
    reasoning_details: str | None = None


class CouncilAPI:
    """Client for the LLM Council API."""

    def __init__(self, base_url: str = "http://localhost:8001"):
        self.base_url = base_url
        self.client = httpx.AsyncClient(base_url=base_url, timeout=120.0)

    async def close(self) -> None:
        """Close the HTTP client."""
        await self.client.aclose()

    async def get_config(self) -> dict[str, Any]:
        """Get API configuration."""
        response = await self.client.get("/api/config")
        response.raise_for_status()
        return response.json()

    async def list_conversations(self) -> list[Conversation]:
        """List all conversations."""
        response = await self.client.get("/api/conversations")
        response.raise_for_status()
        return [
            Conversation(
                id=c["id"],
                title=c.get("title", "New Conversation"),
                created_at=c["created_at"],
                message_count=c.get("message_count", 0),
            )
            for c in response.json()
        ]

    async def create_conversation(self) -> Conversation:
        """Create a new conversation."""
        response = await self.client.post("/api/conversations", json={})
        response.raise_for_status()
        data = response.json()
        return Conversation(
            id=data["id"],
            title=data.get("title", "New Conversation"),
            created_at=data["created_at"],
            message_count=0,
        )

    async def get_conversation(self, conversation_id: str) -> dict[str, Any]:
        """Get a conversation with messages."""
        response = await self.client.get(f"/api/conversations/{conversation_id}")
        response.raise_for_status()
        return response.json()

    async def delete_conversation(self, conversation_id: str) -> None:
        """Delete a conversation."""
        response = await self.client.delete(f"/api/conversations/{conversation_id}")
        response.raise_for_status()

    async def send_message_stream(
        self,
        conversation_id: str,
        content: str,
        mode: str = "council",
        use_web_search: bool = False,
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        """Send a message and stream the response.

        Yields tuples of (event_type, event_data).
        """
        body = {
            "content": content,
            "mode": mode,
            "use_web_search": use_web_search,
        }

        async with self.client.stream(
            "POST",
            f"/api/conversations/{conversation_id}/message/stream",
            json=body,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    try:
                        event = json.loads(data)
                        yield event.get("type", "unknown"), event
                    except json.JSONDecodeError:
                        continue
