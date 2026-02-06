"""Council streaming pipeline - extracted from main.py for testability."""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from types import ModuleType
from typing import Any, AsyncGenerator

from .attachments import process_attachments
from .council import (
    aggregate_metrics,
    calculate_aggregate_rankings,
    convert_to_unified_result,
    generate_conversation_title,
    perform_web_search,
    stage1_collect_responses,
    stage2_collect_rankings,
    stage3_synthesize_final,
)

logger = logging.getLogger(__name__)


def _extract_stage_data(
    msg: dict[str, Any],
) -> tuple[list[dict[str, Any]] | None, list[dict[str, Any]] | None]:
    """Extract stage1 and stage2 data from either unified or legacy message format.

    Unified format stores data in ``rounds`` (list of round dicts with
    ``responses``).  Legacy format uses flat ``stage1``/``stage2`` keys.
    Both are converted to the legacy list-of-dicts format expected by
    ``stage3_synthesize_final`` and ``aggregate_metrics``.

    Returns:
        (stage1_results, stage2_results) in legacy format, or (None, None).
    """
    # Try unified format first (rounds[0]=responses, rounds[1]=rankings)
    rounds = msg.get("rounds")
    if rounds and len(rounds) >= 2:
        stage1_results = [
            {
                "model": r.get("model", ""),
                "response": r.get("content", ""),
                **({"metrics": r["metrics"]} if r.get("metrics") else {}),
                **({"reasoning_details": r["reasoning_details"]} if r.get("reasoning_details") else {}),
            }
            for r in rounds[0].get("responses", [])
        ]
        stage2_results = [
            {
                "model": r.get("model", ""),
                "ranking": r.get("content", ""),
                **({"metrics": r["metrics"]} if r.get("metrics") else {}),
                **({"parsed_ranking": r["parsed_ranking"]} if r.get("parsed_ranking") else {}),
                **({"reasoning_details": r["reasoning_details"]} if r.get("reasoning_details") else {}),
            }
            for r in rounds[1].get("responses", [])
        ]
        return stage1_results or None, stage2_results or None

    # Fall back to legacy format
    return msg.get("stage1"), msg.get("stage2")


@dataclass(frozen=True)
class CouncilPipelineInput:
    """All inputs needed by the council streaming pipeline."""

    conversation_id: str
    user_id: str | None
    content: str
    council_models: list[str]
    chairman_model: str
    is_first_message: bool
    use_web_search: bool = False
    resume: bool = False
    attachments: list[dict[str, Any]] = field(default_factory=list)
    prior_context_text: str = ""
    prior_context_source_id: str | None = None


async def _stream_stage1(
    content: str,
    combined_context: str | None,
    council_models: list[str],
    stage1_results: list[dict],
) -> AsyncGenerator[dict, None]:
    """Run Stage 1 with queue-based callback-to-generator bridge.

    Populates stage1_results in place as models complete.
    Yields stage1_model_response, stage1_progress, and stage1_token events.
    """
    event_queue: asyncio.Queue = asyncio.Queue()

    async def on_model_response(model: str, result: dict | None) -> None:
        if result:
            stage1_results.append(result)
            await event_queue.put({
                "type": "stage1_model_response",
                "data": result,
                "index": len(stage1_results),
                "total": len(council_models),
            })

    async def on_progress(
        completed: int, total: int,
        completed_models: list, pending_models: list,
    ) -> None:
        await event_queue.put({
            "type": "stage1_progress",
            "data": {
                "completed": completed,
                "total": total,
                "completed_models": completed_models,
                "pending_models": pending_models,
            },
        })

    async def on_token(model: str, token: str) -> None:
        await event_queue.put({
            "type": "stage1_token",
            "data": {"model": model, "token": token},
        })

    async def run() -> None:
        try:
            await stage1_collect_responses(
                content,
                combined_context,
                council_models,
                on_model_response=on_model_response,
                on_progress=on_progress,
                stream_tokens=True,
                on_token=on_token,
            )
        finally:
            await event_queue.put(None)

    task = asyncio.create_task(run())

    while True:
        event = await event_queue.get()
        if event is None:
            break
        yield event

    await task


