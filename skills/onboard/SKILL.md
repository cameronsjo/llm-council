---
name: llm-council
description: "Get started with LLM Council -- what it is, how to set it up, and how to use it"
---


Guide the user through getting started with **LLM Council**.

## About

LLM Council is a collaborative LLM deliberation system that queries multiple LLMs via OpenRouter, has them anonymously peer-review each other's responses, and synthesizes a final answer. It supports two modes: Council Mode (3-stage deliberation with peer ranking) and Arena Mode (multi-round structured debates). Fork of karpathy/llm-council with significant extensions.

## Prerequisites

Check that the user has the following installed/configured:

- Python 3.10+ (`python3 --version`)
- Node.js 18+ (`node --version`)
- [uv](https://docs.astral.sh/uv/) for Python dependency management (`uv --version`)
- An [OpenRouter API key](https://openrouter.ai/) (required)
- Optionally: a [Tavily API key](https://tavily.com/) for web search
- Optionally: Docker and Docker Compose for containerized deployment

## Setup

Walk the user through initial setup:

1. Install all dependencies:

   ```bash
   make install
   ```

   This runs `uv sync` for the Python backend and `npm install` in `frontend/`.

2. Copy the environment template and configure it:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set `OPENROUTER_API_KEY` to your OpenRouter key. Optionally set `TAVILY_API_KEY` for web search.

3. Run `make help` to see all available targets.

**Docker alternative:** If the user prefers Docker, they can run `docker compose up -d` after configuring `.env`. The app will be at http://localhost:3000.

## First Use

Guide the user through their first interaction with the product:

1. Start the dev servers:

   ```bash
   make dev
   ```

   This launches the backend on `:8001` and the frontend on `:5173` in parallel.

2. Open http://localhost:5173 in a browser.

3. Type a question and hit Enter. The Council will:
   - **Stage 1**: Query all configured models in parallel
   - **Stage 2**: Have each model anonymously rank the others
   - **Stage 3**: Synthesize a final answer via the Chairman model

4. Switch to Arena Mode via the UI toggle for multi-round debates instead.

## Key Files

Point the user to the most important files for understanding the project:

- `backend/config.py` -- Model configuration, environment variables, defaults
- `backend/council.py` -- Core 3-stage deliberation logic (the heart of the app)
- `backend/arena.py` -- Arena Mode debate orchestration
- `backend/main.py` -- FastAPI app, SSE streaming endpoints, CORS config
- `frontend/src/App.jsx` -- Main React orchestration component
- `Makefile` -- All build/run/lint targets (`make help` to list)
- `.env.example` -- All supported environment variables

## Common Tasks

- **Run in development**: `make dev` (starts backend + frontend in parallel)
- **Build for production**: `make build` (builds frontend static assets)
- **Run with Docker**: `make docker` (builds and runs via Docker Compose)
- **Run linters**: `make lint` (ruff for Python, eslint for frontend)
- **Fix lint issues**: `make lint-fix`
- **Run the TUI client**: `make tui` (terminal UI alternative to the web frontend)
