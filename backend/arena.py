"""Multi-round arena debate orchestration for LLM Council."""

import logging
from dataclasses import asdict, dataclass
from typing import Any

from .config import get_chairman_model, get_council_models
from .deliberation import (
    DeliberationResult,
    Metrics,
    ParticipantResponse,
    Round,
    RoundType,
    Synthesis,
)
from .openrouter import query_model, query_models_parallel
from .telemetry import get_tracer, is_telemetry_enabled

logger = logging.getLogger(__name__)


@dataclass
class ArenaRound:
    """Represents a single round of arena debate.

    Note: This is kept for backward compatibility during streaming.
    New code should use the unified Round class from deliberation module.
    """

    round_number: int
    round_type: str  # "opening" | "rebuttal" | "closing"
    responses: list[dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)

    def to_unified_round(self) -> Round:
        """Convert to unified Round model."""
        # Map arena round types to unified RoundType
        type_mapping = {
            "initial": RoundType.OPENING,
            "opening": RoundType.OPENING,
            "deliberation": RoundType.REBUTTAL,
            "rebuttal": RoundType.REBUTTAL,
            "closing": RoundType.CLOSING,
        }
        round_type = type_mapping.get(self.round_type, self.round_type)

        unified_responses = []
        for resp in self.responses:
            metrics = None
            if resp.get("metrics"):
                metrics = Metrics.from_dict(resp["metrics"])

            unified_responses.append(ParticipantResponse(
                participant=resp.get("participant", ""),
                model=resp.get("model", ""),
                content=resp.get("response", ""),
                metrics=metrics,
            ))

        return Round(
            round_number=self.round_number,
            round_type=round_type,
            responses=unified_responses,
        )


# Prompt Templates

ROUND1_PROMPT = """You are {participant_label} in a multi-round debate among AI participants.

Question: {user_query}
{web_context_section}
Provide your initial position on this question. Be clear, well-reasoned, and thorough.

Other participants will see your response and may challenge, refine, or build upon it in subsequent rounds. This is Round 1 of {total_rounds}.

Your response:"""


DELIBERATION_PROMPT = """You are {participant_label} in Round {round_number} of {total_rounds} of a multi-round debate.

Original Question: {user_query}

=== Previous Discussion ===
{formatted_previous_rounds}
=== End Previous Discussion ===

This is a deliberation round. Having reviewed all previous positions, you should:
- **REBUT**: Challenge arguments you disagree with, citing specific points
- **REFINE**: Improve upon your own position or others' valid points
- **CONCEDE**: Acknowledge where others made stronger arguments
- **STRENGTHEN**: Provide additional evidence or reasoning for positions you support

Be specific about which participant(s) you're responding to. Maintain intellectual honesty.
Focus on the most substantive points of agreement or disagreement.

Your deliberation:"""


SYNTHESIS_PROMPT = """You are the moderator synthesizing a multi-round debate among AI participants.

Original Question: {user_query}

=== Complete Debate Transcript ===
{all_rounds_formatted}
=== End Transcript ===

=== Participant Identities ===
{identity_reveal}
=== End Identities ===

Synthesize this debate into a comprehensive final answer. Your synthesis MUST include these sections:

## Consensus Points
Areas where participants converged or agreed. What did they collectively establish as true or valid?

## Complete Answer
The best answer to the original question, incorporating the strongest insights from all rounds. This should be a thorough, well-reasoned response that a user would find valuable.

## Unresolved Dissents
Points of genuine disagreement that remain after deliberation. Why do these disagreements persist? What would need to be known to resolve them?

Provide a comprehensive, well-structured response:"""


def create_participant_mapping(models: list[str]) -> dict[str, str]:
    """
    Create anonymous participant labels for models.

    Args:
        models: List of model identifiers

    Returns:
        Dict mapping participant labels to model identifiers
        e.g., {"Participant A": "openai/gpt-5.1", "Participant B": "google/gemini-3-pro"}
    """
    labels = [chr(65 + i) for i in range(len(models))]  # A, B, C, ...
    return {f"Participant {label}": model for label, model in zip(labels, models)}


def get_participant_label(model: str, mapping: dict[str, str]) -> str:
    """Get the participant label for a given model."""
    for label, m in mapping.items():
        if m == model:
            return label
    return "Unknown Participant"


