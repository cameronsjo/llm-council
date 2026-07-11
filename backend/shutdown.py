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

import asyncio
import json
import logging
from collections.abc import Callable
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


async def drain_streams(
    coordinator: ShutdownCoordinator,
    timeout: float,
    poll: float = 0.5,
    *,
    clock: Callable[[], float] | None = None,
) -> None:
    """Wait for active SSE streams to finish, up to a deadline.

    Polls ``coordinator.active_stream_count`` until it reaches zero or the
    timeout elapses, letting in-flight streams emit their ``server_shutdown``
    event and complete their current LLM call before the shared client is
    closed.

    Args:
        coordinator: The shutdown coordinator tracking active streams.
        timeout: Maximum seconds to wait before forcing shutdown. MUST stay
            strictly under uvicorn's ``timeout_graceful_shutdown`` — an equal
            budget risks the post-drain ``close_shared_client()`` being
            cancelled, leaking the connection pool.
        poll: Seconds between stream-count checks.
        clock: Monotonic time source, injectable for tests. Resolved inside
            the coroutine because ``asyncio.get_running_loop()`` requires a
            running loop, which does not exist at import time.
    """
    # Resolve the clock inside the running coroutine — a def-time default
    # would evaluate at import, where there is no running loop.
    clock = clock or asyncio.get_running_loop().time

    # Capture the deadline origin BEFORE the loop so a clock that advances
    # on every call cannot push the deadline forward each iteration.
    deadline = clock() + timeout

    while coordinator.active_stream_count > 0:
        if clock() > deadline:
            logger.warning(
                "Forcing shutdown with %d stream(s) still active",
                coordinator.active_stream_count,
            )
            break
        await asyncio.sleep(poll)


# Module-level singleton
shutdown_coordinator = ShutdownCoordinator()
