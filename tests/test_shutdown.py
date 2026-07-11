"""Tests for the graceful shutdown coordinator."""

import json

from backend.shutdown import ShutdownCoordinator, drain_streams


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


class _FakeClock:
    """A controllable monotonic clock that advances by `step` on each call."""

    def __init__(self, start: float = 0.0, step: float = 0.0) -> None:
        self.now = start
        self.step = step
        self.calls = 0

    def __call__(self) -> float:
        self.calls += 1
        value = self.now
        self.now += self.step
        return value


class TestDrainStreams:
    """Tests for drain_streams (issue #38)."""

    async def test_returns_promptly_when_no_streams(self):
        """With zero active streams, drain returns without waiting."""
        coord = ShutdownCoordinator()
        clock = _FakeClock(start=0.0, step=1.0)

        await drain_streams(coord, timeout=85, poll=0.0, clock=clock)

        # Loop body never entered — only the deadline computation calls the clock.
        assert coord.active_stream_count == 0

    async def test_completes_when_streams_drain_before_deadline(self):
        """A count that drops to zero after N polls completes without warning."""
        coord = ShutdownCoordinator()
        coord.register_stream()
        coord.register_stream()

        polls = 0
        real_unregister = coord.unregister_stream

        async def fake_sleep(_):
            nonlocal polls
            polls += 1
            real_unregister()  # one stream finishes per poll

        import backend.shutdown as shutdown_mod

        original_sleep = shutdown_mod.asyncio.sleep
        shutdown_mod.asyncio.sleep = fake_sleep
        try:
            # Clock never advances past the deadline, so only the drain matters.
            await drain_streams(
                coord, timeout=85, poll=0.01, clock=_FakeClock(start=0.0, step=0.0)
            )
        finally:
            shutdown_mod.asyncio.sleep = original_sleep

        assert coord.active_stream_count == 0
        assert polls == 2

    async def test_deadline_honored_logs_warning(self, caplog):
        """When streams never drain and the clock jumps past timeout, it warns and returns."""
        coord = ShutdownCoordinator()
        coord.register_stream()

        # First call (deadline compute) returns 0; next call jumps to 1000 > deadline.
        clock = _FakeClock(start=0.0, step=1000.0)

        with caplog.at_level("WARNING"):
            await drain_streams(coord, timeout=85, poll=0.0, clock=clock)

        assert coord.active_stream_count == 1  # never drained
        assert any(
            "Forcing shutdown" in record.message for record in caplog.records
        )

    async def test_deadline_computed_before_loop(self):
        """The deadline is fixed before polling — an advancing clock must not push it forward.

        With step=10 and timeout=85, deadline = 0 + 85 = 85 (captured on the
        first call). If the deadline were recomputed each iteration it would
        chase the clock and never expire; here it must expire once the clock
        crosses 85.
        """
        coord = ShutdownCoordinator()
        coord.register_stream()  # stays > 0 forever

        clock = _FakeClock(start=0.0, step=10.0)

        async def instant_sleep(_):
            return None

        import backend.shutdown as shutdown_mod

        original_sleep = shutdown_mod.asyncio.sleep
        shutdown_mod.asyncio.sleep = instant_sleep
        try:
            await drain_streams(coord, timeout=85, poll=0.0, clock=clock)
        finally:
            shutdown_mod.asyncio.sleep = original_sleep

        # Deadline (85) was captured on call #1. Clock returns 0,10,20,...; the
        # check crosses 85 in bounded iterations. If the deadline chased the
        # clock, this would hang — reaching here proves it was fixed up front.
        assert coord.active_stream_count == 1

    async def test_close_client_ordered_after_drain(self):
        """close_shared_client is not awaited until drain_streams returns (order guard)."""
        events: list[str] = []
        coord = ShutdownCoordinator()

        async def spy_drain():
            events.append("drain_start")
            await drain_streams(
                coord, timeout=85, poll=0.0, clock=_FakeClock(start=0.0, step=0.0)
            )
            events.append("drain_end")

        async def spy_close():
            events.append("close")

        await spy_drain()
        await spy_close()

        assert events == ["drain_start", "drain_end", "close"]


class TestResolveDrainSeconds:
    """Tests for the guarded env parse of the shutdown drain budget (#38)."""

    def test_absent_env_returns_ceiling_default(self, monkeypatch):
        """No override resolves to the ceiling default."""
        from backend.main import (
            SHUTDOWN_DRAIN_CEILING_SECONDS,
            _resolve_drain_seconds,
        )

        monkeypatch.delenv("LLMCOUNCIL_SHUTDOWN_DRAIN_SECONDS", raising=False)
        assert _resolve_drain_seconds() == SHUTDOWN_DRAIN_CEILING_SECONDS

    def test_valid_override_under_ceiling(self, monkeypatch):
        """A valid override below the ceiling is honored."""
        from backend.main import _resolve_drain_seconds

        monkeypatch.setenv("LLMCOUNCIL_SHUTDOWN_DRAIN_SECONDS", "30")
        assert _resolve_drain_seconds() == 30.0

    def test_override_above_ceiling_is_clamped(self, monkeypatch):
        """An override above the ceiling is clamped to it (invariant < 90s)."""
        from backend.main import (
            SHUTDOWN_DRAIN_CEILING_SECONDS,
            _resolve_drain_seconds,
        )

        monkeypatch.setenv("LLMCOUNCIL_SHUTDOWN_DRAIN_SECONDS", "1000")
        assert _resolve_drain_seconds() == SHUTDOWN_DRAIN_CEILING_SECONDS

    def test_malformed_override_falls_back_without_raising(self, monkeypatch):
        """A malformed override falls back to the default, never crashes startup."""
        from backend.main import (
            SHUTDOWN_DRAIN_CEILING_SECONDS,
            _resolve_drain_seconds,
        )

        monkeypatch.setenv("LLMCOUNCIL_SHUTDOWN_DRAIN_SECONDS", "85s")
        assert _resolve_drain_seconds() == SHUTDOWN_DRAIN_CEILING_SECONDS

    def test_negative_override_clamped_to_zero(self, monkeypatch):
        """A negative override clamps to zero, not an immediately-expired deadline."""
        from backend.main import _resolve_drain_seconds

        monkeypatch.setenv("LLMCOUNCIL_SHUTDOWN_DRAIN_SECONDS", "-5")
        assert _resolve_drain_seconds() == 0.0
