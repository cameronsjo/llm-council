"""Lifecycle tests for first-message title tasks."""

import asyncio
import gc
import json
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend import main
from backend import storage as storage_module
from backend.arena import ArenaRound
from backend.council_stream import CouncilPipelineInput, run_council_pipeline
from backend.main import ArenaConfig, SendMessageRequest

STAGE1_RESULT = {"model": "model-a", "response": "answer", "metrics": {}}
STAGE2_RESULT = {
    "model": "model-a",
    "ranking": "ranking",
    "parsed_ranking": ["Response A"],
    "metrics": {},
}
STAGE3_RESULT = {"model": "chairman", "response": "synthesis", "metrics": {}}


def make_pipeline_input(**overrides: Any) -> CouncilPipelineInput:
    defaults = {
        "conversation_id": "title-test-conversation",
        "user_id": None,
        "content": "A question that needs a title",
        "council_models": ["model-a"],
        "chairman_model": "chairman",
        "is_first_message": True,
    }
    defaults.update(overrides)
    return CouncilPipelineInput(**defaults)


def make_storage() -> MagicMock:
    storage = MagicMock()
    storage.get_conversation.return_value = {"messages": []}
    storage.get_conversation_config.return_value = (["model-a"], "chairman")
    storage.get_pending_message.return_value = None
    return storage


async def successful_stage1(
    _content: Any, _context: Any, _models: Any, **kwargs: Any
) -> list[dict[str, Any]]:
    await kwargs["on_model_response"]("model-a", STAGE1_RESULT)
    return [STAGE1_RESULT]


async def successful_stage2(*_args: Any) -> tuple[list[dict[str, Any]], dict[str, str], list[Any]]:
    return [STAGE2_RESULT], {"Response A": "model-a"}, []


async def successful_stage3(*_args: Any) -> dict[str, Any]:
    return STAGE3_RESULT


async def drain_pipeline(pipeline: Any) -> list[dict]:
    return [event async for event in pipeline]


def parse_sse(chunks: Any) -> list[dict]:
    events = []
    for chunk in chunks:
        payload = chunk.removeprefix("data: ").strip()
        if payload:
            events.append(json.loads(payload))
    return events


@contextmanager
def patched_storage(storage: Any) -> Iterator[None]:
    """Patch the shared module so endpoint and pipeline use the same mock."""
    names = (
        "get_conversation",
        "get_conversation_config",
        "get_pending_message",
        "add_user_message",
        "mark_response_pending",
        "update_pending_progress",
        "update_conversation_title",
        "add_unified_message",
        "clear_pending",
    )
    with patch.multiple(
        storage_module,
        **{name: getattr(storage, name) for name in names},
    ):
        yield


@contextmanager
def quiet_shutdown_coordinator() -> Iterator[None]:
    coordinator = MagicMock()
    coordinator.is_shutting_down = False
    with patch.object(main, "shutdown_coordinator", coordinator):
        yield


def pipeline_patches(*, title: Any = None, stage2: Any = None, stage3: Any = None) -> Any:
    return patch.multiple(
        "backend.council_stream",
        stage1_collect_responses=AsyncMock(side_effect=successful_stage1),
        stage2_collect_rankings=AsyncMock(side_effect=stage2 or successful_stage2),
        stage3_synthesize_final=AsyncMock(side_effect=stage3 or successful_stage3),
        generate_conversation_title=title or AsyncMock(return_value="Generated title"),
        calculate_aggregate_rankings=MagicMock(return_value=[]),
        aggregate_metrics=MagicMock(return_value={}),
        convert_to_unified_result=MagicMock(return_value={"result": "ok"}),
        record_stage2_matches=MagicMock(return_value=0),
    )


