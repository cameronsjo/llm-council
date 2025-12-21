"""Export conversations to various formats."""

from datetime import datetime
from typing import Any


def format_model_name(model_id: str) -> str:
    """Format a model ID for display.

    Args:
        model_id: Full model identifier (e.g., "openai/gpt-4")

    Returns:
        Formatted display name
    """
    if "/" in model_id:
        return model_id.split("/")[-1]
    return model_id


def export_to_markdown(conversation: dict[str, Any]) -> str:
    """Export a conversation to Markdown format.

    Args:
        conversation: Full conversation dict

    Returns:
        Markdown-formatted string
    """
    lines: list[str] = []

    # Header
    title = conversation.get("title", "Untitled Conversation")
    created_at = conversation.get("created_at", "")
    if created_at:
        try:
            dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            date_str = dt.strftime("%Y-%m-%d %H:%M UTC")
        except (ValueError, TypeError):
            date_str = created_at
    else:
        date_str = "Unknown date"

    lines.append(f"# {title}")
    lines.append("")
    lines.append(f"*Exported from LLM Council on {date_str}*")
    lines.append("")

    # Council configuration
    council_models = conversation.get("council_models", [])
    chairman_model = conversation.get("chairman_model", "")
    if council_models:
        lines.append("## Council Configuration")
        lines.append("")
        lines.append(f"**Council Members:** {', '.join(format_model_name(m) for m in council_models)}")
        if chairman_model:
            lines.append(f"**Chairman:** {format_model_name(chairman_model)}")
        lines.append("")

    lines.append("---")
    lines.append("")

    # Messages
    for msg in conversation.get("messages", []):
        if msg.get("role") == "user":
            lines.append("## User")
            lines.append("")
            lines.append(msg.get("content", ""))
            lines.append("")

        elif msg.get("role") == "assistant":
            mode = msg.get("mode")

            if mode == "arena":
                # Arena mode format
                lines.append("## Arena Debate")
                lines.append("")

                # Participant mapping
                participant_mapping = msg.get("participant_mapping", {})
                if participant_mapping:
                    lines.append("### Participants")
                    lines.append("")
                    for label, model_id in sorted(participant_mapping.items()):
                        lines.append(f"- **{label}**: {format_model_name(model_id)}")
                    lines.append("")

                # Rounds
                rounds = msg.get("rounds", [])
                for round_data in rounds:
                    round_num = round_data.get("round_number", "?")
                    round_type = round_data.get("round_type", "unknown")
                    lines.append(f"### Round {round_num}: {round_type.title()}")
                    lines.append("")

                    for response in round_data.get("responses", []):
                        participant = response.get("participant", "Unknown")
                        content = response.get("content", "")
                        lines.append(f"#### {participant}")
                        lines.append("")
                        lines.append(content)
                        lines.append("")

                # Synthesis
                synthesis = msg.get("synthesis", {})
                if synthesis:
                    lines.append("### Final Synthesis")
                    lines.append("")
                    if synthesis.get("consensus"):
                        lines.append(f"**Consensus:** {synthesis['consensus']}")
                        lines.append("")
                    if synthesis.get("answer"):
                        lines.append(synthesis["answer"])
                        lines.append("")

            else:
                # Council mode format
                lines.append("## Council Response")
                lines.append("")

                # Stage 1 responses
                stage1 = msg.get("stage1", [])
                if stage1:
                    lines.append("### Stage 1: Individual Responses")
                    lines.append("")
                    for resp in stage1:
                        model = format_model_name(resp.get("model", "Unknown"))
                        content = resp.get("content", resp.get("response", ""))
                        lines.append(f"#### {model}")
                        lines.append("")
                        lines.append(content)
                        lines.append("")

                # Stage 2 rankings
                stage2 = msg.get("stage2", [])
                if stage2:
                    lines.append("### Stage 2: Peer Rankings")
                    lines.append("")
                    for ranking in stage2:
                        model = format_model_name(ranking.get("model", "Unknown"))
                        text = ranking.get("text", ranking.get("ranking_text", ""))
                        parsed = ranking.get("parsed_ranking", [])
                        lines.append(f"#### {model}'s Evaluation")
                        lines.append("")
                        if text:
                            lines.append(text)
                            lines.append("")
                        if parsed:
                            lines.append(f"**Extracted Ranking:** {', '.join(parsed)}")
                            lines.append("")

                # Stage 3 synthesis
                stage3 = msg.get("stage3", {})
                if stage3:
                    lines.append("### Stage 3: Final Synthesis")
                    lines.append("")
                    chairman = format_model_name(stage3.get("model", "Chairman"))
                    lines.append(f"*Synthesized by {chairman}*")
                    lines.append("")
                    lines.append(stage3.get("response", ""))
                    lines.append("")

        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def export_to_json(conversation: dict[str, Any]) -> dict[str, Any]:
    """Export a conversation to clean JSON format.

    This returns the conversation as-is but can be extended
    to transform or filter the data if needed.

    Args:
        conversation: Full conversation dict

    Returns:
        JSON-serializable dict
    """
    return {
        "id": conversation.get("id"),
        "title": conversation.get("title"),
        "created_at": conversation.get("created_at"),
        "council_models": conversation.get("council_models", []),
        "chairman_model": conversation.get("chairman_model"),
        "messages": conversation.get("messages", []),
    }
