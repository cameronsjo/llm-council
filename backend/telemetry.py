"""OpenTelemetry telemetry configuration for LLM Council.

This module provides optional OpenTelemetry instrumentation. Tracing is enabled
only when OTEL_EXPORTER_OTLP_ENDPOINT is configured, otherwise it gracefully
degrades to a no-op tracer.
"""

import logging
import os
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger(__name__)

# Environment configuration
OTEL_EXPORTER_OTLP_ENDPOINT = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
OTEL_SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "llm-council")

# Module-level state
_tracer = None
_telemetry_enabled = False


def is_telemetry_enabled() -> bool:
    """Check if OpenTelemetry tracing is enabled."""
    return _telemetry_enabled


def setup_telemetry() -> bool:
    """Initialize OpenTelemetry tracing.

    Configures the tracer provider with OTLP exporter if OTEL_EXPORTER_OTLP_ENDPOINT
    is set. Otherwise, telemetry is disabled (no-op mode).

    Returns:
        True if telemetry was successfully configured, False otherwise.
    """
    global _tracer, _telemetry_enabled

    if not OTEL_EXPORTER_OTLP_ENDPOINT:
        logger.info(
            "OpenTelemetry disabled: OTEL_EXPORTER_OTLP_ENDPOINT not configured"
        )
        return False

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        # Create resource with service name
        resource = Resource.create(
            {
                "service.name": OTEL_SERVICE_NAME,
                "service.version": "0.1.0",
            }
        )

        # Configure tracer provider
        provider = TracerProvider(resource=resource)

        # Add OTLP exporter
        otlp_exporter = OTLPSpanExporter(endpoint=OTEL_EXPORTER_OTLP_ENDPOINT)
        provider.add_span_processor(BatchSpanProcessor(otlp_exporter))

        # Set as global tracer provider
        trace.set_tracer_provider(provider)

        # Get tracer for this module
        _tracer = trace.get_tracer(__name__)
        _telemetry_enabled = True

        logger.info(
            "OpenTelemetry initialized. Endpoint: %s, Service: %s",
            OTEL_EXPORTER_OTLP_ENDPOINT,
            OTEL_SERVICE_NAME,
        )
        return True

    except ImportError as e:
        logger.warning("OpenTelemetry packages not available: %s", e)
        return False
    except Exception as e:
        logger.warning("Failed to initialize OpenTelemetry: %s", e)
        return False


def get_tracer() -> Any:
    """Get the configured tracer.

    Returns:
        The OpenTelemetry tracer if configured, otherwise a no-op tracer proxy.
    """
    global _tracer

    if _tracer is not None:
        return _tracer

    # Return a no-op tracer proxy if not configured
    return _NoOpTracer()


class _NoOpSpan:
    """No-op span implementation for when tracing is disabled."""

    def set_attribute(self, key: str, value: Any) -> None:
        """No-op: Set an attribute on the span."""
        pass

    def set_attributes(self, attributes: dict[str, Any]) -> None:
        """No-op: Set multiple attributes on the span."""
        pass

    def add_event(self, name: str, attributes: dict[str, Any] | None = None) -> None:
        """No-op: Add an event to the span."""
        pass

    def set_status(self, status: Any) -> None:
        """No-op: Set the span status."""
        pass

    def record_exception(self, exception: Exception) -> None:
        """No-op: Record an exception on the span."""
        pass

    def end(self) -> None:
        """No-op: End the span."""
        pass

    def __enter__(self) -> "_NoOpSpan":
        return self

    def __exit__(self, *args: Any) -> None:
        pass


class _NoOpTracer:
    """No-op tracer implementation for when tracing is disabled."""

    def start_span(self, name: str, **kwargs: Any) -> _NoOpSpan:
        """Return a no-op span."""
        return _NoOpSpan()

    def start_as_current_span(self, name: str, **kwargs: Any) -> _NoOpSpan:
        """Return a no-op span as a context manager."""
        return _NoOpSpan()


def instrument_fastapi(app: Any) -> None:
    """Instrument FastAPI application with OpenTelemetry.

    Args:
        app: The FastAPI application instance.
    """
    if not _telemetry_enabled:
        logger.debug("Skipping FastAPI instrumentation: telemetry disabled")
        return

    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(app)
        logger.info("FastAPI instrumentation enabled")
    except ImportError:
        logger.warning("FastAPI instrumentation package not available")
    except Exception as e:
        logger.warning("Failed to instrument FastAPI: %s", e)


def instrument_httpx() -> None:
    """Instrument httpx client with OpenTelemetry."""
    if not _telemetry_enabled:
        logger.debug("Skipping httpx instrumentation: telemetry disabled")
        return

    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().instrument()
        logger.info("httpx instrumentation enabled")
    except ImportError:
        logger.warning("httpx instrumentation package not available")
    except Exception as e:
        logger.warning("Failed to instrument httpx: %s", e)


@contextmanager
def trace_span(
    name: str,
    attributes: dict[str, Any] | None = None,
) -> Iterator[Any]:
    """Create a traced span as a context manager.

    This is a convenience wrapper that handles both enabled and disabled states.

    Args:
        name: The name of the span.
        attributes: Optional attributes to set on the span.

    Yields:
        The span object (real or no-op).
    """
    tracer = get_tracer()

    if _telemetry_enabled:

        with tracer.start_as_current_span(name) as span:
            if attributes:
                span.set_attributes(attributes)
            yield span
    else:
        yield _NoOpSpan()


async def trace_async_operation(
    name: str,
    operation: Any,
    attributes: dict[str, Any] | None = None,
) -> Any:
    """Trace an async operation.

    Args:
        name: The name of the span.
        operation: The awaitable to execute.
        attributes: Optional attributes to set on the span.

    Returns:
        The result of the operation.
    """
    with trace_span(name, attributes) as span:
        try:
            result = await operation
            return result
        except Exception as e:
            if _telemetry_enabled:
                span.record_exception(e)
                from opentelemetry.trace import Status, StatusCode

                span.set_status(Status(StatusCode.ERROR, str(e)))
            raise
