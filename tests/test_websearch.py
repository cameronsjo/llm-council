"""Tests for pure functions in backend.websearch."""

from backend import config
from backend.websearch import format_search_results, get_search_provider, is_web_search_available


# ---------------------------------------------------------------------------
# format_search_results
# ---------------------------------------------------------------------------

class TestFormatSearchResults:
    """Tests for format_search_results."""

    def test_response_with_answer_and_results(self):
        """Response with both answer and results formats both sections."""
        response = {
            "answer": "The answer is 42.",
            "results": [
                {
                    "title": "Source One",
                    "url": "https://example.com/1",
                    "content": "First result content.",
                },
                {
                    "title": "Source Two",
                    "url": "https://example.com/2",
                    "content": "Second result content.",
                },
            ],
        }

        result = format_search_results(response)

        assert "**Web Search Summary:**" in result
        assert "The answer is 42." in result
        assert "**Sources:**" in result
        assert "Source One" in result
        assert "https://example.com/1" in result
        assert "Source Two" in result

    def test_response_with_results_only(self):
        """Response without answer omits the summary section."""
        response = {
            "results": [
                {"title": "Only Result", "url": "https://example.com", "content": "Content here."},
            ],
        }

        result = format_search_results(response)

        assert "**Web Search Summary:**" not in result
        assert "**Sources:**" in result
        assert "Only Result" in result

    def test_empty_dict(self):
        """Empty dict returns empty string."""
        assert format_search_results({}) == ""

    def test_none_returns_empty_string(self):
        """None input returns empty string."""
        assert format_search_results(None) == ""

    def test_content_over_500_chars_truncated(self):
        """Content longer than 500 characters gets truncated with ellipsis."""
        long_content = "x" * 600
        response = {
            "results": [
                {"title": "Long", "url": "https://example.com", "content": long_content},
            ],
        }

        result = format_search_results(response)

        # The truncated content should be 500 chars + "..."
        assert "x" * 500 + "..." in result
        assert "x" * 501 not in result

    def test_response_with_answer_none(self):
        """Response with answer=None skips the summary section."""
        response = {
            "answer": None,
            "results": [
                {"title": "R", "url": "http://x.com", "content": "c"},
            ],
        }

        result = format_search_results(response)

        assert "**Web Search Summary:**" not in result
        assert "**Sources:**" in result


# ---------------------------------------------------------------------------
# is_web_search_available
# ---------------------------------------------------------------------------

class TestIsWebSearchAvailable:
    """Tests for is_web_search_available."""

    def test_always_returns_true(self):
        """Web search is always available (DuckDuckGo fallback)."""
        assert is_web_search_available() is True


# ---------------------------------------------------------------------------
# get_search_provider
# ---------------------------------------------------------------------------

class TestGetSearchProvider:
    """Tests for get_search_provider."""

    def test_with_tavily_key(self, monkeypatch):
        """Returns 'tavily' when TAVILY_API_KEY is set."""
        monkeypatch.setattr(config, "TAVILY_API_KEY", "tvly-test-key")
        assert get_search_provider() == "tavily"

    def test_without_tavily_key(self, monkeypatch):
        """Returns 'duckduckgo' when TAVILY_API_KEY is None."""
        monkeypatch.setattr(config, "TAVILY_API_KEY", None)
        assert get_search_provider() == "duckduckgo"

    def test_empty_string_tavily_key(self, monkeypatch):
        """Returns 'duckduckgo' when TAVILY_API_KEY is empty string (falsy)."""
        monkeypatch.setattr(config, "TAVILY_API_KEY", "")
        assert get_search_provider() == "duckduckgo"
