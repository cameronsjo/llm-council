"""Graceful shutdown coordinator for active SSE streams.

On SIGTERM (container stop), active streams receive a ``server_shutdown``
event so the frontend can show a "reconnecting" message instead of a
raw network error.

Usage in SSE generators::

    from .shutdown import shutdown_coordinator

    async def event_generator():
        async for event in some_pipeline():
            if shutdown_coordinator.is_shutting_down:
                yield shutdown_coordinator.shutdown_sse_event()
                return
            yield f"data: {json.dumps(event)}\\n\\n"
"""

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


class ShutdownCoordinator:
    """Tracks shutdown state for graceful SSE stream termination."""

    def __init__(self) -> None:
        self._shutting_down: bool = False
        self._active_streams: int = 0

    @property
    def is_shutting_down(self) -> bool:
        return self._shutting_down

    @property
    def active_stream_count(self) -> int:
        return self._active_streams

    def initiate_shutdown(self) -> None:
        """Signal all active streams that the server is going down."""
        logger.info(
            "Shutdown initiated. Active streams: %d", self._active_streams
        )
        self._shutting_down = True

    def register_stream(self) -> None:
        """Track a new active SSE stream."""
        self._active_streams += 1

    def unregister_stream(self) -> None:
        """Remove a completed SSE stream from tracking."""
        self._active_streams = max(0, self._active_streams - 1)

    def shutdown_sse_event(self) -> str:
        """Format a server_shutdown SSE event."""
        event: dict[str, Any] = {
            "type": "server_shutdown",
            "message": "Server is restarting — your request will resume automatically",
        }
        return f"data: {json.dumps(event)}\n\n"


# Module-level singleton
shutdown_coordinator = ShutdownCoordinator()