def format_previous_rounds(rounds: list[ArenaRound]) -> str:
    """Format previous rounds for inclusion in deliberation prompt."""
    formatted_parts = []
    for arena_round in rounds:
        round_header = f"--- Round {arena_round.round_number} ({arena_round.round_type.title()}) ---"
        formatted_parts.append(round_header)

        for response in arena_round.responses:
            participant = response.get("participant", "Unknown")
            content = response.get("response", "")
            formatted_parts.append(f"\n{participant}:\n{content}\n")

    return "\n".join(formatted_parts)


def format_identity_reveal(mapping: dict[str, str]) -> str:
    """Format participant identity mapping for synthesis."""
    lines = []
    for label, model in mapping.items():
        # Extract short model name
        short_name = model.split("/")[1] if "/" in model else model
        lines.append(f"- {label}: {short_name} ({model})")
    return "\n".join(lines)


async def round1_initial_positions(
    user_query: str,
    participant_mapping: dict[str, str],
    total_rounds: int,
    web_search_context: str | None = None,
) -> ArenaRound:
    """
    Collect initial positions from all participants (Round 1).

    Args:
        user_query: The user's question
        participant_mapping: Map of participant labels to model IDs
        total_rounds: Total number of rounds in this debate
        web_search_context: Optional web search results

    Returns:
        ArenaRound with all participant responses
    """
    tracer = get_tracer()
    span_attributes = {
        "arena.round": 1,
        "arena.round_type": "initial",
        "arena.participant_count": len(participant_mapping),
        "arena.total_rounds": total_rounds,
        "arena.has_web_context": web_search_context is not None,
    }

    with tracer.start_as_current_span("arena.round1_initial_positions", attributes=span_attributes) as span:
        web_section = ""
        if web_search_context:
            web_section = f"\nThe following web search results may be helpful:\n{web_search_context}\n"

        # Build prompts for each participant
        model_prompts = {}
        for label, model in participant_mapping.items():
            prompt = ROUND1_PROMPT.format(
                participant_label=label,
                user_query=user_query,
                web_context_section=web_section,
                total_rounds=total_rounds,
            )
            model_prompts[model] = [{"role": "user", "content": prompt}]

        # Query all models in parallel
        models = list(participant_mapping.values())
        responses = await query_models_parallel(
            models, None, custom_messages=model_prompts
        )

        # Format results
        round_responses = []
        for label, model in participant_mapping.items():
            response = responses.get(model)
            if response is not None:
                round_responses.append(
                    {
                        "participant": label,
                        "model": model,
                        "response": response.get("content", ""),
                        "metrics": response.get("metrics", {}),
                    }
                )

        # Record response count in span
        if is_telemetry_enabled():
            span.set_attribute("arena.response_count", len(round_responses))

        return ArenaRound(
            round_number=1, round_type="initial", responses=round_responses
        )


async def round_n_deliberation(
    user_query: str,
    round_number: int,
    total_rounds: int,
    previous_rounds: list[ArenaRound],
    participant_mapping: dict[str, str],
) -> ArenaRound:
    """
    Conduct a deliberation round where participants respond to previous arguments.

    Args:
        user_query: The original user query
        round_number: Current round number (2+)
        total_rounds: Total number of rounds
        previous_rounds: All previous rounds of debate
        participant_mapping: Map of participant labels to model IDs

    Returns:
        ArenaRound with deliberation responses
    """
    tracer = get_tracer()
    span_attributes = {
        "arena.round": round_number,
        "arena.round_type": "deliberation",
        "arena.participant_count": len(participant_mapping),
        "arena.total_rounds": total_rounds,
        "arena.previous_rounds": len(previous_rounds),
    }

    with tracer.start_as_current_span("arena.round_n_deliberation", attributes=span_attributes) as span:
        formatted_history = format_previous_rounds(previous_rounds)

        # Build prompts for each participant
        model_prompts = {}
        for label, model in participant_mapping.items():
            prompt = DELIBERATION_PROMPT.format(
                participant_label=label,
                round_number=round_number,
                total_rounds=total_rounds,
                user_query=user_query,
                formatted_previous_rounds=formatted_history,
            )
            model_prompts[model] = [{"role": "user", "content": prompt}]

        # Query all models in parallel
        models = list(participant_mapping.values())
        responses = await query_models_parallel(
            models, None, custom_messages=model_prompts
        )

        # Format results
        round_responses = []
        for label, model in participant_mapping.items():
            response = responses.get(model)
            if response is not None:
                round_responses.append(
                    {
                        "participant": label,
                        "model": model,
                        "response": response.get("content", ""),
                        "metrics": response.get("metrics", {}),
                    }
                )

        # Record response count in span
        if is_telemetry_enabled():
            span.set_attribute("arena.response_count", len(round_responses))

        return ArenaRound(
            round_number=round_number, round_type="deliberation", responses=round_responses
        )


