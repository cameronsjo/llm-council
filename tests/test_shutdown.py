"""Tests for the graceful shutdown coordinator."""

import json

from backend.shutdown import ShutdownCoordinator


class TestShutdownCoordinator:
    """Tests for ShutdownCoordinator."""

    def test_initial_state(self):
        """Coordinator starts not shutting down with zero streams."""
        coord = ShutdownCoordinator()
        assert coord.is_shutting_down is False
        assert coord.active_stream_count == 0

    def test_initiate_shutdown_sets_flag(self):
        """initiate_shutdown sets the shutting_down flag."""
        coord = ShutdownCoordinator()
        coord.initiate_shutdown()
        assert coord.is_shutting_down is True

    def test_register_unregister_streams(self):
        """Stream count increments and decrements correctly."""
        coord = ShutdownCoordinator()
        coord.register_stream()
        coord.register_stream()
        assert coord.active_stream_count == 2

        coord.unregister_stream()
        assert coord.active_stream_count == 1

        coord.unregister_stream()
        assert coord.active_stream_count == 0

    def test_unregister_does_not_go_negative(self):
        """Unregistering with zero streams clamps to zero."""
        coord = ShutdownCoordinator()
        coord.unregister_stream()
        assert coord.active_stream_count == 0

    def test_shutdown_sse_event_is_valid_sse(self):
        """shutdown_sse_event returns a properly formatted SSE data line."""
        coord = ShutdownCoordinator()
        event = coord.shutdown_sse_event()

        assert event.startswith("data: ")
        assert event.endswith("\n\n")

        payload = json.loads(event[6:].strip())
        assert payload["type"] == "server_shutdown"
        assert "restarting" in payload["message"].lower()
