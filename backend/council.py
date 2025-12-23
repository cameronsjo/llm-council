"""3-stage LLM Council orchestration."""

import logging
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
from .websearch import format_search_results, is_web_search_available, search_web

logger = logging.getLogger(__name__)


async def stage1_collect_responses(
    user_query: str,
    web_search_context: str | None = None,
    council_models: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    Stage 1: Collect individual responses from all council models.

    Args:
        user_query: The user's question
        web_search_context: Optional web search results to include in context
        council_models: Optional list of models (uses global config if None)

    Returns:
        List of dicts with 'model' and 'response' keys
    """
    tracer = get_tracer()
    effective_council = council_models if council_models else get_council_models()

    span_attributes = {
        "council.stage": 1,
        "council.stage_name": "collect_responses",
        "council.model_count": len(effective_council),
        "council.has_web_context": web_search_context is not None,
    }

    with tracer.start_as_current_span("council.stage1_collect_responses", attributes=span_attributes) as span:
        # System prompt to encourage critical, honest responses
        system_prompt = """You are a council member providing your honest assessment. Your role is to give a direct, accurate answer - not to please or validate the user.

GUIDELINES:
- If the question contains a flawed premise, point it out before answering
- If you're uncertain, say so explicitly rather than bluffing
- If the answer is "it depends" or "we don't know," explain why
- Push back on bad ideas, incorrect assumptions, or poor reasoning
- Be specific about tradeoffs, limitations, and edge cases
- Avoid generic, hedging, or diplomatic non-answers

Your response will be evaluated by your peers. Quality and honesty matter more than agreeableness."""

        # Build the prompt with optional web search context
        if web_search_context:
            prompt = f"""The following web search results have been gathered to help answer the user's question:

{web_search_context}

---

User's Question: {user_query}

Please use the web search results above as reference when answering. Cite sources where appropriate."""
        else:
            prompt = user_query

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]

        # Query all models in parallel
        responses = await query_models_parallel(effective_council, messages)

        # Format results
        stage1_results = []
        for model, response in responses.items():
            if response is not None:  # Only include successful responses
                result = {
                    "model": model,
                    "response": response.get('content', ''),
                    "metrics": response.get('metrics', {})
                }
                # Include reasoning details if present (for o1/o3 models)
                if response.get('reasoning_details'):
                    result['reasoning_details'] = response['reasoning_details']
                stage1_results.append(result)

        # Record response count in span
        if is_telemetry_enabled():
            span.set_attribute("council.response_count", len(stage1_results))

        return stage1_results


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: list[dict[str, Any]],
    council_models: list[str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """
    Stage 2: Each model ranks the anonymized responses.

    Args:
        user_query: The original user query
        stage1_results: Results from Stage 1
        council_models: Optional list of models (uses global config if None)

    Returns:
        Tuple of (rankings list, label_to_model mapping)
    """
    tracer = get_tracer()
    effective_council = council_models if council_models else get_council_models()

    span_attributes = {
        "council.stage": 2,
        "council.stage_name": "collect_rankings",
        "council.model_count": len(effective_council),
        "council.response_count": len(stage1_results),
    }

    with tracer.start_as_current_span("council.stage2_collect_rankings", attributes=span_attributes) as span:
        # Create anonymized labels for responses (Response A, Response B, etc.)
        labels = [chr(65 + i) for i in range(len(stage1_results))]  # A, B, C, ...

        # Create mapping from label to model name
        label_to_model = {
            f"Response {label}": result['model']
            for label, result in zip(labels, stage1_results)
        }

        # Build the ranking prompt
        responses_text = "\n\n".join([
            f"Response {label}:\n{result['response']}"
            for label, result in zip(labels, stage1_results)
        ])

        ranking_prompt = f"""You are a rigorous evaluator assessing responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

EVALUATION CRITERIA - Be ruthlessly honest:
- Accuracy: Are there factual errors, unsupported claims, or logical fallacies?
- Completeness: Does it actually answer the question, or dodge/deflect?
- Depth: Is the reasoning superficial or substantive?
- Honesty: Does it acknowledge uncertainty, or pretend to know what it doesn't?
- Usefulness: Would this actually help someone, or is it generic filler?

Your task:
1. Critically evaluate each response. Call out specific flaws, errors, and weaknesses. Don't be kind - be accurate.
2. Note what each response does well, if anything.
3. Provide a final ranking based on actual quality, not politeness.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example format:

Response A contains a factual error about X and fails to address Y...
Response B provides accurate information but is too vague on Z...
Response C is the most thorough but overstates confidence in its claims...

FINAL RANKING:
1. Response C
2. Response B
3. Response A

Now provide your critical evaluation and ranking:"""

        messages = [{"role": "user", "content": ranking_prompt}]

        # Get rankings from all council models in parallel
        responses = await query_models_parallel(effective_council, messages)

        # Format results
        stage2_results = []
        for model, response in responses.items():
            if response is not None:
                full_text = response.get('content', '')
                parsed = parse_ranking_from_text(full_text)
                result = {
                    "model": model,
                    "ranking": full_text,
                    "parsed_ranking": parsed,
                    "metrics": response.get('metrics', {})
                }
                # Include reasoning details if present (for o1/o3 models)
                if response.get('reasoning_details'):
                    result['reasoning_details'] = response['reasoning_details']
                stage2_results.append(result)

        # Record ranking count in span
        if is_telemetry_enabled():
            span.set_attribute("council.ranking_count", len(stage2_results))

        return stage2_results, label_to_model


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: list[dict[str, Any]],
    stage2_results: list[dict[str, Any]],
    chairman_model: str | None = None,
) -> dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response.

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from Stage 1
        stage2_results: Rankings from Stage 2
        chairman_model: Optional chairman model (uses global config if None)

    Returns:
        Dict with 'model' and 'response' keys
    """
    tracer = get_tracer()
    effective_chairman = chairman_model if chairman_model else get_chairman_model()

    span_attributes = {
        "council.stage": 3,
        "council.stage_name": "synthesize_final",
        "council.chairman_model": effective_chairman,
        "council.stage1_count": len(stage1_results),
        "council.stage2_count": len(stage2_results),
    }

    with tracer.start_as_current_span("council.stage3_synthesize_final", attributes=span_attributes) as span:
        # Build comprehensive context for chairman
        stage1_text = "\n\n".join([
            f"Model: {result['model']}\nResponse: {result['response']}"
            for result in stage1_results
        ])

        stage2_text = "\n\n".join([
            f"Model: {result['model']}\nRanking: {result['ranking']}"
            for result in stage2_results
        ])

        chairman_prompt = f"""You are the Chairman of an LLM Council tasked with delivering the TRUTH, not consensus.

Original Question: {user_query}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_text}

YOUR MANDATE AS CHAIRMAN:
You are not here to please the user or validate their assumptions. You are here to provide the most accurate, honest answer possible.

CRITICAL EVALUATION:
1. Identify where the council AGREES - but agreement doesn't mean correctness. Consensus around a wrong answer is still wrong.
2. Identify where the council DISAGREES - genuine disagreement often reveals important nuance or uncertainty.
3. Look for ERRORS - factual mistakes, logical fallacies, unsupported claims, or wishful thinking.
4. Consider what's MISSING - what did the models fail to address or conveniently ignore?

YOUR RESPONSE MUST:
- Correct any errors in the council's responses, even if highly-ranked models made them
- Push back on flawed reasoning, bad ideas, or incorrect assumptions - including from the user's original question
- Acknowledge genuine uncertainty rather than pretending to know things you don't
- Be direct and honest, not diplomatic and evasive
- Prioritize accuracy over being agreeable

If the user's premise is flawed, say so. If a popular answer is wrong, explain why. If there's no good answer, admit it.

Now provide your synthesis - the truth as best you can determine it:"""

        messages = [{"role": "user", "content": chairman_prompt}]

        # Query the chairman model
        response = await query_model(effective_chairman, messages)

        if response is None:
            # Fallback if chairman fails
            if is_telemetry_enabled():
                from opentelemetry.trace import Status, StatusCode
                span.set_status(Status(StatusCode.ERROR, "Chairman model failed"))
            return {
                "model": effective_chairman,
                "response": "Error: Unable to generate final synthesis.",
                "metrics": {}
            }

        result = {
            "model": effective_chairman,
            "response": response.get('content', ''),
            "metrics": response.get('metrics', {})
        }
        # Include reasoning details if present (for o1/o3 models)
        if response.get('reasoning_details'):
            result['reasoning_details'] = response['reasoning_details']

        return result


def parse_ranking_from_text(ranking_text: str) -> list[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Args:
        ranking_text: The full text response from the model

    Returns:
        List of response labels in ranked order
    """
    import re

    # Look for "FINAL RANKING:" section
    if "FINAL RANKING:" in ranking_text:
        # Extract everything after "FINAL RANKING:"
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            # Try to extract numbered list format (e.g., "1. Response A")
            # This pattern looks for: number, period, optional space, "Response X"
            numbered_matches = re.findall(r'\d+\.\s*Response [A-Z]', ranking_section)
            if numbered_matches:
                # Extract just the "Response X" part
                return [re.search(r'Response [A-Z]', m).group() for m in numbered_matches]

            # Fallback: Extract all "Response X" patterns in order
            matches = re.findall(r'Response [A-Z]', ranking_section)
            return matches

    # Fallback: try to find any "Response X" patterns in order
    matches = re.findall(r'Response [A-Z]', ranking_text)
    return matches


def aggregate_metrics(
    stage1_results: list[dict[str, Any]],
    stage2_results: list[dict[str, Any]],
    stage3_result: dict[str, Any]
) -> dict[str, Any]:
    """
    Aggregate metrics across all stages.

    Args:
        stage1_results: Results from Stage 1 with metrics
        stage2_results: Results from Stage 2 with metrics
        stage3_result: Result from Stage 3 with metrics

    Returns:
        Aggregated metrics dict with totals and per-stage breakdown
    """
    metrics = {
        'total_cost': 0.0,
        'total_tokens': 0,
        'total_latency_ms': 0,
        'by_stage': {
            'stage1': {'cost': 0.0, 'tokens': 0, 'latency_ms': 0, 'models': []},
            'stage2': {'cost': 0.0, 'tokens': 0, 'latency_ms': 0, 'models': []},
            'stage3': {'cost': 0.0, 'tokens': 0, 'latency_ms': 0},
        }
    }

    # Aggregate Stage 1 metrics
    for result in stage1_results:
        m = result.get('metrics', {})
        cost = m.get('cost', 0.0) or 0.0
        tokens = m.get('total_tokens', 0) or 0
        latency = m.get('latency_ms', 0) or 0

        metrics['total_cost'] += cost
        metrics['total_tokens'] += tokens
        metrics['total_latency_ms'] = max(metrics['total_latency_ms'], latency)  # Parallel, so take max

        metrics['by_stage']['stage1']['cost'] += cost
        metrics['by_stage']['stage1']['tokens'] += tokens
        metrics['by_stage']['stage1']['latency_ms'] = max(
            metrics['by_stage']['stage1']['latency_ms'], latency
        )
        metrics['by_stage']['stage1']['models'].append({
            'model': result.get('model'),
            'cost': cost,
            'tokens': tokens,
            'latency_ms': latency,
            'provider': m.get('provider'),
        })

    # Aggregate Stage 2 metrics
    for result in stage2_results:
        m = result.get('metrics', {})
        cost = m.get('cost', 0.0) or 0.0
        tokens = m.get('total_tokens', 0) or 0
        latency = m.get('latency_ms', 0) or 0

        metrics['total_cost'] += cost
        metrics['total_tokens'] += tokens
        # Stage 2 runs in parallel after Stage 1
        metrics['by_stage']['stage2']['cost'] += cost
        metrics['by_stage']['stage2']['tokens'] += tokens
        metrics['by_stage']['stage2']['latency_ms'] = max(
            metrics['by_stage']['stage2']['latency_ms'], latency
        )
        metrics['by_stage']['stage2']['models'].append({
            'model': result.get('model'),
            'cost': cost,
            'tokens': tokens,
            'latency_ms': latency,
            'provider': m.get('provider'),
        })

    # Add Stage 2 latency to total (sequential with Stage 1)
    metrics['total_latency_ms'] += metrics['by_stage']['stage2']['latency_ms']

    # Aggregate Stage 3 metrics
    m = stage3_result.get('metrics', {})
    cost = m.get('cost', 0.0) or 0.0
    tokens = m.get('total_tokens', 0) or 0
    latency = m.get('latency_ms', 0) or 0

    metrics['total_cost'] += cost
    metrics['total_tokens'] += tokens
    metrics['total_latency_ms'] += latency  # Sequential

    metrics['by_stage']['stage3']['cost'] = cost
    metrics['by_stage']['stage3']['tokens'] = tokens
    metrics['by_stage']['stage3']['latency_ms'] = latency

    # Round cost for display
    metrics['total_cost'] = round(metrics['total_cost'], 6)
    metrics['by_stage']['stage1']['cost'] = round(metrics['by_stage']['stage1']['cost'], 6)
    metrics['by_stage']['stage2']['cost'] = round(metrics['by_stage']['stage2']['cost'], 6)
    metrics['by_stage']['stage3']['cost'] = round(metrics['by_stage']['stage3']['cost'], 6)

    return metrics


def calculate_aggregate_rankings(
    stage2_results: list[dict[str, Any]],
    label_to_model: dict[str, str]
) -> list[dict[str, Any]]:
    """
    Calculate aggregate rankings across all models.

    Args:
        stage2_results: Rankings from each model
        label_to_model: Mapping from anonymous labels to model names

    Returns:
        List of dicts with model name and average rank, sorted best to worst
    """
    from collections import defaultdict

    # Track positions for each model
    model_positions = defaultdict(list)

    for ranking in stage2_results:
        ranking_text = ranking['ranking']

        # Parse the ranking from the structured format
        parsed_ranking = parse_ranking_from_text(ranking_text)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                model_positions[model_name].append(position)

    # Calculate average position for each model
    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions)
            })

    # Sort by average rank (lower is better)
    aggregate.sort(key=lambda x: x['average_rank'])

    return aggregate


async def generate_conversation_title(user_query: str) -> str:
    """
    Generate a short title for a conversation based on the first user message.

    Args:
        user_query: The first user message

    Returns:
        A short title (3-5 words)
    """
    title_prompt = f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: {user_query}

Title:"""

    messages = [{"role": "user", "content": title_prompt}]

    # Use gemini-2.5-flash for title generation (fast and cheap)
    response = await query_model("google/gemini-2.5-flash", messages, timeout=30.0)

    if response is None:
        # Fallback to a generic title
        return "New Conversation"

    title = response.get('content', 'New Conversation').strip()

    # Clean up the title - remove quotes, limit length
    title = title.strip('"\'')

    # Truncate if too long
    if len(title) > 50:
        title = title[:47] + "..."

    return title


async def perform_web_search(query: str) -> tuple[str | None, str | None]:
    """
    Perform web search and return formatted results.

    Args:
        query: The search query

    Returns:
        Tuple of (formatted_results, error_message)
        - On success: (results_string, None)
        - On error: (None, error_message)
    """
    if not is_web_search_available():
        return None, "Web search not configured"

    search_results, error = await search_web(query, max_results=5)
    if error:
        return None, error
    if search_results:
        return format_search_results(search_results), None
    return None, "No results found"


async def run_full_council(
    user_query: str,
    use_web_search: bool = False,
    council_models: list[str] | None = None,
    chairman_model: str | None = None,
) -> tuple[list, list, dict, dict]:
    """
    Run the complete 3-stage council process.

    Args:
        user_query: The user's question
        use_web_search: Whether to include web search results
        council_models: Optional list of models (uses global config if None)
        chairman_model: Optional chairman model (uses global config if None)

    Returns:
        Tuple of (stage1_results, stage2_results, stage3_result, metadata)
    """
    # Optionally perform web search
    web_search_context = None
    web_search_error = None
    if use_web_search:
        web_search_context, web_search_error = await perform_web_search(user_query)

    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(
        user_query, web_search_context, council_models
    )

    # If no models responded successfully, return error
    if not stage1_results:
        return [], [], {
            "model": "error",
            "response": "All models failed to respond. Please try again."
        }, {}

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(
        user_query, stage1_results, council_models
    )

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results,
        chairman_model,
    )

    # Calculate aggregated metrics
    metrics = aggregate_metrics(stage1_results, stage2_results, stage3_result)

    # Prepare metadata
    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings,
        "web_search_used": web_search_context is not None,
        "web_search_error": web_search_error,
        "metrics": metrics,
    }

    return stage1_results, stage2_results, stage3_result, metadata