@pytest.mark.asyncio
async def test_council_exception_after_title_start_cancels_title_task() -> None:
    """A downstream council error cancels and drains the parallel title task."""
    title_started = asyncio.Event()
    title_cancelled = asyncio.Event()
    title_finished = asyncio.Event()

    async def blocked_title(_content: Any) -> str:
        title_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            title_cancelled.set()
            raise
        finally:
            title_finished.set()

    async def failing_stage2(*_args: Any) -> None:
        await title_started.wait()
        raise RuntimeError("ranking failed")

    storage = make_storage()
    with pipeline_patches(title=blocked_title, stage2=failing_stage2):
        events = await drain_pipeline(run_council_pipeline(make_pipeline_input(), storage=storage))

    assert events[-1] == {"type": "error", "message": "ranking failed"}
    assert title_cancelled.is_set()
    assert title_finished.is_set()


@pytest.mark.asyncio
async def test_council_close_while_title_pending_cancels_title_task() -> None:
    """Closing a suspended council generator drains its outstanding title task."""
    title_started = asyncio.Event()
    title_cancelled = asyncio.Event()
    title_finished = asyncio.Event()

    async def blocked_title(_content: Any) -> str:
        title_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            title_cancelled.set()
            raise
        finally:
            title_finished.set()

    async def successful_stage2(
        *_args: Any,
    ) -> tuple[list[dict[str, Any]], dict[str, str], list[Any]]:
        await title_started.wait()
        return [STAGE2_RESULT], {"Response A": "model-a"}, []

    storage = make_storage()
    pipeline = run_council_pipeline(make_pipeline_input(), storage=storage)
    with pipeline_patches(title=blocked_title, stage2=successful_stage2):
        try:
            while True:
                event = await pipeline.__anext__()
                if (
                    event.get("type") == "round_complete"
                    and event.get("data", {}).get("round_type") == "rankings"
                ):
                    break
            await title_started.wait()
        finally:
            await pipeline.aclose()

    assert title_cancelled.is_set()
    assert title_finished.is_set()


@pytest.mark.asyncio
async def test_council_title_complete_is_preserved_on_success() -> None:
    """A successful council run still emits title_complete before complete."""
    storage = make_storage()
    with pipeline_patches(title=AsyncMock(return_value="Council title")):
        events = await drain_pipeline(run_council_pipeline(make_pipeline_input(), storage=storage))

    assert {"type": "title_complete", "data": {"title": "Council title"}} in events
    assert events[-1] == {"type": "complete"}
    storage.update_conversation_title.assert_called_once_with(
        "title-test-conversation", "Council title", user_id=None
    )


@pytest.mark.asyncio
async def test_council_completed_title_exception_does_not_mask_pipeline_error() -> None:
    """A completed title failure must not replace the original pipeline error."""
    title_started = asyncio.Event()

    async def failed_title(_content: Any) -> None:
        title_started.set()
        raise ValueError("title failed")

    async def failing_stage2(*_args: Any) -> None:
        await title_started.wait()
        await asyncio.sleep(0)
        raise RuntimeError("ranking failed")

    storage = make_storage()
    with pipeline_patches(title=failed_title, stage2=failing_stage2):
        events = await drain_pipeline(run_council_pipeline(make_pipeline_input(), storage=storage))
    assert events[-1] == {"type": "error", "message": "ranking failed"}


@pytest.mark.asyncio
async def test_completed_failed_task_is_drained() -> None:
    """Cleanup observes an already-failed task so it cannot emit an unhandled error."""
    from backend.task_utils import cancel_and_await_task

    loop = asyncio.get_running_loop()
    loop_exceptions = []
    previous_handler = loop.get_exception_handler()
    loop.set_exception_handler(lambda _loop, context: loop_exceptions.append(context))
    try:

        async def fail() -> None:
            raise ValueError("unobserved title failure")

        task = asyncio.create_task(fail())
        await asyncio.sleep(0)
        assert task.done()
        await cancel_and_await_task(task)
        del task
        gc.collect()
        await asyncio.sleep(0)
        assert not any(
            context.get("message") == "Task exception was never retrieved"
            for context in loop_exceptions
        )
    finally:
        loop.set_exception_handler(previous_handler)


