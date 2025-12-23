"""Unified deliberation data models for Council and Arena modes."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class RoundType(str, Enum):
    """Types of deliberation rounds."""

    # Council mode rounds
    RESPONSES = "responses"  # Stage 1: Individual model responses
    RANKINGS = "rankings"  # Stage 2: Peer evaluations and rankings

    # Arena mode rounds
    OPENING = "opening"  # Initial position statements
    REBUTTAL = "rebuttal"  # Response to other participants
    CLOSING = "closing"  # Final arguments


@dataclass
class Metrics:
    """Performance metrics for a response or round."""

    cost: float = 0.0
    total_tokens: int = 0
    latency_ms: int = 0
    provider: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        result = {
            "cost": self.cost,
            "total_tokens": self.total_tokens,
            "latency_ms": self.latency_ms,
        }
        if self.provider:
            result["provider"] = self.provider
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Metrics":
        """Create from dictionary."""
        return cls(
            cost=data.get("cost", 0.0) or 0.0,
            total_tokens=data.get("total_tokens", 0) or 0,
            latency_ms=data.get("latency_ms", 0) or 0,
            provider=data.get("provider"),
        )


@dataclass
class ParticipantResponse:
    """A single participant's response in a round.

    Works for both modes:
    - Council: participant is "Response A", "Response B", etc.
    - Arena: participant is "Participant A", "Participant B", etc.
    """

    participant: str  # Anonymous label
    model: str  # Actual model identifier
    content: str  # Response text
    metrics: Metrics | None = None
    reasoning_details: str | None = None  # For o1/o3 models

    # Rankings-specific fields (Council Stage 2)
    parsed_ranking: list[str] | None = None  # Extracted ranking order

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        result = {
            "participant": self.participant,
            "model": self.model,
            "content": self.content,
        }
        if self.metrics:
            result["metrics"] = self.metrics.to_dict()
        if self.reasoning_details:
            result["reasoning_details"] = self.reasoning_details
        if self.parsed_ranking:
            result["parsed_ranking"] = self.parsed_ranking
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ParticipantResponse":
        """Create from dictionary."""
        metrics = None
        if data.get("metrics"):
            metrics = Metrics.from_dict(data["metrics"])

        return cls(
            participant=data.get("participant", ""),
            model=data.get("model", ""),
            content=data.get("content", data.get("response", "")),  # Handle legacy "response" key
            metrics=metrics,
            reasoning_details=data.get("reasoning_details"),
            parsed_ranking=data.get("parsed_ranking"),
        )


@dataclass
class Round:
    """A single round of deliberation.

    Unified structure for both Council stages and Arena rounds.
    """

    round_number: int
    round_type: RoundType | str  # Allow string for flexibility
    responses: list[ParticipantResponse] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    metrics: Metrics | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        result = {
            "round_number": self.round_number,
            "round_type": self.round_type.value if isinstance(self.round_type, RoundType) else self.round_type,
            "responses": [r.to_dict() for r in self.responses],
        }
        if self.metadata:
            result["metadata"] = self.metadata
        if self.metrics:
            result["metrics"] = self.metrics.to_dict()
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Round":
        """Create from dictionary."""
        responses = [
            ParticipantResponse.from_dict(r) for r in data.get("responses", [])
        ]
        metrics = None
        if data.get("metrics"):
            metrics = Metrics.from_dict(data["metrics"])

        round_type = data.get("round_type", "responses")
        try:
            round_type = RoundType(round_type)
        except ValueError:
            pass  # Keep as string if not a valid enum value

        return cls(
            round_number=data.get("round_number", 1),
            round_type=round_type,
            responses=responses,
            metadata=data.get("metadata", {}),
            metrics=metrics,
        )


@dataclass
class Synthesis:
    """Final synthesis from the chairman.

    Used by both Council (Stage 3) and Arena (final synthesis).
    """

    model: str
    content: str
    metrics: Metrics | None = None
    reasoning_details: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        result = {
            "model": self.model,
            "content": self.content,
        }
        if self.metrics:
            result["metrics"] = self.metrics.to_dict()
        if self.reasoning_details:
            result["reasoning_details"] = self.reasoning_details
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Synthesis":
        """Create from dictionary."""
        metrics = None
        if data.get("metrics"):
            metrics = Metrics.from_dict(data["metrics"])

        return cls(
            model=data.get("model", ""),
            content=data.get("content", data.get("response", "")),  # Handle legacy "response" key
            metrics=metrics,
            reasoning_details=data.get("reasoning_details"),
        )


@dataclass
class DeliberationResult:
    """Complete result of a deliberation (Council or Arena).

    Unified structure that works for both modes.
    """

    mode: str  # "council" or "arena"
    rounds: list[Round] = field(default_factory=list)
    synthesis: Synthesis | None = None
    participant_mapping: dict[str, str] = field(default_factory=dict)  # "Response A" -> model
    metrics: dict[str, Any] = field(default_factory=dict)  # Aggregated metrics

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for storage/API."""
        result = {
            "mode": self.mode,
            "rounds": [r.to_dict() for r in self.rounds],
        }
        if self.synthesis:
            result["synthesis"] = self.synthesis.to_dict()
        if self.participant_mapping:
            result["participant_mapping"] = self.participant_mapping
        if self.metrics:
            result["metrics"] = self.metrics
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DeliberationResult":
        """Create from dictionary."""
        rounds = [Round.from_dict(r) for r in data.get("rounds", [])]
        synthesis = None
        if data.get("synthesis"):
            synthesis = Synthesis.from_dict(data["synthesis"])

        return cls(
            mode=data.get("mode", "council"),
            rounds=rounds,
            synthesis=synthesis,
            participant_mapping=data.get("participant_mapping", {}),
            metrics=data.get("metrics", {}),
        )