def convert_to_unified_result(
    stage1_results: list[dict[str, Any]],
    stage2_results: list[dict[str, Any]],
    stage3_result: dict[str, Any],
    label_to_model: dict[str, str],
    aggregate_rankings: list[dict[str, Any]],
    metrics: dict[str, Any],
) -> DeliberationResult:
    """
    Convert legacy stage-based results to unified DeliberationResult.

    This bridges the gap between the existing stage functions and the
    new unified data model, allowing incremental migration.
    """
    # Convert Stage 1 to Round 1 (responses)
    round1_responses = []
    for i, result in enumerate(stage1_results):
        label = f"Response {chr(65 + i)}"  # Response A, B, C...
        response_metrics = None
        if result.get("metrics"):
            response_metrics = Metrics.from_dict(result["metrics"])

        round1_responses.append(ParticipantResponse(
            participant=label,
            model=result["model"],
            content=result.get("response", ""),
            metrics=response_metrics,
            reasoning_details=result.get("reasoning_details"),
        ))

    round1 = Round(
        round_number=1,
        round_type=RoundType.RESPONSES,
        responses=round1_responses,
    )

    # Convert Stage 2 to Round 2 (rankings)
    round2_responses = []
    for result in stage2_results:
        response_metrics = None
        if result.get("metrics"):
            response_metrics = Metrics.from_dict(result["metrics"])

        # For rankings, participant is the evaluator model
        round2_responses.append(ParticipantResponse(
            participant=result["model"],  # Evaluator identified by model
            model=result["model"],
            content=result.get("ranking", ""),
            metrics=response_metrics,
            reasoning_details=result.get("reasoning_details"),
            parsed_ranking=result.get("parsed_ranking"),
        ))

    round2 = Round(
        round_number=2,
        round_type=RoundType.RANKINGS,
        responses=round2_responses,
        metadata={
            "label_to_model": label_to_model,
            "aggregate_rankings": aggregate_rankings,
        },
    )

    # Convert Stage 3 to Synthesis
    synthesis_metrics = None
    if stage3_result.get("metrics"):
        synthesis_metrics = Metrics.from_dict(stage3_result["metrics"])

    synthesis = Synthesis(
        model=stage3_result.get("model", ""),
        content=stage3_result.get("response", ""),
        metrics=synthesis_metrics,
        reasoning_details=stage3_result.get("reasoning_details"),
    )

    # Build unified result
    return DeliberationResult(
        mode="council",
        rounds=[round1, round2],
        synthesis=synthesis,
        participant_mapping=label_to_model,
        metrics=metrics,
    )