@pytest.mark.asyncio
async def test_council_consumer_cancellation_drains_title_task() -> None:
    """Cancelling council consumption propagates and drains the title task."""
    title_started = asyncio.Event()
    title_cancelled = asyncio.Event()
    title_finished = asyncio.Event()
    stage2_started = asyncio.Event()
    stage2_blocked = asyncio.Event()

    async def blocked_title(_content: Any) -> str:
        title_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            title_cancelled.set()
            raise
        finally:
            title_finished.set()

    async def blocked_stage2(*_args: Any) -> None:
        await title_started.wait()
        stage2_started.set()
        await stage2_blocked.wait()

    storage = make_storage()
    consumer = None
    with pipeline_patches(title=blocked_title, stage2=blocked_stage2):
        consumer = asyncio.create_task(
            drain_pipeline(run_council_pipeline(make_pipeline_input(), storage=storage))
        )
        try:
            await asyncio.wait_for(stage2_started.wait(), timeout=1)
            consumer.cancel()
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(consumer, timeout=1)
        finally:
            if consumer is not None and not consumer.done():
                consumer.cancel()
            if consumer is not None:
                with suppress(asyncio.CancelledError):
                    await consumer

    assert title_cancelled.is_set()
    assert title_finished.is_set()


@pytest.mark.asyncio
async def test_council_endpoint_close_closes_nested_pipeline() -> None:
    """Closing the council endpoint iterator closes its nested pipeline."""
    title_started = asyncio.Event()
    title_cancelled = asyncio.Event()
    title_finished = asyncio.Event()

    async def blocked_title(_content: Any) -> str:
        title_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            title_cancelled.set()
            raise
        finally:
            title_finished.set()

    storage = make_storage()
    request = SendMessageRequest(content="Question", mode="council")
    with (
        patched_storage(storage),
        quiet_shutdown_coordinator(),
        pipeline_patches(title=blocked_title),
    ):
        response = await main.send_message_stream("title-test-conversation", request, user=None)
        body = response.body_iterator
        try:
            while True:
                event = json.loads((await body.__anext__()).removeprefix("data: ").strip())
                if (
                    event.get("type") == "round_complete"
                    and event.get("data", {}).get("round_type") == "rankings"
                ):
                    break
            await title_started.wait()
        finally:
            await body.aclose()

    assert title_cancelled.is_set()
    assert title_finished.is_set()


@pytest.mark.asyncio
async def test_arena_exception_after_title_start_cancels_title_task() -> None:
    """A downstream arena error cancels and drains the parallel title task."""
    title_started = asyncio.Event()
    title_cancelled = asyncio.Event()
    title_finished = asyncio.Event()

    async def blocked_title(_content: Any) -> str:
        title_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            title_cancelled.set()
            raise
        finally:
            title_finished.set()

    async def failing_round(*_args: Any) -> None:
        await title_started.wait()
        raise RuntimeError("arena round failed")

    storage = make_storage()
    request = SendMessageRequest(
        content="Question", mode="arena", arena_config=ArenaConfig(round_count=2)
    )
    with (
        patched_storage(storage),
        quiet_shutdown_coordinator(),
        patch("backend.main.generate_conversation_title", new=blocked_title),
        patch("backend.main.round1_initial_positions", new=failing_round),
    ):
        response = await main.send_message_stream("title-test-conversation", request, user=None)
        events = parse_sse([chunk async for chunk in response.body_iterator])

    assert events[-1] == {"type": "error", "message": "arena round failed"}
    assert title_cancelled.is_set()
    assert title_finished.is_set()


