"""Web search functionality using Tavily API."""

import os
from typing import Optional, List, Dict, Any, Tuple
import httpx
from .config import TAVILY_API_KEY

TAVILY_API_URL = "https://api.tavily.com/search"


async def search_web(
    query: str,
    max_results: int = 5,
    search_depth: str = "basic",
    include_answer: bool = True,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Perform a web search using Tavily API.

    Args:
        query: The search query
        max_results: Maximum number of results to return (default 5)
        search_depth: "basic" or "advanced" (advanced is more thorough but slower)
        include_answer: Whether to include AI-generated answer summary

    Returns:
        Tuple of (results_dict, error_message)
        - On success: (results, None)
        - On error: (None, error_message)
    """
    if not TAVILY_API_KEY:
        return None, "Web search not configured"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                TAVILY_API_URL,
                json={
                    "api_key": TAVILY_API_KEY,
                    "query": query,
                    "max_results": max_results,
                    "search_depth": search_depth,
                    "include_answer": include_answer,
                    "include_raw_content": False,
                },
            )
            response.raise_for_status()
            return response.json(), None
    except httpx.TimeoutException:
        return None, "Web search timed out"
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            return None, "Invalid Tavily API key"
        elif e.response.status_code == 429:
            return None, "Web search rate limit exceeded"
        return None, f"Web search failed (HTTP {e.response.status_code})"
    except Exception as e:
        print(f"Web search error: {e}")
        return None, "Web search failed"


def format_search_results(search_response: Dict[str, Any]) -> str:
    """
    Format search results into a readable string for LLM context.

    Args:
        search_response: Response from Tavily API

    Returns:
        Formatted string with search results
    """
    if not search_response:
        return ""

    parts = []

    # Include the AI-generated answer if available
    if search_response.get("answer"):
        parts.append(f"**Web Search Summary:**\n{search_response['answer']}\n")

    # Include individual results
    results = search_response.get("results", [])
    if results:
        parts.append("**Sources:**")
        for i, result in enumerate(results, 1):
            title = result.get("title", "Untitled")
            url = result.get("url", "")
            content = result.get("content", "")
            # Truncate content if too long
            if len(content) > 500:
                content = content[:500] + "..."
            parts.append(f"\n{i}. **{title}**\n   URL: {url}\n   {content}")

    return "\n".join(parts)


def is_web_search_available() -> bool:
    """Check if web search is configured and available."""
    return bool(TAVILY_API_KEY)