async def final_synthesis(
    user_query: str,
    all_rounds: list[ArenaRound],
    participant_mapping: dict[str, str],
    chairman_model: str | None = None,
) -> dict[str, Any]:
    """
    Synthesize the full debate into consensus, answer, and dissents.

    Args:
        user_query: The original user query
        all_rounds: All rounds of debate
        participant_mapping: Map of participant labels to model IDs
        chairman_model: Optional chairman model (uses global config if None)

    Returns:
        Dict with synthesis result
    """
    tracer = get_tracer()
    effective_chairman = chairman_model if chairman_model else get_chairman_model()

    span_attributes = {
        "arena.operation": "final_synthesis",
        "arena.chairman_model": effective_chairman,
        "arena.round_count": len(all_rounds),
        "arena.participant_count": len(participant_mapping),
    }

    with tracer.start_as_current_span("arena.final_synthesis", attributes=span_attributes) as span:
        formatted_rounds = format_previous_rounds(all_rounds)
        identity_reveal = format_identity_reveal(participant_mapping)

        prompt = SYNTHESIS_PROMPT.format(
            user_query=user_query,
            all_rounds_formatted=formatted_rounds,
            identity_reveal=identity_reveal,
        )

        messages = [{"role": "user", "content": prompt}]

        # Use chairman model for synthesis
        response = await query_model(effective_chairman, messages)

        if response is None:
            if is_telemetry_enabled():
                from opentelemetry.trace import Status, StatusCode
                span.set_status(Status(StatusCode.ERROR, "Chairman model failed"))
            return {
                "model": effective_chairman,
                "content": "Error: Unable to generate synthesis.",
                "metrics": {},
            }

        return {
            "model": effective_chairman,
            "content": response.get("content", ""),
            "metrics": response.get("metrics", {}),
        }


def aggregate_arena_metrics(
    rounds: list[ArenaRound], synthesis: dict[str, Any]
) -> dict[str, Any]:
    """
    Aggregate metrics across all arena rounds and synthesis.

    Args:
        rounds: All debate rounds
        synthesis: Synthesis result

    Returns:
        Aggregated metrics dict
    """
    metrics = {
        "total_cost": 0.0,
        "total_tokens": 0,
        "total_latency_ms": 0,
        "by_round": [],
        "synthesis": {},
    }

    # Aggregate round metrics
    for arena_round in rounds:
        round_metrics = {
            "round_number": arena_round.round_number,
            "round_type": arena_round.round_type,
            "cost": 0.0,
            "tokens": 0,
            "latency_ms": 0,
            "participants": [],
        }

        max_latency = 0
        for response in arena_round.responses:
            m = response.get("metrics", {})
            cost = m.get("cost", 0.0) or 0.0
            tokens = m.get("total_tokens", 0) or 0
            latency = m.get("latency_ms", 0) or 0

            round_metrics["cost"] += cost
            round_metrics["tokens"] += tokens
            max_latency = max(max_latency, latency)

            round_metrics["participants"].append(
                {
                    "participant": response.get("participant"),
                    "model": response.get("model"),
                    "cost": cost,
                    "tokens": tokens,
                    "latency_ms": latency,
                }
            )

        round_metrics["latency_ms"] = max_latency  # Parallel execution
        round_metrics["cost"] = round(round_metrics["cost"], 6)

        metrics["total_cost"] += round_metrics["cost"]
        metrics["total_tokens"] += round_metrics["tokens"]
        metrics["total_latency_ms"] += round_metrics["latency_ms"]
        metrics["by_round"].append(round_metrics)

    # Add synthesis metrics
    synth_metrics = synthesis.get("metrics", {})
    synth_cost = synth_metrics.get("cost", 0.0) or 0.0
    synth_tokens = synth_metrics.get("total_tokens", 0) or 0
    synth_latency = synth_metrics.get("latency_ms", 0) or 0

    metrics["synthesis"] = {
        "model": synthesis.get("model"),
        "cost": round(synth_cost, 6),
        "tokens": synth_tokens,
        "latency_ms": synth_latency,
    }

    metrics["total_cost"] += synth_cost
    metrics["total_tokens"] += synth_tokens
    metrics["total_latency_ms"] += synth_latency

    metrics["total_cost"] = round(metrics["total_cost"], 6)

    return metrics


