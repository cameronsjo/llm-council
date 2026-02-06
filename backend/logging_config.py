"""Structured logging configuration for LLM Council.

This module configures structured JSON logging for production environments and
human-readable format for local development.

Environment Variables:
    LOG_FORMAT: Set to "json" for JSON output, anything else for human-readable.
    LOG_LEVEL: Logging level (DEBUG, INFO, WARNING, ERROR). Defaults to INFO.
"""

import logging
import os
import sys
from contextvars import ContextVar
from typing import Any

from pythonjsonlogger import jsonlogger

# Context variables for request-scoped data
_correlation_id: ContextVar[str | None] = ContextVar("correlation_id", default=None)
_current_user: ContextVar[str | None] = ContextVar("current_user", default=None)

# Environment configuration
LOG_FORMAT = os.getenv("LOG_FORMAT", "").lower()
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()


def get_correlation_id() -> str | None:
    """Get the current correlation ID from context."""
    return _correlation_id.get()


def set_correlation_id(correlation_id: str | None) -> None:
    """Set the correlation ID in context."""
    _correlation_id.set(correlation_id)


def get_current_user() -> str | None:
    """Get the current user from context."""
    return _current_user.get()


def set_current_user(username: str | None) -> None:
    """Set the current user in context."""
    _current_user.set(username)


class ContextAwareJsonFormatter(jsonlogger.JsonFormatter):
    """JSON formatter that includes correlation ID and user info."""

    def add_fields(
        self,
        log_record: dict[str, Any],
        record: logging.LogRecord,
        message_dict: dict[str, Any],
    ) -> None:
        """Add standard fields and context to log record."""
        super().add_fields(log_record, record, message_dict)

        # Standard fields
        log_record["timestamp"] = self.formatTime(record, self.datefmt)
        log_record["level"] = record.levelname
        log_record["logger"] = record.name
        log_record["message"] = record.getMessage()

        # Add context if available
        correlation_id = get_correlation_id()
        if correlation_id:
            log_record["correlation_id"] = correlation_id

        current_user = get_current_user()
        if current_user:
            log_record["user"] = current_user

        # Include any extra fields passed to the logger
        if hasattr(record, "extra_fields"):
            log_record.update(record.extra_fields)


class ContextAwareFormatter(logging.Formatter):
    """Human-readable formatter that includes correlation ID and user info."""

    def format(self, record: logging.LogRecord) -> str:
        """Format log record with context information."""
        import copy
        record = copy.copy(record)

        # Add context prefix if available
        context_parts = []

        correlation_id = get_correlation_id()
        if correlation_id:
            context_parts.append(f"[{correlation_id[:8]}]")

        current_user = get_current_user()
        if current_user:
            context_parts.append(f"[{current_user}]")

        context_prefix = " ".join(context_parts)
        if context_prefix:
            context_prefix += " "

        # Prepend context to message (on copy, not original)
        original_msg = record.getMessage()
        record.msg = f"{context_prefix}{original_msg}"
        record.args = ()

        return super().format(record)


def setup_logging() -> None:
    """Configure structured logging based on environment.

    Call this function once at application startup before any logging occurs.
    Uses LOG_FORMAT=json for JSON output, otherwise human-readable format.
    """
    # Determine log level
    level = getattr(logging, LOG_LEVEL, logging.INFO)

    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    # Remove existing handlers to avoid duplicates
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Create handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)

    # Choose formatter based on environment
    if LOG_FORMAT == "json":
        formatter = ContextAwareJsonFormatter(
            fmt="%(timestamp)s %(level)s %(logger)s %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    else:
        formatter = ContextAwareFormatter(
            fmt="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

    handler.setFormatter(formatter)
    root_logger.addHandler(handler)

    # Log startup message
    logger = logging.getLogger(__name__)
    logger.info(
        "Logging configured. Format: %s, Level: %s",
        "json" if LOG_FORMAT == "json" else "human-readable",
        LOG_LEVEL,
    )
