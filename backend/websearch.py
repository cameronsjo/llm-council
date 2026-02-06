"""Web search functionality using Tavily API with DuckDuckGo fallback."""

import asyncio
import logging
from typing import Any

import httpx

from . import config

logger = logging.getLogger(__name__)

TAVILY_API_URL = "https://api.tavily.com/search"


def _get_tavily_key() -> str | None:
    """Get Tavily API key from config (allows hot reload)."""
    return config.TAVILY_API_KEY


async def search_tavily(
    query: str,
    max_results: int = 5,
    search_depth: str = "basic",
    include_answer: bool = True,
) -> tuple[dict[str, Any] | None, str | None]:
    """
    Perform a web search using Tavily API.

    Returns:
        Tuple of (results_dict, error_message)
    """
    tavily_key = _get_tavily_key()
    if not tavily_key:
        return None, "Tavily API key not configured"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                TAVILY_API_URL,
                json={
                    "api_key": tavily_key,
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
        logger.error("Tavily search error: %s", e)
        return None, "Web search failed"


async def search_duckduckgo(
    query: str,
    max_results: int = 5,
) -> tuple[dict[str, Any] | None, str | None]:
    """
    Perform a web search using DuckDuckGo (free, no API key required).

    Returns:
        Tuple of (results_dict, error_message)
    """
    try:
        # Import here to avoid loading if not used
        from duckduckgo_search import DDGS

        # Run sync search in thread pool
        def do_search():
            with DDGS() as ddgs:
                results = list(ddgs.text(query, max_results=max_results))
                return results

        results = await asyncio.to_thread(do_search)

        if not results:
            return None, "No search results found"

        # Convert to Tavily-like format for compatibility
        formatted_results = {
            "results": [
                {
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "content": r.get("body", ""),
                }
                for r in results
            ],
            "answer": None,  # DuckDuckGo doesn't provide AI answers
        }

        return formatted_results, None

    except ImportError:
        return None, "DuckDuckGo search not installed"
    except Exception as e:
        logger.error("DuckDuckGo search error: %s", e)
        return None, f"DuckDuckGo search failed: {e}"


async def search_web(
    query: str,
    max_results: int = 5,
    search_depth: str = "basic",
    include_answer: bool = True,
) -> tuple[dict[str, Any] | None, str | None]:
    """
    Perform a web search using Tavily (if configured) or DuckDuckGo fallback.

    Args:
        query: The search query
        max_results: Maximum number of results to return (default 5)
        search_depth: "basic" or "advanced" (Tavily only)
        include_answer: Whether to include AI-generated answer (Tavily only)

    Returns:
        Tuple of (results_dict, error_message)
        - On success: (results, None)
        - On error: (None, error_message)
    """
    # Try Tavily first if configured
    if _get_tavily_key():
        result, error = await search_tavily(
            query, max_results, search_depth, include_answer
        )
        if result:
            return result, None
        # If Tavily fails, fall back to DuckDuckGo
        logger.warning("Tavily search failed (%s), falling back to DuckDuckGo", error)

    # Use DuckDuckGo as fallback
    return await search_duckduckgo(query, max_results)


def format_search_results(search_response: dict[str, Any]) -> str:
    """
    Format search results into a readable string for LLM context.

    Args:
        search_response: Response from search API

    Returns:
        Formatted string with search results
    """
    if not search_response:
        return ""

    parts = []

    # Include the AI-generated answer if available (Tavily)
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
    """Check if any web search is available."""
    # Always available now - DuckDuckGo works without API key
    return True


def get_search_provider() -> str:
    """Get the name of the current search provider."""
    if _get_tavily_key():
        return "tavily"
    return "duckduckgo"