@pytest.mark.asyncio
async def test_arena_endpoint_close_while_title_pending_cancels_title_task() -> None:
    """Closing the arena endpoint iterator drains its outstanding title task."""
    title_started = asyncio.Event()
    title_cancelled = asyncio.Event()
    title_finished = asyncio.Event()

    async def blocked_title(_content: Any) -> str:
        title_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            title_cancelled.set()
            raise
        finally:
            title_finished.set()

    storage = make_storage()
    request = SendMessageRequest(
        content="Question", mode="arena", arena_config=ArenaConfig(round_count=2)
    )
    with (
        patched_storage(storage),
        quiet_shutdown_coordinator(),
        patch("backend.main.generate_conversation_title", new=blocked_title),
    ):
        response = await main.send_message_stream("title-test-conversation", request, user=None)
        body = response.body_iterator
        try:
            first_event = json.loads((await body.__anext__()).removeprefix("data: ").strip())
            assert first_event["type"] == "arena_start"
            await title_started.wait()
        finally:
            await body.aclose()

    assert title_cancelled.is_set()
    assert title_finished.is_set()


@pytest.mark.asyncio
async def test_arena_consumer_cancellation_drains_title_task() -> None:
    """Cancelling arena consumption propagates and drains the title task."""
    title_started = asyncio.Event()
    title_cancelled = asyncio.Event()
    title_finished = asyncio.Event()
    round_started = asyncio.Event()
    round_blocked = asyncio.Event()

    async def blocked_title(_content: Any) -> str:
        title_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            title_cancelled.set()
            raise
        finally:
            title_finished.set()

    async def blocked_round(*_args: Any) -> None:
        await title_started.wait()
        round_started.set()
        await round_blocked.wait()

    storage = make_storage()
    request = SendMessageRequest(
        content="Question", mode="arena", arena_config=ArenaConfig(round_count=2)
    )
    consumer = None
    with (
        patched_storage(storage),
        quiet_shutdown_coordinator(),
        patch("backend.main.generate_conversation_title", new=blocked_title),
        patch("backend.main.round1_initial_positions", new=blocked_round),
    ):
        response = await main.send_message_stream("title-test-conversation", request, user=None)
        consumer = asyncio.create_task(drain_pipeline(response.body_iterator))
        try:
            await asyncio.wait_for(round_started.wait(), timeout=1)
            consumer.cancel()
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(consumer, timeout=1)
        finally:
            if consumer is not None and not consumer.done():
                consumer.cancel()
            if consumer is not None:
                with suppress(asyncio.CancelledError):
                    await consumer

    assert title_cancelled.is_set()
    assert title_finished.is_set()


@pytest.mark.asyncio
async def test_arena_title_complete_is_preserved_on_success() -> None:
    """A successful arena run still emits title_complete before complete."""
    storage = make_storage()
    round1 = ArenaRound(
        round_number=1,
        round_type="initial",
        responses=[{"participant": "A", "model": "model-a", "response": "answer", "metrics": {}}],
    )
    round2 = ArenaRound(
        round_number=2,
        round_type="deliberation",
        responses=[{"participant": "A", "model": "model-a", "response": "rebuttal", "metrics": {}}],
    )
    request = SendMessageRequest(
        content="Question", mode="arena", arena_config=ArenaConfig(round_count=2)
    )
    with (
        patched_storage(storage),
        quiet_shutdown_coordinator(),
        patch(
            "backend.main.generate_conversation_title", new=AsyncMock(return_value="Arena title")
        ),
        patch("backend.main.round1_initial_positions", new=AsyncMock(return_value=round1)),
        patch("backend.main.round_n_deliberation", new=AsyncMock(return_value=round2)),
        patch(
            "backend.main.final_synthesis", new=AsyncMock(return_value={"response": "synthesis"})
        ),
        patch("backend.main.aggregate_arena_metrics", return_value={}),
        patch("backend.main.convert_arena_to_unified_result", return_value={"result": "ok"}),
    ):
        response = await main.send_message_stream("title-test-conversation", request, user=None)
        events = parse_sse([chunk async for chunk in response.body_iterator])

    assert {"type": "title_complete", "data": {"title": "Arena title"}} in events
    assert events[-1] == {"type": "complete"}
    storage.update_conversation_title.assert_called_once_with(
        "title-test-conversation", "Arena title", user_id=None
    )
