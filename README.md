# LLM Council

![llmcouncil](header.jpg)

> **Fork Attribution**: This project is a fork of [karpathy/llm-council](https://github.com/karpathy/llm-council), originally created by Andrej Karpathy as a weekend hack for exploring LLM collaboration. This fork extends the original with Arena Mode, authentication, Docker deployment, and other features.

## Overview

Instead of asking a question to a single LLM, group them into your "LLM Council". This web app uses OpenRouter to send your query to multiple LLMs, has them review and rank each other's work anonymously, and produces a synthesized final response.

### Council Mode (Original)

1. **Stage 1: First Opinions** - Query sent to all LLMs individually, responses shown in tabs
2. **Stage 2: Peer Review** - Each LLM reviews and ranks others' responses (anonymized to prevent bias)
3. **Stage 3: Synthesis** - Chairman LLM compiles all responses into a final answer

### Arena Mode (New)

Multi-round structured debates between LLMs with:
- **Opening statements** from each participant
- **Rebuttal rounds** where models respond to each other
- **Closing arguments** summarizing positions
- **Synthesis** by the Chairman with participant de-anonymization

## What's New in This Fork

This fork significantly extends the original project (~60% new/rewritten code):

| Feature | Description |
|---------|-------------|
| **Arena Mode** | Multi-round debate format with opening/rebuttal/closing rounds |
| **Web Search** | Tavily API integration for current information |
| **Authentication** | Reverse proxy auth support (Authelia, OAuth2 Proxy) |
| **Per-User Isolation** | Separate conversation storage when auth is enabled |
| **Docker Deployment** | Single-container deployment with docker-compose |
| **Model Selector UI** | Dynamic model configuration with search and grouping |
| **Metrics Display** | Token usage and latency tracking |
| **Streaming Responses** | Real-time SSE updates during deliberation |
| **Configurable Data Dir** | `LLMCOUNCIL_DATA_DIR` environment variable |

## Quick Start

### Docker (Recommended)

Pull the pre-built image from GitHub Container Registry:

```bash
# Pull and run
docker pull ghcr.io/cameronsjo/llm-council:latest
docker run -d -p 3000:8001 \
  -e OPENROUTER_API_KEY=your-key-here \
  -v llm-council-data:/app/data \
  ghcr.io/cameronsjo/llm-council:latest
```

Or use docker-compose:

```bash
git clone https://github.com/cameronsjo/llm-council.git
cd llm-council
cp .env.example .env
# Edit .env with your OPENROUTER_API_KEY

docker compose up -d
```

Open http://localhost:3000

#### Verify Image Signatures

Images are signed with [Cosign](https://github.com/sigstore/cosign) and include SLSA build provenance:

```bash
# Verify signature (requires cosign)
cosign verify ghcr.io/cameronsjo/llm-council:latest \
  --certificate-identity-regexp="github.com/cameronsjo/llm-council" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"

# Verify provenance (requires gh CLI)
gh attestation verify oci://ghcr.io/cameronsjo/llm-council:latest --owner cameronsjo
```

### Manual Setup

**Prerequisites**: Python 3.10+, Node.js 18+, [uv](https://docs.astral.sh/uv/)

```bash
# Backend
uv sync

# Frontend
cd frontend && npm install && cd ..

# Configure
cp .env.example .env
# Edit .env with your OPENROUTER_API_KEY

# Run (two terminals)
uv run python -m backend.main     # Terminal 1
cd frontend && npm run dev        # Terminal 2
```

Open http://localhost:5173

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key |
| `TAVILY_API_KEY` | No | Tavily API key for web search |
| `LLMCOUNCIL_DATA_DIR` | No | Data directory (default: `data`) |
| `LLMCOUNCIL_AUTH_ENABLED` | No | Enable reverse proxy auth |
| `LLMCOUNCIL_TRUSTED_PROXY_IPS` | No | Trusted proxy IPs for auth headers |

See [`.env.example`](.env.example) for all options.

### Model Configuration

Models can be configured via the UI (gear icon in sidebar) or by editing `backend/config.py`:

```python
COUNCIL_MODELS = [
    "openai/gpt-4o",
    "anthropic/claude-sonnet-4",
    "google/gemini-2.0-flash",
]

CHAIRMAN_MODEL = "google/gemini-2.0-flash"
```

## Optional Features

### Web Search

Give the Council access to current web information:

1. Get a free API key from [Tavily](https://tavily.com/)
2. Add `TAVILY_API_KEY=tvly-...` to `.env`
3. Toggle "Web Search" when asking a question

### Authentication

For multi-user deployments behind a reverse proxy (Authelia, OAuth2 Proxy, etc.):

```yaml
# docker-compose.yml
environment:
  - LLMCOUNCIL_AUTH_ENABLED=true
  - LLMCOUNCIL_TRUSTED_PROXY_IPS=172.16.0.0/12
```

See [docs/auth-setup.md](docs/auth-setup.md) for detailed configuration.

## Tech Stack

- **Backend**: FastAPI, Python 3.12, async httpx, OpenRouter API
- **Frontend**: React 18, Vite, react-markdown
- **Storage**: JSON files (conversation persistence)
- **Registry**: [ghcr.io/cameronsjo/llm-council](https://ghcr.io/cameronsjo/llm-council) (signed with Cosign + SLSA provenance)
- **Deployment**: Docker, nginx (optional reverse proxy)

### Why GHCR over Docker Hub?

| Feature | GHCR | Docker Hub |
|---------|------|------------|
| **Integration** | Native GitHub (same auth, linked to repos) | Separate account/auth |
| **Rate Limits** | Generous (tied to GitHub plan) | 100 pulls/6hrs anonymous |
| **Signing** | Native Cosign + GitHub attestations | Requires separate setup |
| **Cost** | Free for public repos | Free tier with limits |
| **Default** | Requires explicit registry prefix | Default registry (implicit) |

Docker Hub remains the home for official images and has broader reach, but GHCR provides tighter CI/CD integration for GitHub-hosted projects.

## License

This fork is released under the [MIT License](LICENSE).

**Note**: The original [karpathy/llm-council](https://github.com/karpathy/llm-council) was published without a license file. This fork adds MIT licensing for the new code and modifications. If you're concerned about licensing, please refer to the original repository or contact the original author.

## Acknowledgments

- [Andrej Karpathy](https://github.com/karpathy) for the original LLM Council concept and implementation
- [OpenRouter](https://openrouter.ai/) for unified LLM API access
- [Tavily](https://tavily.com/) for web search capabilities
