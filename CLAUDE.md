# CLAUDE.md - Technical Notes for LLM Council

This file contains technical details, architectural decisions, and important implementation notes for future development sessions.

## Project Overview

LLM Council is a collaborative LLM deliberation system with two modes:

1. **Council Mode**: 3-stage deliberation where multiple LLMs answer questions, anonymously peer-review each other, and a Chairman synthesizes the final response.

2. **Arena Mode**: Multi-round structured debates with opening statements, rebuttals, closing arguments, and synthesis.

The key innovation is anonymized peer review, preventing models from playing favorites.

> **Fork Note**: This is a fork of [karpathy/llm-council](https://github.com/karpathy/llm-council) with significant extensions (~60% new/rewritten code). See README.md for full attribution.

## Architecture

### Backend Structure (`backend/`)

**`config.py`**
- `COUNCIL_MODELS` and `CHAIRMAN_MODEL` (defaults, can be overridden via API)
- `DATA_BASE_DIR`: Configurable via `LLMCOUNCIL_DATA_DIR` env var
- `TAVILY_API_KEY`: Optional web search
- Backend runs on **port 8001** (NOT 8000 - user had another app on 8000)

**`auth.py`** - Authentication Module
- `AUTH_ENABLED`: Controlled by `LLMCOUNCIL_AUTH_ENABLED` env var
- `TRUSTED_PROXY_IPS`: CIDR-aware IP validation for reverse proxy trust
- `User` dataclass: username, email, groups, display_name
- `get_current_user()`: Extracts user from `Remote-User`, `Remote-Email`, etc. headers
- `get_optional_user()`: FastAPI dependency for optional auth
- Used for per-user conversation isolation

**`arena.py`** - Arena Mode Logic
- `ArenaDebate` class: Orchestrates multi-round debates
- `run_debate()`: Executes opening → rebuttals → closing → synthesis
- `_run_opening_round()`: Parallel initial statements
- `_run_rebuttal_round()`: Each model responds to others
- `_run_closing_round()`: Final arguments
- `_run_synthesis()`: Chairman summarizes with participant mapping
- Anonymization: Models see "Participant A, B, C" during debate

**`models.py`** - Dynamic Model Discovery
- `get_available_models()`: Fetches model list from OpenRouter API
- `filter_supported_models()`: Excludes vision-only, deprecated models
- `group_models_by_provider()`: Groups for UI display
- Caches model list to reduce API calls

**`openrouter.py`**
- `query_model()`: Single async model query
- `query_models_parallel()`: Parallel queries using `asyncio.gather()`
- Returns dict with 'content' and optional 'reasoning_details'
- Graceful degradation: returns None on failure, continues with successful responses

**`council.py`** - The Core Logic
- `stage1_collect_responses()`: Parallel queries to all council models
- `stage2_collect_rankings()`:
  - Anonymizes responses as "Response A, B, C, etc."
  - Creates `label_to_model` mapping for de-anonymization
  - Prompts models to evaluate and rank (with strict format requirements)
  - Returns tuple: (rankings_list, label_to_model_dict)
  - Each ranking includes both raw text and `parsed_ranking` list
- `stage3_synthesize_final()`: Chairman synthesizes from all responses + rankings
- `parse_ranking_from_text()`: Extracts "FINAL RANKING:" section, handles both numbered lists and plain format
- `calculate_aggregate_rankings()`: Computes average rank position across all peer evaluations

**`storage.py`**
- JSON-based conversation storage
- All functions accept optional `user_id` parameter for per-user isolation
- Without auth: `data/conversations/`
- With auth: `data/users/{username}/conversations/`
- Each conversation: `{id, created_at, title, messages[]}`
- Assistant messages contain mode-specific data (council or arena)

**`main.py`**
- FastAPI app with CORS enabled for localhost:5173 and localhost:3000
- SSE streaming for real-time response updates
- Key endpoints:
  - `GET /api/config`: Returns available features, models, arena config
  - `GET /api/user`: Returns current user info (when auth enabled)
  - `GET /api/models`: Dynamic model list from OpenRouter
  - `POST /api/conversations/{id}/message`: Streaming council/arena response
- All conversation endpoints use `Depends(get_optional_user)` for user isolation

### Frontend Structure (`frontend/src/`)

**`App.jsx`**
- Main orchestration: manages conversations list and current conversation
- Handles message sending and metadata storage
- Important: metadata is stored in the UI state for display but not persisted to backend JSON

**`components/ChatInterface.jsx`**
- Multiline textarea (3 rows, resizable)
- Enter to send, Shift+Enter for new line
- User messages wrapped in markdown-content class for padding

**`components/Stage1.jsx`**
- Tab view of individual model responses
- ReactMarkdown rendering with markdown-content wrapper

**`components/Stage2.jsx`**
- **Critical Feature**: Tab view showing RAW evaluation text from each model
- De-anonymization happens CLIENT-SIDE for display (models receive anonymous labels)
- Shows "Extracted Ranking" below each evaluation so users can validate parsing
- Aggregate rankings shown with average position and vote count
- Explanatory text clarifies that boldface model names are for readability only

**`components/Stage3.jsx`**
- Final synthesized answer from chairman
- Green-tinted background (#f0fff0) to highlight conclusion

**`components/ArenaMode.jsx`**
- Container for Arena debate display
- Orchestrates ArenaRound and ArenaSynthesis components
- Handles mode toggle between Council and Arena

**`components/ArenaRound.jsx`**
- Displays individual debate rounds (opening, rebuttal, closing)
- Participant responses in expandable sections
- Round type indicators and styling

**`components/ArenaSynthesis.jsx`**
- Chairman's synthesis with participant de-anonymization
- Displays participant mapping (A→model, B→model, etc.)

**`components/ModelSelector.jsx`**
- Full-featured model picker modal
- Search, provider grouping, multi-select
- Separate council member and chairman selection

**`components/MetricsDisplay.jsx`**
- Token usage and latency display
- Per-model and aggregate statistics

**Styling (`*.css`)**
- Light mode theme (not dark mode)
- Primary color: #4a90e2 (blue)
- Global markdown styling in `index.css` with `.markdown-content` class
- 12px padding on all markdown content to prevent cluttered appearance

## Key Design Decisions

### Stage 2 Prompt Format
The Stage 2 prompt is very specific to ensure parseable output:
```
1. Evaluate each response individually first
2. Provide "FINAL RANKING:" header
3. Numbered list format: "1. Response C", "2. Response A", etc.
4. No additional text after ranking section
```

This strict format allows reliable parsing while still getting thoughtful evaluations.

### De-anonymization Strategy
- Models receive: "Response A", "Response B", etc.
- Backend creates mapping: `{"Response A": "openai/gpt-5.1", ...}`
- Frontend displays model names in **bold** for readability
- Users see explanation that original evaluation used anonymous labels
- This prevents bias while maintaining transparency

### Error Handling Philosophy
- Continue with successful responses if some models fail (graceful degradation)
- Never fail the entire request due to single model failure
- Log errors but don't expose to user unless all models fail

### UI/UX Transparency
- All raw outputs are inspectable via tabs
- Parsed rankings shown below raw text for validation
- Users can verify system's interpretation of model outputs
- This builds trust and allows debugging of edge cases

## Important Implementation Details

### Relative Imports
All backend modules use relative imports (e.g., `from .config import ...`) not absolute imports. This is critical for Python's module system to work correctly when running as `python -m backend.main`.

### Port Configuration
- Backend: 8001 (changed from 8000 to avoid conflict)
- Frontend: 5173 (Vite default)
- Update both `backend/main.py` and `frontend/src/api.js` if changing

### Markdown Rendering
All ReactMarkdown components must be wrapped in `<div className="markdown-content">` for proper spacing. This class is defined globally in `index.css`.

### Model Configuration
Models are hardcoded in `backend/config.py`. Chairman can be same or different from council members. The current default is Gemini as chairman per user preference.

## Common Gotchas

1. **Module Import Errors**: Always run backend as `python -m backend.main` from project root, not from backend directory
2. **CORS Issues**: Frontend must match allowed origins in `main.py` CORS middleware
3. **Ranking Parse Failures**: If models don't follow format, fallback regex extracts any "Response X" patterns in order
4. **Missing Metadata**: Metadata is ephemeral (not persisted), only available in API responses

## Web Search Feature

The web search feature allows models to access current information from the web via the Tavily API.

**Backend Implementation:**
- `backend/websearch.py`: Tavily API client with `search_web()` and `format_search_results()` functions
- `backend/config.py`: `TAVILY_API_KEY` loaded from environment
- `backend/council.py`: `perform_web_search()` function, integrated into Stage 1
- `backend/main.py`: `/api/config` endpoint to check feature availability

**Frontend Implementation:**
- `api.js`: `getConfig()` function, updated `sendMessageStream()` signature
- `App.jsx`: `webSearchAvailable` and `useWebSearch` state management
- `ChatInterface.jsx`: Web search toggle checkbox and status indicators

**Data Flow:**
1. Frontend fetches `/api/config` on load to check if web search is available
2. User toggles web search checkbox (only visible if TAVILY_API_KEY is set)
3. On message send, `use_web_search` flag is passed to backend
4. Backend performs Tavily search before Stage 1
5. Search results are prepended to the user query as context
6. Models receive both search context and original question

## Docker Deployment

**Files:**
- `Dockerfile`: Single multi-stage build (Python + Node → unified image)
- `docker-compose.yml`: Single-container deployment
- `.dockerignore`: Excludes unnecessary files from builds

**Single Container Design:**
- FastAPI serves both API and static frontend
- Port 3000 exposed
- Volumes for persistent data (`/app/data`)

**Environment Variables:**
- `OPENROUTER_API_KEY`: Required for LLM queries
- `TAVILY_API_KEY`: Optional for web search
- `LLMCOUNCIL_DATA_DIR`: Data directory (default: `/app/data`)
- `LLMCOUNCIL_AUTH_ENABLED`: Enable reverse proxy auth
- `LLMCOUNCIL_TRUSTED_PROXY_IPS`: Trusted proxy IPs for auth headers
- `SENTRY_DSN`: Optional Sentry DSN for error monitoring (no-op when empty)
- `SENTRY_ENVIRONMENT`: Sentry environment tag (default: `development` local, `production` in Docker)
- `SENTRY_TRACES_SAMPLE_RATE`: Sentry performance tracing sample rate (default: `0.1`)
- `SENTRY_PROFILES_SAMPLE_RATE`: Sentry profiling sample rate (default: `0.1`)

### Graceful Shutdown

SSE streams can last 30-60+ seconds during model calls. The shutdown strategy has three layers:

**Layer 1 (implemented):** Grace period + drain
- `stop_grace_period: 120s` in docker-compose — Docker waits 2 min after SIGTERM before SIGKILL
- `timeout_graceful_shutdown=90` on uvicorn — drains in-flight requests for up to 90s
- Covers most chairman model calls without any client-side awareness

**Layer 2 (implemented):** Shutdown coordinator + `server_shutdown` SSE event
- `backend/shutdown.py`: `ShutdownCoordinator` tracks active SSE streams
- On lifespan shutdown, sets a flag; generators check between yields
- Emits `{"type": "server_shutdown", "message": "..."}` so frontend can react cleanly
- Frontend `useConversationStream` handles via `onServerShutdown` callback
- App.jsx reloads the conversation to pick up any partial data that was saved

**Layer 3 (not implemented — infra):** Blue-green / rolling deployment
- Traefik can route to new container only after health check passes
- Old container drains until all streams complete, then terminates
- Requires separate container instances (not in-place `docker compose up -d` recreate)
- Docker Compose doesn't natively support blue-green; would need:
  - Traefik dynamic config with weighted routing, or
  - A deploy orchestrator (k8s, Nomad, Bosun with custom drain logic)
- For reference: Traefik's `traefik.http.services.*.loadbalancer.server.scheme` + health checks can do this with two service definitions

## Authentication

**Reverse Proxy Auth Pattern:**
- Backend trusts headers from configured proxy IPs only
- Headers: `Remote-User`, `Remote-Email`, `Remote-Name`, `Remote-Groups`
- Compatible with: Authelia, OAuth2 Proxy, Authentik, etc.

**Per-User Isolation:**
When auth is enabled, each user's conversations are stored separately:
```
data/users/{username}/conversations/
```

See `docs/auth-setup.md` for detailed configuration.

## Future Enhancement Ideas

- Export conversations to markdown/PDF
- Model performance analytics over time
- Custom ranking criteria (not just accuracy/insight)
- Support for reasoning models (o1, etc.) with special handling
- Conversation sharing between users
- Admin dashboard for usage monitoring

## Testing Notes

Use `test_openrouter.py` to verify API connectivity and test different model identifiers before adding to council. The script tests both streaming and non-streaming modes.

## Data Flow Summary

### Council Mode
```
User Query
    ↓
Stage 1: Parallel queries → [individual responses]
    ↓
Stage 2: Anonymize → Parallel ranking queries → [evaluations + parsed rankings]
    ↓
Aggregate Rankings Calculation → [sorted by avg position]
    ↓
Stage 3: Chairman synthesis with full context
    ↓
Return: {stage1, stage2, stage3, metadata}
    ↓
Frontend: Display with tabs + validation UI
```

### Arena Mode
```
User Query
    ↓
Opening Round: Parallel initial statements (anonymized as Participant A, B, C)
    ↓
Rebuttal Rounds (configurable count): Each model responds to others
    ↓
Closing Round: Final arguments from each participant
    ↓
Synthesis: Chairman summarizes with participant de-anonymization
    ↓
Return: {rounds[], synthesis, participant_mapping}
    ↓
Frontend: Expandable round display + synthesis with mapping
```

Both flows use SSE streaming for real-time updates and async/parallel execution where possible.
