"""Tests for backend.openrouter progressive query logic."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from backend.openrouter import query_models_progressive


class TestQueryModelsProgressive:
    """Tests for query_models_progressive."""

    @pytest.mark.asyncio
    async def test_returns_results_for_all_models(self):
        """All models return results mapped by model name."""
        mock_response = {"content": "test response", "metrics": {}}

        with patch("backend.openrouter.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = mock_response

            results = await query_models_progressive(
                models=["model-a", "model-b"],
                messages=[{"role": "user", "content": "hello"}],
            )

        assert set(results.keys()) == {"model-a", "model-b"}
        assert results["model-a"] == mock_response
        assert results["model-b"] == mock_response

    @pytest.mark.asyncio
    async def test_on_model_complete_called_for_each_model(self):
        """on_model_complete callback fires once per model with correct args."""
        mock_response = {"content": "test", "metrics": {}}
        completed = []

        async def track_complete(model: str, result):
            completed.append(model)

        with patch("backend.openrouter.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = mock_response

            await query_models_progressive(
                models=["model-a", "model-b", "model-c"],
                messages=[{"role": "user", "content": "hello"}],
                on_model_complete=track_complete,
            )

        assert sorted(completed) == ["model-a", "model-b", "model-c"]

    @pytest.mark.asyncio
    async def test_on_progress_reports_incrementing_counts(self):
        """on_progress callback fires with incrementing completed count."""
        mock_response = {"content": "test", "metrics": {}}
        progress_updates = []

        async def track_progress(completed, total, completed_models, pending_models):
            progress_updates.append((completed, total))

        with patch("backend.openrouter.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = mock_response

            await query_models_progressive(
                models=["model-a", "model-b"],
                messages=[{"role": "user", "content": "hello"}],
                on_progress=track_progress,
            )

        assert len(progress_updates) == 2
        assert progress_updates[-1] == (2, 2)  # final update: all complete

    @pytest.mark.asyncio
    async def test_failed_model_returns_none(self):
        """A model that fails returns None in results dict."""
        with patch("backend.openrouter.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = None

            results = await query_models_progressive(
                models=["model-a"],
                messages=[{"role": "user", "content": "hello"}],
            )

        assert results["model-a"] is None

    @pytest.mark.asyncio
    async def test_custom_messages_per_model(self):
        """Custom messages are dispatched to the correct model."""
        mock_response = {"content": "test", "metrics": {}}

        with patch("backend.openrouter.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = mock_response

            custom = {
                "model-a": [{"role": "user", "content": "prompt A"}],
                "model-b": [{"role": "user", "content": "prompt B"}],
            }
            await query_models_progressive(
                models=["model-a", "model-b"],
                custom_messages=custom,
            )

        calls = {call.args[0]: call.args[1] for call in mock_query.call_args_list}
        assert calls["model-a"] == [{"role": "user", "content": "prompt A"}]
        assert calls["model-b"] == [{"role": "user", "content": "prompt B"}]

    @pytest.mark.asyncio
    async def test_raises_on_no_messages(self):
        """Raises ValueError when no messages or custom_messages provided."""
        with pytest.raises(ValueError, match="No messages provided"):
            await query_models_progressive(models=["model-a"])