async def run_arena_debate(
    user_query: str,
    round_count: int = 3,
    web_search_context: str | None = None,
    council_models: list[str] | None = None,
    chairman_model: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, str], dict[str, Any]]:
    """
    Run a complete multi-round arena debate.

    Args:
        user_query: The user's question
        round_count: Number of debate rounds (minimum 1)
        web_search_context: Optional web search results
        council_models: Optional list of models (uses global config if None)
        chairman_model: Optional chairman model (uses global config if None)

    Returns:
        Tuple of (rounds_list, synthesis, participant_mapping, metrics)
    """
    # Create participant mapping from council models (use provided or fall back to global)
    effective_council = council_models if council_models else get_council_models()
    participant_mapping = create_participant_mapping(effective_council)

    rounds: list[ArenaRound] = []

    # Round 1: Initial positions
    round1 = await round1_initial_positions(
        user_query, participant_mapping, round_count, web_search_context
    )
    rounds.append(round1)

    # Rounds 2-N: Deliberation
    for round_num in range(2, round_count + 1):
        deliberation_round = await round_n_deliberation(
            user_query, round_num, round_count, rounds, participant_mapping
        )
        rounds.append(deliberation_round)

    # Final synthesis
    synthesis = await final_synthesis(user_query, rounds, participant_mapping, chairman_model)

    # Aggregate metrics
    metrics = aggregate_arena_metrics(rounds, synthesis)

    # Convert rounds to dicts for JSON serialization
    rounds_as_dicts = [r.to_dict() for r in rounds]

    return rounds_as_dicts, synthesis, participant_mapping, metrics


def convert_arena_to_unified_result(
    rounds: list[dict[str, Any]],
    synthesis: dict[str, Any],
    participant_mapping: dict[str, str],
    metrics: dict[str, Any],
) -> DeliberationResult:
    """
    Convert arena debate results to unified DeliberationResult.

    This bridges the gap between the existing arena functions and the
    new unified data model.
    """
    unified_rounds = []

    for round_dict in rounds:
        # Map arena round types to unified
        round_type = round_dict.get("round_type", "opening")
        type_mapping = {
            "initial": RoundType.OPENING,
            "opening": RoundType.OPENING,
            "deliberation": RoundType.REBUTTAL,
            "rebuttal": RoundType.REBUTTAL,
            "closing": RoundType.CLOSING,
        }
        unified_type = type_mapping.get(round_type, round_type)

        # Convert responses
        responses = []
        for resp in round_dict.get("responses", []):
            resp_metrics = None
            if resp.get("metrics"):
                resp_metrics = Metrics.from_dict(resp["metrics"])

            responses.append(ParticipantResponse(
                participant=resp.get("participant", ""),
                model=resp.get("model", ""),
                content=resp.get("response", ""),
                metrics=resp_metrics,
            ))

        unified_rounds.append(Round(
            round_number=round_dict.get("round_number", 1),
            round_type=unified_type,
            responses=responses,
        ))

    # Convert synthesis
    synthesis_metrics = None
    if synthesis.get("metrics"):
        synthesis_metrics = Metrics.from_dict(synthesis["metrics"])

    unified_synthesis = Synthesis(
        model=synthesis.get("model", ""),
        content=synthesis.get("content", ""),
        metrics=synthesis_metrics,
    )

    return DeliberationResult(
        mode="arena",
        rounds=unified_rounds,
        synthesis=unified_synthesis,
        participant_mapping=participant_mapping,
        metrics=metrics,
    )


def convert_legacy_arena_message_to_unified(message: dict[str, Any]) -> dict[str, Any]:
    """
    Convert a legacy arena message to unified format.

    Arena messages are already close to unified format, but this ensures
    consistency with the new structure.
    """
    if message.get("role") != "assistant":
        return message

    # Already in unified format
    if "rounds" in message and all(
        isinstance(r.get("responses", [{}])[0].get("content"), str)
        for r in message.get("rounds", [{}])
        if r.get("responses")
    ):
        return message

    # Check if this is an arena message
    if message.get("mode") != "arena":
        return message

    rounds = message.get("rounds", [])
    synthesis = message.get("synthesis", {})
    participant_mapping = message.get("participant_mapping", {})
    metrics = message.get("metrics", {})

    if not rounds:
        return message

    # Convert to unified
    result = convert_arena_to_unified_result(
        rounds, synthesis, participant_mapping, metrics
    )

    # Return as dict
    unified = result.to_dict()
    unified["role"] = "assistant"

    return unified
