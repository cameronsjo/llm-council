"""Tests for the council streaming pipeline."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.council_stream import CouncilPipelineInput, run_council_pipeline


def make_input(**overrides) -> CouncilPipelineInput:
    """Factory for test inputs with sensible defaults."""
    defaults = {
        "conversation_id": "test-conv-123",
        "user_id": None,
        "content": "What is the meaning of life?",
        "council_models": ["model-a", "model-b"],
        "chairman_model": "model-chairman",
        "is_first_message": True,
    }
    defaults.update(overrides)
    return CouncilPipelineInput(**defaults)


def make_mock_storage() -> MagicMock:
    """Create a mock storage module with all required functions."""
    storage = MagicMock()
    storage.get_pending_message.return_value = None
    storage.add_user_message = MagicMock()
    storage.mark_response_pending = MagicMock()
    storage.update_pending_progress = MagicMock()
    storage.update_conversation_title = MagicMock()
    storage.add_unified_message = MagicMock()
    storage.clear_pending = MagicMock()
    return storage


STAGE1_RESULTS = [
    {"model": "model-a", "response": "Answer A", "metrics": {}},
    {"model": "model-b", "response": "Answer B", "metrics": {}},
]

STAGE2_RESULTS = [
    {"model": "model-a", "ranking": "text", "parsed_ranking": ["Response A", "Response B"], "metrics": {}},
]

LABEL_TO_MODEL = {"Response A": "model-a", "Response B": "model-b"}

STAGE3_RESULT = {"model": "model-chairman", "response": "Synthesis", "metrics": {}}


async def collect_events(pipeline) -> list[dict]:
    """Drain an async generator into a list."""
    return [event async for event in pipeline]


def event_types(events: list[dict]) -> list[str]:
    """Extract just the type field from events."""
    return [e["type"] for e in events]


def find_events(events: list[dict], event_type: str) -> list[dict]:
    """Filter events by type."""
    return [e for e in events if e.get("type") == event_type]


class TestCouncilPipelineHappyPath:
    """Pipeline yields events in the correct order for a normal run."""

    @pytest.mark.asyncio
    async def test_yields_all_stage_events_in_order(self):
        """Full pipeline yields stage events in correct sequence ending with complete."""
        inp = make_input()
        storage = make_mock_storage()

        with (
            patch("backend.council_stream.stage1_collect_responses", new_callable=AsyncMock) as mock_s1,
            patch("backend.council_stream.stage2_collect_rankings", new_callable=AsyncMock) as mock_s2,
            patch("backend.council_stream.stage3_synthesize_final", new_callable=AsyncMock) as mock_s3,
            patch("backend.council_stream.generate_conversation_title", new_callable=AsyncMock) as mock_title,
            patch("backend.council_stream.calculate_aggregate_rankings") as mock_agg,
            patch("backend.council_stream.aggregate_metrics") as mock_metrics,
            patch("backend.council_stream.convert_to_unified_result") as mock_convert,
            patch("backend.council_stream.process_attachments") as mock_attach,
        ):
            async def fake_stage1(content, context, models, **kwargs):
                cb = kwargs.get("on_model_response")
                if cb:
                    for r in STAGE1_RESULTS:
                        await cb(r["model"], r)
                return STAGE1_RESULTS

            mock_s1.side_effect = fake_stage1
            mock_s2.return_value = (STAGE2_RESULTS, LABEL_TO_MODEL)
            mock_s3.return_value = STAGE3_RESULT
            mock_title.return_value = "Meaning of Life"
            mock_agg.return_value = [{"model": "model-a", "average_rank": 1.0, "rankings_count": 1}]
            mock_metrics.return_value = {"total_cost": 0.01}
            mock_convert.return_value = MagicMock()
            mock_attach.return_value = ("", [])

            events = await collect_events(run_council_pipeline(inp, storage=storage))

        types = event_types(events)
        assert "stage1_start" in types
        assert "stage1_complete" in types
        assert "stage2_start" in types
        assert "stage2_complete" in types
        assert "stage3_start" in types
        assert "stage3_complete" in types
        assert "metrics_complete" in types
        assert "title_complete" in types
        assert types[-1] == "complete"

        # Order constraints
        assert types.index("stage1_start") < types.index("stage1_complete")
        assert types.index("stage1_complete") < types.index("stage2_start")
        assert types.index("stage2_complete") < types.index("stage3_start")
        assert types.index("stage3_complete") < types.index("complete")

    @pytest.mark.asyncio
    async def test_clears_pending_on_success(self):
        """Pending state is cleared after successful pipeline completion."""
        inp = make_input(is_first_message=False)
        storage = make_mock_storage()

        with (
            patch("backend.council_stream.stage1_collect_responses", new_callable=AsyncMock) as mock_s1,
            patch("backend.council_stream.stage2_collect_rankings", new_callable=AsyncMock) as mock_s2,
            patch("backend.council_stream.stage3_synthesize_final", new_callable=AsyncMock) as mock_s3,
            patch("backend.council_stream.calculate_aggregate_rankings") as mock_agg,
            patch("backend.council_stream.aggregate_metrics") as mock_metrics,
            patch("backend.council_stream.convert_to_unified_result") as mock_convert,
            patch("backend.council_stream.process_attachments") as mock_attach,
        ):
            async def fake_stage1(content, context, models, **kwargs):
                return STAGE1_RESULTS
            mock_s1.side_effect = fake_stage1
            mock_s2.return_value = (STAGE2_RESULTS, LABEL_TO_MODEL)
            mock_s3.return_value = STAGE3_RESULT
            mock_agg.return_value = []
            mock_metrics.return_value = {}
            mock_convert.return_value = MagicMock()
            mock_attach.return_value = ("", [])

            await collect_events(run_council_pipeline(inp, storage=storage))

        storage.clear_pending.assert_called_once_with("test-conv-123", user_id=None)

    @pytest.mark.asyncio
    async def test_no_title_generation_on_subsequent_messages(self):
        """Title generation only fires for first messages."""
        inp = make_input(is_first_message=False)
        storage = make_mock_storage()

        with (
            patch("backend.council_stream.stage1_collect_responses", new_callable=AsyncMock) as mock_s1,
            patch("backend.council_stream.stage2_collect_rankings", new_callable=AsyncMock) as mock_s2,
            patch("backend.council_stream.stage3_synthesize_final", new_callable=AsyncMock) as mock_s3,
            patch("backend.council_stream.generate_conversation_title", new_callable=AsyncMock) as mock_title,
            patch("backend.council_stream.calculate_aggregate_rankings") as mock_agg,
            patch("backend.council_stream.aggregate_metrics") as mock_metrics,
            patch("backend.council_stream.convert_to_unified_result") as mock_convert,
            patch("backend.council_stream.process_attachments") as mock_attach,
        ):
            async def fake_stage1(content, context, models, **kwargs):
                return STAGE1_RESULTS
            mock_s1.side_effect = fake_stage1
            mock_s2.return_value = (STAGE2_RESULTS, LABEL_TO_MODEL)
            mock_s3.return_value = STAGE3_RESULT
            mock_agg.return_value = []
            mock_metrics.return_value = {}
            mock_convert.return_value = MagicMock()
            mock_attach.return_value = ("", [])

            events = await collect_events(run_council_pipeline(inp, storage=storage))

        mock_title.assert_not_called()
        assert "title_complete" not in event_types(events)


class TestCouncilPipelineResume:
    """Pipeline resume behavior."""

    @pytest.mark.asyncio
    async def test_resume_skips_stage1_and_user_message(self):
        """When resuming with partial data, skip Stage 1 and emit resume_start."""
        storage = make_mock_storage()
        storage.get_pending_message.return_value = {
            "partial_data": {
                "stage1": [{"model": "m", "response": "r", "metrics": {}}]
            }
        }
        inp = make_input(resume=True, is_first_message=False)

        with (
            patch("backend.council_stream.stage1_collect_responses", new_callable=AsyncMock) as mock_s1,
            patch("backend.council_stream.stage2_collect_rankings", new_callable=AsyncMock) as mock_s2,
            patch("backend.council_stream.stage3_synthesize_final", new_callable=AsyncMock) as mock_s3,
            patch("backend.council_stream.calculate_aggregate_rankings") as mock_agg,
            patch("backend.council_stream.aggregate_metrics") as mock_metrics,
            patch("backend.council_stream.convert_to_unified_result") as mock_convert,
        ):
            mock_s2.return_value = ([], {})
            mock_s3.return_value = {"model": "m", "response": "s", "metrics": {}}
            mock_agg.return_value = []
            mock_metrics.return_value = {}
            mock_convert.return_value = MagicMock()

            events = await collect_events(run_council_pipeline(inp, storage=storage))

        types = event_types(events)
        assert "resume_start" in types
        assert "stage1_start" not in types
        storage.add_user_message.assert_not_called()
        mock_s1.assert_not_called()


class TestCouncilPipelineErrors:
    """Error handling behavior."""

    @pytest.mark.asyncio
    async def test_exception_yields_error_event_and_updates_pending(self):
        """If a stage raises, an error event is yielded and pending updated."""
        inp = make_input(is_first_message=False)
        storage = make_mock_storage()

        with (
            patch("backend.council_stream.stage1_collect_responses", new_callable=AsyncMock) as mock_s1,
            patch("backend.council_stream.stage2_collect_rankings", new_callable=AsyncMock) as mock_s2,
            patch("backend.council_stream.process_attachments") as mock_attach,
        ):
            async def fake_stage1(content, context, models, **kwargs):
                return [{"model": "m", "response": "r", "metrics": {}}]
            mock_s1.side_effect = fake_stage1
            mock_attach.return_value = ("", [])
            mock_s2.side_effect = RuntimeError("Stage 2 exploded")

            events = await collect_events(run_council_pipeline(inp, storage=storage))

        error_events = find_events(events, "error")
        assert len(error_events) == 1
        assert "Stage 2 exploded" in error_events[0]["message"]
        storage.clear_pending.assert_not_called()
