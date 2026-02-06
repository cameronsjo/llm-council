"""Tests for Stage 3 retry: storage update and pipeline re-run."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.council_stream import _extract_stage_data, retry_stage3_pipeline
from backend.storage import update_last_council_stage3


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

STAGE1_RESULTS = [
    {"model": "model-a", "response": "Answer A", "metrics": {"total_tokens": 50}},
    {"model": "model-b", "response": "Answer B", "metrics": {"total_tokens": 60}},
]

STAGE2_RESULTS = [
    {
        "model": "model-a",
        "ranking": "FINAL RANKING:\n1. Response A\n2. Response B",
        "parsed_ranking": ["Response A", "Response B"],
        "metrics": {"total_tokens": 40},
    },
]

STAGE3_RESULT = {
    "model": "model-chairman",
    "response": "Synthesized answer",
    "metrics": {"total_tokens": 100},
}

STAGE3_ERROR_RESULT = {
    "model": "model-chairman",
    "response": "Error: Chairman model returned no response after retries",
    "metrics": {},
}


def _make_conversation(
    *,
    has_council_msg: bool = True,
    has_user_msg: bool = True,
    has_stage1: bool = True,
    has_stage2: bool = True,
) -> dict:
    """Build a conversation dict with configurable completeness."""
    messages = []
    if has_user_msg:
        messages.append({"role": "user", "content": "What is the meaning of life?"})
    if has_council_msg:
        council_msg: dict = {"role": "assistant", "mode": "council"}
        if has_stage1:
            council_msg["stage1"] = STAGE1_RESULTS
        if has_stage2:
            council_msg["stage2"] = STAGE2_RESULTS
        council_msg["stage3"] = STAGE3_ERROR_RESULT
        messages.append(council_msg)
    return {"id": "conv-123", "messages": messages}


def _make_mock_storage(conversation: dict | None = None) -> MagicMock:
    """Create a mock storage module for retry_stage3_pipeline."""
    storage = MagicMock()
    storage.get_conversation.return_value = conversation
    storage.update_last_council_stage3 = MagicMock()
    return storage


async def _collect_events(pipeline) -> list[dict]:
    """Drain an async generator into a list."""
    return [event async for event in pipeline]


def _event_types(events: list[dict]) -> list[str]:
    """Extract the type field from a list of events."""
    return [e["type"] for e in events]


def _find_event(events: list[dict], event_type: str) -> dict | None:
    """Return the first event matching a given type, or None."""
    for e in events:
        if e.get("type") == event_type:
            return e
    return None


# =============================================================================
# update_last_council_stage3 — storage layer
# =============================================================================


class TestUpdateLastCouncilStage3:
    """Tests for storage.update_last_council_stage3."""

    def test_updates_stage3_on_last_council_message(self):
        """Successfully replaces the stage3 field on the most recent council message."""
        conversation = _make_conversation()
        new_stage3 = {"model": "model-chairman", "response": "Better synthesis", "metrics": {}}

        with (
            patch("backend.storage.get_conversation", return_value=conversation),
            patch("backend.storage.save_conversation") as mock_save,
        ):
            update_last_council_stage3("conv-123", new_stage3)

        council_msg = conversation["messages"][-1]
        assert council_msg["stage3"] == new_stage3
        mock_save.assert_called_once_with(conversation, None)

    def test_updates_metrics_when_provided(self):
        """Metrics dict is replaced when passed alongside the stage3 result."""
        conversation = _make_conversation()
        new_stage3 = {"model": "model-chairman", "response": "New synthesis", "metrics": {}}
        new_metrics = {"total_cost": 0.05, "total_tokens": 250}

        with (
            patch("backend.storage.get_conversation", return_value=conversation),
            patch("backend.storage.save_conversation") as mock_save,
        ):
            update_last_council_stage3("conv-123", new_stage3, metrics=new_metrics)

        council_msg = conversation["messages"][-1]
        assert council_msg["stage3"] == new_stage3
        assert council_msg["metrics"] == new_metrics
        mock_save.assert_called_once()

    def test_does_not_touch_metrics_when_none(self):
        """When metrics is not provided, existing metrics are left alone."""
        conversation = _make_conversation()
        conversation["messages"][-1]["metrics"] = {"original": True}
        new_stage3 = {"model": "model-chairman", "response": "New synthesis", "metrics": {}}

        with (
            patch("backend.storage.get_conversation", return_value=conversation),
            patch("backend.storage.save_conversation"),
        ):
            update_last_council_stage3("conv-123", new_stage3)

        council_msg = conversation["messages"][-1]
        assert council_msg["metrics"] == {"original": True}

    def test_raises_when_conversation_not_found(self):
        """Raises ValueError when the conversation does not exist."""
        with patch("backend.storage.get_conversation", return_value=None):
            with pytest.raises(ValueError, match="not found"):
                update_last_council_stage3("nonexistent", {})

    def test_raises_when_no_council_message(self):
        """Raises ValueError when conversation has no council assistant message."""
        conversation = {
            "id": "conv-456",
            "messages": [
                {"role": "user", "content": "Hello"},
                {"role": "assistant", "mode": "arena", "rounds": []},
            ],
        }

        with (
            patch("backend.storage.get_conversation", return_value=conversation),
            patch("backend.storage.save_conversation"),
        ):
            with pytest.raises(ValueError, match="No council message found"):
                update_last_council_stage3("conv-456", {})

    def test_updates_most_recent_council_message(self):
        """When multiple council messages exist, updates the last one only."""
        old_stage3 = {"model": "model-chairman", "response": "Old synthesis", "metrics": {}}
        conversation = {
            "id": "conv-789",
            "messages": [
                {"role": "user", "content": "First question"},
                {"role": "assistant", "mode": "council", "stage3": old_stage3},
                {"role": "user", "content": "Second question"},
                {"role": "assistant", "mode": "council", "stage3": STAGE3_ERROR_RESULT},
            ],
        }
        new_stage3 = {"model": "model-chairman", "response": "Fixed synthesis", "metrics": {}}

        with (
            patch("backend.storage.get_conversation", return_value=conversation),
            patch("backend.storage.save_conversation"),
        ):
            update_last_council_stage3("conv-789", new_stage3)

        # Last council message updated
        assert conversation["messages"][3]["stage3"] == new_stage3
        # First council message untouched
        assert conversation["messages"][1]["stage3"] == old_stage3

    def test_passes_user_id_to_get_and_save(self):
        """user_id is forwarded to both get_conversation and save_conversation."""
        conversation = _make_conversation()
        new_stage3 = {"model": "m", "response": "r", "metrics": {}}

        with (
            patch("backend.storage.get_conversation", return_value=conversation) as mock_get,
            patch("backend.storage.save_conversation") as mock_save,
        ):
            update_last_council_stage3("conv-123", new_stage3, user_id="alice")

        mock_get.assert_called_once_with("conv-123", "alice", migrate_messages=False)
        mock_save.assert_called_once_with(conversation, "alice")


# =============================================================================
# retry_stage3_pipeline — streaming pipeline layer
# =============================================================================


class TestRetryStage3PipelineErrors:
    """Error paths yield error events and stop early."""

    @pytest.mark.asyncio
    async def test_yields_error_when_conversation_not_found(self):
        """Pipeline yields error event when conversation does not exist."""
        storage = _make_mock_storage(conversation=None)

        events = await _collect_events(
            retry_stage3_pipeline("conv-missing", "model-chairman", storage=storage)
        )

        assert len(events) == 1
        assert events[0]["type"] == "error"
        assert "not found" in events[0]["message"].lower()

    @pytest.mark.asyncio
    async def test_yields_error_when_no_council_message(self):
        """Pipeline yields error when no council assistant message exists."""
        conversation = {
            "id": "conv-123",
            "messages": [{"role": "user", "content": "Hello"}],
        }
        storage = _make_mock_storage(conversation=conversation)

        events = await _collect_events(
            retry_stage3_pipeline("conv-123", "model-chairman", storage=storage)
        )

        assert len(events) == 1
        assert events[0]["type"] == "error"
        assert "no council message" in events[0]["message"].lower()

    @pytest.mark.asyncio
    async def test_yields_error_when_stage1_missing(self):
        """Pipeline yields error when stage1 data is absent."""
        conversation = _make_conversation(has_stage1=False, has_stage2=True)
        storage = _make_mock_storage(conversation=conversation)

        events = await _collect_events(
            retry_stage3_pipeline("conv-123", "model-chairman", storage=storage)
        )

        assert len(events) == 1
        assert events[0]["type"] == "error"
        assert "missing" in events[0]["message"].lower()

    @pytest.mark.asyncio
    async def test_yields_error_when_stage2_missing(self):
        """Pipeline yields error when stage2 data is absent."""
        conversation = _make_conversation(has_stage1=True, has_stage2=False)
        storage = _make_mock_storage(conversation=conversation)

        events = await _collect_events(
            retry_stage3_pipeline("conv-123", "model-chairman", storage=storage)
        )

        assert len(events) == 1
        assert events[0]["type"] == "error"
        assert "missing" in events[0]["message"].lower()

    @pytest.mark.asyncio
    async def test_yields_error_when_user_query_not_found(self):
        """Pipeline yields error when user message preceding council message is absent."""
        conversation = _make_conversation(has_user_msg=False)
        storage = _make_mock_storage(conversation=conversation)

        events = await _collect_events(
            retry_stage3_pipeline("conv-123", "model-chairman", storage=storage)
        )

        assert len(events) == 1
        assert events[0]["type"] == "error"
        assert "user query" in events[0]["message"].lower()


class TestRetryStage3PipelineSuccess:
    """Happy path: re-runs stage3 and persists the result."""

    @pytest.mark.asyncio
    async def test_yields_stage3_start_complete_metrics_complete(self):
        """Successful retry emits stage3_start, stage3_complete, metrics_complete, complete."""
        conversation = _make_conversation()
        storage = _make_mock_storage(conversation=conversation)
        new_stage3 = {
            "model": "model-chairman",
            "response": "Better synthesis",
            "metrics": {"total_tokens": 120},
        }

        with (
            patch(
                "backend.council_stream.stage3_synthesize_final",
                new_callable=AsyncMock,
                return_value=new_stage3,
            ),
            patch(
                "backend.council_stream.aggregate_metrics",
                return_value={"total_cost": 0.02},
            ),
        ):
            events = await _collect_events(
                retry_stage3_pipeline("conv-123", "model-chairman", storage=storage)
            )

        types = _event_types(events)
        assert types == ["stage3_start", "stage3_complete", "metrics_complete", "complete"]

    @pytest.mark.asyncio
    async def test_stage3_complete_contains_result_data(self):
        """The stage3_complete event carries the chairman result in its data field."""
        conversation = _make_conversation()
        storage = _make_mock_storage(conversation=conversation)
        new_stage3 = {
            "model": "model-chairman",
            "response": "Excellent synthesis",
            "metrics": {"total_tokens": 150},
        }

        with (
            patch(
                "backend.council_stream.stage3_synthesize_final",
                new_callable=AsyncMock,
                return_value=new_stage3,
            ),
            patch("backend.council_stream.aggregate_metrics", return_value={}),
        ):
            events = await _collect_events(
                retry_stage3_pipeline("conv-123", "model-chairman", storage=storage)
            )

        s3_event = _find_event(events, "stage3_complete")
        assert s3_event is not None
        assert s3_event["data"]["response"] == "Excellent synthesis"

    @pytest.mark.asyncio
    async def test_calls_storage_update_on_success(self):
        """Pipeline persists the new stage3 via update_last_council_stage3."""
        conversation = _make_conversation()
        storage = _make_mock_storage(conversation=conversation)
        new_stage3 = {
            "model": "model-chairman",
            "response": "Good synthesis",
            "metrics": {},
        }
        aggregated_metrics = {"total_cost": 0.03}

        with (
            patch(
                "backend.council_stream.stage3_synthesize_final",
                new_callable=AsyncMock,
                return_value=new_stage3,
            ),
            patch(
                "backend.council_stream.aggregate_metrics",
                return_value=aggregated_metrics,
            ),
        ):
            await _collect_events(
                retry_stage3_pipeline("conv-123", "model-chairman", storage=storage)
            )

        storage.update_last_council_stage3.assert_called_once_with(
            "conv-123", new_stage3, aggregated_metrics, user_id=None,
        )

    @pytest.mark.asyncio
    async def test_passes_user_id_to_storage(self):
        """user_id is forwarded through to both get_conversation and update."""
        conversation = _make_conversation()
        storage = _make_mock_storage(conversation=conversation)
        new_stage3 = {"model": "m", "response": "Synthesis", "metrics": {}}

        with (
            patch(
                "backend.council_stream.stage3_synthesize_final",
                new_callable=AsyncMock,
                return_value=new_stage3,
            ),
            patch("backend.council_stream.aggregate_metrics", return_value={}),
        ):
            await _collect_events(
                retry_stage3_pipeline(
                    "conv-123", "m", user_id="bob", storage=storage,
                )
            )

        storage.get_conversation.assert_called_once_with("conv-123", "bob")
        storage.update_last_council_stage3.assert_called_once()
        call_kwargs = storage.update_last_council_stage3.call_args
        assert call_kwargs.kwargs["user_id"] == "bob"

    @pytest.mark.asyncio
    async def test_aggregate_metrics_receives_all_stages(self):
        """aggregate_metrics is called with stage1, stage2, and the new stage3."""
        conversation = _make_conversation()
        storage = _make_mock_storage(conversation=conversation)
        new_stage3 = {"model": "m", "response": "Synthesis", "metrics": {}}

        with (
            patch(
                "backend.council_stream.stage3_synthesize_final",
                new_callable=AsyncMock,
                return_value=new_stage3,
            ),
            patch("backend.council_stream.aggregate_metrics", return_value={}) as mock_agg,
        ):
            await _collect_events(
                retry_stage3_pipeline("conv-123", "m", storage=storage)
            )

        mock_agg.assert_called_once_with(STAGE1_RESULTS, STAGE2_RESULTS, new_stage3)


class TestRetryStage3PipelineChairmanFailsAgain:
    """When the chairman fails again, pipeline yields stage3_complete then error."""

    @pytest.mark.asyncio
    async def test_yields_stage3_complete_then_error_on_chairman_failure(self):
        """Error response from chairman yields stage3_complete (with error data) then error."""
        conversation = _make_conversation()
        storage = _make_mock_storage(conversation=conversation)
        failed_stage3 = {
            "model": "model-chairman",
            "response": "Error: Chairman model returned no response",
            "metrics": {},
        }

        with patch(
            "backend.council_stream.stage3_synthesize_final",
            new_callable=AsyncMock,
            return_value=failed_stage3,
        ):
            events = await _collect_events(
                retry_stage3_pipeline("conv-123", "model-chairman", storage=storage)
            )

        types = _event_types(events)
        assert types == ["stage3_start", "stage3_complete", "error"]

        s3_event = _find_event(events, "stage3_complete")
        assert s3_event["data"]["response"].startswith("Error:")

        error_event = _find_event(events, "error")
        assert "failed again" in error_event["message"].lower()

    @pytest.mark.asyncio
    async def test_does_not_persist_when_chairman_fails_again(self):
        """Storage update is NOT called when the chairman produces an error response."""
        conversation = _make_conversation()
        storage = _make_mock_storage(conversation=conversation)
        failed_stage3 = {
            "model": "model-chairman",
            "response": "Error: No response",
            "metrics": {},
        }

        with patch(
            "backend.council_stream.stage3_synthesize_final",
            new_callable=AsyncMock,
            return_value=failed_stage3,
        ):
            await _collect_events(
                retry_stage3_pipeline("conv-123", "model-chairman", storage=storage)
            )

        storage.update_last_council_stage3.assert_not_called()


class TestRetryStage3PipelineUnexpectedException:
    """Unexpected exceptions are caught and yielded as error events."""

    @pytest.mark.asyncio
    async def test_yields_error_on_unexpected_exception(self):
        """An exception during stage3 synthesis yields an error event."""
        conversation = _make_conversation()
        storage = _make_mock_storage(conversation=conversation)

        with patch(
            "backend.council_stream.stage3_synthesize_final",
            new_callable=AsyncMock,
            side_effect=RuntimeError("OpenRouter timeout"),
        ):
            events = await _collect_events(
                retry_stage3_pipeline("conv-123", "model-chairman", storage=storage)
            )

        types = _event_types(events)
        assert "stage3_start" in types
        assert types[-1] == "error"
        assert "OpenRouter timeout" in events[-1]["message"]


# =============================================================================
# Unified format fixtures
# =============================================================================

UNIFIED_ROUND1 = {
    "round_number": 1,
    "round_type": "responses",
    "responses": [
        {"participant": "Response A", "model": "model-a", "content": "Answer A", "metrics": {"total_tokens": 50}},
        {"participant": "Response B", "model": "model-b", "content": "Answer B", "metrics": {"total_tokens": 60}},
    ],
}

UNIFIED_ROUND2 = {
    "round_number": 2,
    "round_type": "rankings",
    "responses": [
        {
            "participant": "model-a",
            "model": "model-a",
            "content": "FINAL RANKING:\n1. Response A\n2. Response B",
            "parsed_ranking": ["Response A", "Response B"],
            "metrics": {"total_tokens": 40},
        },
    ],
    "metadata": {
        "label_to_model": {"Response A": "model-a", "Response B": "model-b"},
        "aggregate_rankings": [],
    },
}

UNIFIED_SYNTHESIS = {
    "model": "model-chairman",
    "content": "Error: Unable to generate final synthesis.",
}


def _make_unified_conversation(*, has_rounds: bool = True) -> dict:
    """Build a conversation with unified-format assistant message."""
    messages: list[dict] = [{"role": "user", "content": "What is the meaning of life?"}]
    council_msg: dict = {"role": "assistant", "mode": "council"}
    if has_rounds:
        council_msg["rounds"] = [UNIFIED_ROUND1, UNIFIED_ROUND2]
        council_msg["synthesis"] = UNIFIED_SYNTHESIS
        council_msg["participant_mapping"] = {"Response A": "model-a", "Response B": "model-b"}
    messages.append(council_msg)
    return {"id": "conv-unified", "messages": messages}


# =============================================================================
# _extract_stage_data — format bridge
# =============================================================================


class TestExtractStageData:
    """Tests for _extract_stage_data helper."""

    def test_extracts_from_legacy_format(self):
        """Returns stage1/stage2 directly from legacy keys."""
        msg = {"stage1": STAGE1_RESULTS, "stage2": STAGE2_RESULTS}
        s1, s2 = _extract_stage_data(msg)
        assert s1 == STAGE1_RESULTS
        assert s2 == STAGE2_RESULTS

    def test_extracts_from_unified_format(self):
        """Converts unified rounds back to legacy-format lists."""
        msg = {"rounds": [UNIFIED_ROUND1, UNIFIED_ROUND2]}
        s1, s2 = _extract_stage_data(msg)

        assert len(s1) == 2
        assert s1[0]["model"] == "model-a"
        assert s1[0]["response"] == "Answer A"
        assert s1[0]["metrics"]["total_tokens"] == 50

        assert len(s2) == 1
        assert s2[0]["model"] == "model-a"
        assert s2[0]["ranking"] == "FINAL RANKING:\n1. Response A\n2. Response B"
        assert s2[0]["parsed_ranking"] == ["Response A", "Response B"]

    def test_returns_none_for_empty_message(self):
        """Returns (None, None) when neither format is present."""
        s1, s2 = _extract_stage_data({})
        assert s1 is None
        assert s2 is None

    def test_returns_none_when_rounds_too_short(self):
        """Returns (None, None) when rounds list has fewer than 2 entries."""
        msg = {"rounds": [UNIFIED_ROUND1]}
        s1, s2 = _extract_stage_data(msg)
        assert s1 is None
        assert s2 is None

    def test_unified_preserves_reasoning_details(self):
        """reasoning_details are carried through from unified responses."""
        round1 = {
            "round_number": 1,
            "round_type": "responses",
            "responses": [
                {"participant": "A", "model": "m-a", "content": "answer", "reasoning_details": "thinking..."},
            ],
        }
        round2 = {
            "round_number": 2,
            "round_type": "rankings",
            "responses": [
                {"participant": "m-a", "model": "m-a", "content": "ranking text"},
            ],
        }
        s1, s2 = _extract_stage_data({"rounds": [round1, round2]})
        assert s1[0]["reasoning_details"] == "thinking..."
        assert "reasoning_details" not in s2[0]  # not set, should be omitted


# =============================================================================
# update_last_council_stage3 — unified format
# =============================================================================


class TestUpdateLastCouncilStage3Unified:
    """Tests for storage update on unified-format messages."""

    def test_updates_synthesis_key_on_unified_message(self):
        """Writes to 'synthesis' (not 'stage3') when message has 'rounds' key."""
        conversation = _make_unified_conversation()
        new_stage3 = {"model": "model-chairman", "response": "Better synthesis", "metrics": {"total_tokens": 120}}

        with (
            patch("backend.storage.get_conversation", return_value=conversation),
            patch("backend.storage.save_conversation") as mock_save,
        ):
            update_last_council_stage3("conv-unified", new_stage3)

        council_msg = conversation["messages"][-1]
        assert council_msg["synthesis"]["model"] == "model-chairman"
        assert council_msg["synthesis"]["content"] == "Better synthesis"
        assert council_msg["synthesis"]["metrics"]["total_tokens"] == 120
        assert "stage3" not in council_msg  # should NOT create legacy key
        mock_save.assert_called_once()

    def test_preserves_reasoning_details_on_unified(self):
        """reasoning_details is included in synthesis when provided."""
        conversation = _make_unified_conversation()
        new_stage3 = {
            "model": "model-chairman",
            "response": "Synthesis with reasoning",
            "metrics": {},
            "reasoning_details": "Chairman's chain of thought",
        }

        with (
            patch("backend.storage.get_conversation", return_value=conversation),
            patch("backend.storage.save_conversation"),
        ):
            update_last_council_stage3("conv-unified", new_stage3)

        council_msg = conversation["messages"][-1]
        assert council_msg["synthesis"]["reasoning_details"] == "Chairman's chain of thought"


# =============================================================================
# retry_stage3_pipeline — unified format
# =============================================================================


class TestRetryStage3PipelineUnified:
    """Retry pipeline works with unified-format conversations."""

    @pytest.mark.asyncio
    async def test_succeeds_with_unified_format_conversation(self):
        """Pipeline extracts stage data from rounds and completes successfully."""
        conversation = _make_unified_conversation()
        storage = _make_mock_storage(conversation=conversation)
        new_stage3 = {"model": "model-chairman", "response": "New synthesis", "metrics": {"total_tokens": 100}}

        with (
            patch(
                "backend.council_stream.stage3_synthesize_final",
                new_callable=AsyncMock,
                return_value=new_stage3,
            ) as mock_s3,
            patch("backend.council_stream.aggregate_metrics", return_value={"total_cost": 0.01}),
        ):
            events = await _collect_events(
                retry_stage3_pipeline("conv-unified", "model-chairman", storage=storage)
            )

        types = _event_types(events)
        assert types == ["stage3_start", "stage3_complete", "metrics_complete", "complete"]

        # Verify stage3_synthesize_final received properly converted data
        call_args = mock_s3.call_args
        stage1_arg = call_args[0][1]
        stage2_arg = call_args[0][2]
        assert len(stage1_arg) == 2
        assert stage1_arg[0]["model"] == "model-a"
        assert stage1_arg[0]["response"] == "Answer A"
        assert len(stage2_arg) == 1
        assert stage2_arg[0]["ranking"] == "FINAL RANKING:\n1. Response A\n2. Response B"

    @pytest.mark.asyncio
    async def test_unified_pipeline_persists_result(self):
        """Pipeline calls storage update after successful retry with unified data."""
        conversation = _make_unified_conversation()
        storage = _make_mock_storage(conversation=conversation)
        new_stage3 = {"model": "model-chairman", "response": "Fixed", "metrics": {}}

        with (
            patch("backend.council_stream.stage3_synthesize_final", new_callable=AsyncMock, return_value=new_stage3),
            patch("backend.council_stream.aggregate_metrics", return_value={}),
        ):
            await _collect_events(
                retry_stage3_pipeline("conv-unified", "model-chairman", storage=storage)
            )

        storage.update_last_council_stage3.assert_called_once()
