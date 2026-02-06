"""Council streaming pipeline - extracted from main.py for testability."""

import asyncio
import json
import logging
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
    stage1_collect_responses_streaming,
    stage2_collect_rankings,
    stage3_synthesize_final,
)

logger = logging.getLogger(__name__)


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
    raise NotImplementedError
    yield  # make it a generator


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
    raise NotImplementedError
    yield  # make it a generator
