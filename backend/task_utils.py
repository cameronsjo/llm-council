"""Cleanup for background tasks owned by a request or generator."""

import asyncio
from contextlib import suppress


async def cancel_and_await_task(task: asyncio.Task | None) -> None:
    """Stop unfinished work and retrieve its result without masking owner errors."""
    if task is None:
        return
    if not task.done():
        task.cancel()
    with suppress(asyncio.CancelledError, Exception):
        await task