async def run_council_pipeline(
    input: CouncilPipelineInput,
    *,
    storage: ModuleType | None = None,
) -> AsyncGenerator[dict, None]:
    """Run the 3-stage council pipeline, yielding SSE event dicts.

    Each yielded dict has a 'type' key and optional 'data', 'metadata',
    'message', etc. keys matching the existing SSE event contract.

    Args:
        input: All pipeline parameters.
        storage: Storage module (defaults to backend.storage). Injectable for testing.
    """
    if storage is None:
        from . import storage as _storage
        storage = _storage

    pipeline_start = time.monotonic()
    logger.info(
        "Beginning council pipeline. ConversationId: %s, Models: %d, Chairman: %s, WebSearch: %s, Resume: %s",
        input.conversation_id, len(input.council_models), input.chairman_model,
        input.use_web_search, input.resume,
    )

    try:
        # --- Resume check ---
        pending_data = storage.get_pending_message(
            input.conversation_id, user_id=input.user_id
        )
        can_resume = (
            input.resume
            and pending_data
            and pending_data.get("partial_data", {}).get("stage1")
        )

        if can_resume:
            logger.info(
                "Resuming council pipeline from Stage 2. ConversationId: %s, CachedStage1Responses: %d",
                input.conversation_id, len(pending_data["partial_data"]["stage1"]),
            )
            yield {"type": "resume_start", "data": {"from_stage": 2}}
            stage1_results = pending_data["partial_data"]["stage1"]
            yield {"type": "stage1_complete", "data": stage1_results, "resumed": True}
            web_search_context = None
            web_search_error = None
        else:
            # --- Normal flow ---
            storage.add_user_message(
                input.conversation_id, input.content, user_id=input.user_id
            )
            storage.mark_response_pending(
                input.conversation_id, "council", input.content,
                user_id=input.user_id,
            )

            if input.prior_context_source_id:
                yield {
                    "type": "prior_context",
                    "data": {"source_id": input.prior_context_source_id},
                }

            # Process attachments
            attachment_context = ""
            if input.attachments:
                text_context, _ = process_attachments(
                    input.attachments, input.user_id
                )
                if text_context:
                    attachment_context = (
                        f"## Attached Documents\n\n{text_context}\n\n---\n\n"
                    )

            # Web search
            web_search_context = None
            web_search_error = None
            if input.use_web_search:
                yield {"type": "web_search_start"}
                web_search_context, web_search_error = await perform_web_search(
                    input.content
                )
                yield {
                    "type": "web_search_complete",
                    "data": {
                        "found": web_search_context is not None,
                        "error": web_search_error,
                    },
                }

            # --- Stage 1: Progressive streaming ---
            yield {"type": "stage1_start", "data": {"models": input.council_models}}

            combined_context = input.prior_context_text + attachment_context
            if web_search_context:
                combined_context += web_search_context

            stage1_start = time.monotonic()
            stage1_results: list[dict] = []
            async for event in _stream_stage1(
                input.content,
                combined_context or None,
                input.council_models,
                stage1_results,
            ):
                yield event

            stage1_duration = time.monotonic() - stage1_start
            logger.info(
                "Stage 1 complete. ConversationId: %s, Responses: %d/%d, Duration: %.2fs",
                input.conversation_id, len(stage1_results), len(input.council_models), stage1_duration,
            )
            yield {"type": "stage1_complete", "data": stage1_results}

            storage.update_pending_progress(
                input.conversation_id,
                {"stage1": stage1_results},
                user_id=input.user_id,
            )

        # --- Title generation (parallel, non-blocking) ---
        title_task = None
        if input.is_first_message and not can_resume:
            title_task = asyncio.create_task(
                generate_conversation_title(input.content)
            )

        # --- Stage 2: Collect rankings ---
        yield {"type": "stage2_start"}
        stage2_start = time.monotonic()
        stage2_results, label_to_model = await stage2_collect_rankings(
            input.content, stage1_results, input.council_models
        )
        aggregate_rankings = calculate_aggregate_rankings(
            stage2_results, label_to_model
        )
        stage2_duration = time.monotonic() - stage2_start
        logger.info(
            "Stage 2 complete. ConversationId: %s, Rankings: %d/%d, Duration: %.2fs",
            input.conversation_id, len(stage2_results), len(input.council_models), stage2_duration,
        )
        metadata = {
            "label_to_model": label_to_model,
            "aggregate_rankings": aggregate_rankings,
            "web_search_used": web_search_context is not None,
            "web_search_error": web_search_error,
        }
        yield {
            "type": "stage2_complete",
            "data": stage2_results,
            "metadata": metadata,
        }

        storage.update_pending_progress(
            input.conversation_id,
            {
                "stage1": stage1_results,
                "stage2": stage2_results,
                "metadata": metadata,
            },
            user_id=input.user_id,
        )

        # --- Stage 3: Chairman synthesis ---
        yield {"type": "stage3_start"}
        stage3_start = time.monotonic()
        stage3_result = await stage3_synthesize_final(
            input.content, stage1_results, stage2_results, input.chairman_model
        )
        stage3_duration = time.monotonic() - stage3_start
        logger.info(
            "Stage 3 complete. ConversationId: %s, Chairman: %s, Duration: %.2fs",
            input.conversation_id, input.chairman_model, stage3_duration,
        )
        yield {"type": "stage3_complete", "data": stage3_result}

        # --- Metrics ---
        metrics = aggregate_metrics(stage1_results, stage2_results, stage3_result)
        yield {"type": "metrics_complete", "data": metrics}

        # --- Title ---
        if title_task:
            title = await title_task
            storage.update_conversation_title(
                input.conversation_id, title, user_id=input.user_id
            )
            yield {"type": "title_complete", "data": {"title": title}}

        # --- Save and complete ---
        unified_result = convert_to_unified_result(
            stage1_results, stage2_results, stage3_result,
            label_to_model, aggregate_rankings, metrics,
        )
        storage.add_unified_message(
            input.conversation_id, unified_result, user_id=input.user_id,
        )
        storage.clear_pending(input.conversation_id, user_id=input.user_id)

        pipeline_duration = time.monotonic() - pipeline_start
        logger.info(
            "Successfully completed council pipeline. ConversationId: %s, Duration: %.2fs",
            input.conversation_id, pipeline_duration,
        )
        yield {"type": "complete"}

    except Exception as e:
        pipeline_duration = time.monotonic() - pipeline_start
        logger.exception(
            "Failed council pipeline. ConversationId: %s, Duration: %.2fs, Error: %s",
            input.conversation_id, pipeline_duration, e,
        )
        storage.update_pending_progress(
            input.conversation_id, {"error": str(e)}, user_id=input.user_id
        )
        yield {"type": "error", "message": str(e)}