def convert_legacy_message_to_unified(message: dict[str, Any]) -> dict[str, Any]:
    """
    Convert a legacy stored message (stage1/stage2/stage3) to unified format.

    Used for backward compatibility when reading old conversations.
    """
    if message.get("role") != "assistant":
        return message

    # Already in unified format
    if "rounds" in message:
        return message

    # Check for arena format (already has rounds-like structure)
    if message.get("mode") == "arena":
        return message

    # Convert legacy council format
    stage1 = message.get("stage1", [])
    stage2 = message.get("stage2", [])
    stage3 = message.get("stage3", {})

    if not stage1:
        return message  # Not a council message

    # Build label_to_model mapping
    label_to_model = {}
    for i, result in enumerate(stage1):
        label = f"Response {chr(65 + i)}"
        label_to_model[label] = result.get("model", "")

    # Calculate aggregate rankings if we have stage2
    aggregate_rankings = []
    if stage2:
        aggregate_rankings = calculate_aggregate_rankings(stage2, label_to_model)

    # Get metrics if available
    metrics = message.get("metrics", {})

    # Convert to unified
    result = convert_to_unified_result(
        stage1, stage2, stage3, label_to_model, aggregate_rankings, metrics
    )

    # Return as dict, preserving any extra fields
    unified = result.to_dict()
    unified["role"] = "assistant"

    # Copy over any other fields that might exist
    for key in message:
        if key not in ("role", "stage1", "stage2", "stage3", "metrics"):
            unified[key] = message[key]

    return unified
