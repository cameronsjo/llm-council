"""3-stage LLM Council orchestration."""

from typing import List, Dict, Any, Tuple, Optional
from .openrouter import query_models_parallel, query_model
from .config import get_council_models, get_chairman_model
from .websearch import search_web, format_search_results, is_web_search_available


async def stage1_collect_responses(
    user_query: str,
    web_search_context: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Stage 1: Collect individual responses from all council models.

    Args:
        user_query: The user's question
        web_search_context: Optional web search results to include in context

    Returns:
        List of dicts with 'model' and 'response' keys
    """
    # Build the prompt with optional web search context
    if web_search_context:
        prompt = f"""The following web search results have been gathered to help answer the user's question:

{web_search_context}

---

User's Question: {user_query}

Please use the web search results above as reference when answering. Cite sources where appropriate."""
    else:
        prompt = user_query

    messages = [{"role": "user", "content": prompt}]

    # Query all models in parallel
    council_models = get_council_models()
    responses = await query_models_parallel(council_models, messages)

    # Format results
    stage1_results = []
    for model, response in responses.items():
        if response is not None:  # Only include successful responses
            stage1_results.append({
                "model": model,
                "response": response.get('content', ''),
                "metrics": response.get('metrics', {})
            })

    return stage1_results


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Stage 2: Each model ranks the anonymized responses.

    Args:
        user_query: The original user query
        stage1_results: Results from Stage 1

    Returns:
        Tuple of (rankings list, label_to_model mapping)
    """
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

    ranking_prompt = f"""You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:"""

    messages = [{"role": "user", "content": ranking_prompt}]

    # Get rankings from all council models in parallel
    council_models = get_council_models()
    responses = await query_models_parallel(council_models, messages)

    # Format results
    stage2_results = []
    for model, response in responses.items():
        if response is not None:
            full_text = response.get('content', '')
            parsed = parse_ranking_from_text(full_text)
            stage2_results.append({
                "model": model,
                "ranking": full_text,
                "parsed_ranking": parsed,
                "metrics": response.get('metrics', {})
            })

    return stage2_results, label_to_model


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response.

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from Stage 1
        stage2_results: Rankings from Stage 2

    Returns:
        Dict with 'model' and 'response' keys
    """
    # Build comprehensive context for chairman
    stage1_text = "\n\n".join([
        f"Model: {result['model']}\nResponse: {result['response']}"
        for result in stage1_results
    ])

    stage2_text = "\n\n".join([
        f"Model: {result['model']}\nRanking: {result['ranking']}"
        for result in stage2_results
    ])

    chairman_prompt = f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: {user_query}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    messages = [{"role": "user", "content": chairman_prompt}]

    # Query the chairman model
    chairman_model = get_chairman_model()
    response = await query_model(chairman_model, messages)

    if response is None:
        # Fallback if chairman fails
        return {
            "model": chairman_model,
            "response": "Error: Unable to generate final synthesis.",
            "metrics": {}
        }

    return {
        "model": chairman_model,
        "response": response.get('content', ''),
        "metrics": response.get('metrics', {})
    }


def parse_ranking_from_text(ranking_text: str) -> List[str]:
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
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    stage3_result: Dict[str, Any]
) -> Dict[str, Any]:
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
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str]
) -> List[Dict[str, Any]]:
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


async def perform_web_search(query: str) -> Tuple[Optional[str], Optional[str]]:
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
    use_web_search: bool = False
) -> Tuple[List, List, Dict, Dict]:
    """
    Run the complete 3-stage council process.

    Args:
        user_query: The user's question
        use_web_search: Whether to include web search results

    Returns:
        Tuple of (stage1_results, stage2_results, stage3_result, metadata)
    """
    # Optionally perform web search
    web_search_context = None
    web_search_error = None
    if use_web_search:
        web_search_context, web_search_error = await perform_web_search(user_query)

    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(user_query, web_search_context)

    # If no models responded successfully, return error
    if not stage1_results:
        return [], [], {
            "model": "error",
            "response": "All models failed to respond. Please try again."
        }, {}

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(user_query, stage1_results)

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results
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