async def retry_stage3_pipeline(
    conversation_id: str,
    chairman_model: str,
    user_id: str | None = None,
    *,
    storage: ModuleType | None = None,
) -> AsyncGenerator[dict, None]:
    """Re-run Stage 3 synthesis using existing Stage 1+2 data from the conversation.

    Reads the last council assistant message, extracts stage1/stage2 results,
    re-runs the chairman call, and updates the message in place.

    Args:
        conversation_id: Conversation with a failed Stage 3 to retry.
        chairman_model: Model to use for synthesis.
        user_id: Optional username for user-scoped storage.
        storage: Storage module (injectable for testing).
    """
    if storage is None:
        from . import storage as _storage
        storage = _storage

    retry_start = time.monotonic()
    logger.info(
        "Beginning Stage 3 retry. ConversationId: %s, Chairman: %s",
        conversation_id, chairman_model,
    )

    try:
        conversation = storage.get_conversation(conversation_id, user_id)
        if conversation is None:
            logger.warning(
                "Stage 3 retry aborted, conversation not found. ConversationId: %s",
                conversation_id,
            )
            yield {"type": "error", "message": "Conversation not found"}
            return

        # Find the last council assistant message
        last_council_msg = None
        user_query = None
        for msg in reversed(conversation["messages"]):
            if msg.get("role") == "assistant" and msg.get("mode") == "council":
                last_council_msg = msg
            elif msg.get("role") == "user" and last_council_msg is not None:
                user_query = msg.get("content", "")
                break

        if last_council_msg is None:
            logger.warning(
                "Stage 3 retry aborted, no council message found. ConversationId: %s",
                conversation_id,
            )
            yield {"type": "error", "message": "No council message found to retry"}
            return

        # Extract stage data from either unified or legacy format
        stage1_results, stage2_results = _extract_stage_data(last_council_msg)

        if not stage1_results or not stage2_results:
            logger.warning(
                "Stage 3 retry aborted, missing stage data. ConversationId: %s, HasStage1: %s, HasStage2: %s, HasRounds: %s",
                conversation_id, bool(stage1_results), bool(stage2_results),
                bool(last_council_msg.get("rounds")),
            )
            yield {"type": "error", "message": "Stage 1 or Stage 2 data missing"}
            return

        if not user_query:
            yield {"type": "error", "message": "Could not find original user query"}
            return

        # Re-run Stage 3 only
        yield {"type": "stage3_start"}
        stage3_result = await stage3_synthesize_final(
            user_query, stage1_results, stage2_results, chairman_model
        )

        # Check if it failed again
        if stage3_result.get("response", "").startswith("Error:"):
            logger.warning(
                "Stage 3 retry chairman failed again. ConversationId: %s, Chairman: %s",
                conversation_id, chairman_model,
            )
            yield {"type": "stage3_complete", "data": stage3_result}
            yield {"type": "error", "message": "Chairman model failed again"}
            return

        yield {"type": "stage3_complete", "data": stage3_result}

        # Update metrics with new stage3
        metrics = aggregate_metrics(stage1_results, stage2_results, stage3_result)
        yield {"type": "metrics_complete", "data": metrics}

        # Persist: update the last assistant message in place
        storage.update_last_council_stage3(
            conversation_id, stage3_result, metrics, user_id=user_id
        )

        retry_duration = time.monotonic() - retry_start
        logger.info(
            "Successfully completed Stage 3 retry. ConversationId: %s, Chairman: %s, Duration: %.2fs",
            conversation_id, chairman_model, retry_duration,
        )
        yield {"type": "complete"}

    except Exception as e:
        retry_duration = time.monotonic() - retry_start
        logger.exception(
            "Failed Stage 3 retry. ConversationId: %s, Duration: %.2fs, Error: %s",
            conversation_id, retry_duration, e,
        )
        yield {"type": "error", "message": str(e)}
