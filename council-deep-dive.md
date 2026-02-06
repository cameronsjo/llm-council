# Council Feature Deep Dive

**Purpose**: End-to-end analysis of the Council feature for maintainability and testability.
**Date**: 2026-02-05
**Status**: Complete (64 beads, 69 graded entries across 34 files)
**Coverage**: Backend (council, openrouter, main, config, storage, models, websearch, telemetry, deliberation, auth, export, attachments, logging_config, version) + Frontend (App, api, ChatInterface, Round, Synthesis, MetricsDisplay, ModelSelector, ModelCuration, Sidebar, SkeletonLoader, VersionInfo, ConversationItem, CouncilDisplay, ModelSearchBox, FilterChips, ModelGroups, 5 hooks, lib/models)

> **ROOT CAUSE FOUND**: `query_models_progressive()` in `openrouter.py` has a confirmed bug.
> `asyncio.as_completed()` returns coroutines, NOT the original Task objects.
> The `task_to_model[completed_task]` lookup at line 351 will ALWAYS KeyError.
> Confirmed on Python 3.14.2. See [P0 — Things That Are Broken](#p0--things-that-are-broken) below.

---

## Table of Contents

1. [Execution Path Overview](#execution-path-overview)
2. [Layer 1: Frontend Entry Point](#layer-1-frontend-entry-point)
3. [Layer 2: API Client](#layer-2-api-client)
4. [Layer 3: FastAPI Endpoint](#layer-3-fastapi-endpoint)
5. [Layer 4: Council Orchestration](#layer-4-council-orchestration)
6. [Layer 5: OpenRouter Client](#layer-5-openrouter-client)
7. [Layer 6: Data Models](#layer-6-data-models)
8. [Layer 7: Storage](#layer-7-storage)
9. [Layer 8: Configuration](#layer-8-configuration)
10. [Supporting Layers](#supporting-layers)
11. [Layer 9: Frontend Rendering](#layer-9-frontend-rendering)
12. [Layer 10: Frontend Configuration UI](#layer-10-frontend-configuration-ui)
13. [Layer 11: Frontend Hooks & Libraries](#layer-11-frontend-hooks--libraries)
14. [Layer 12: Frontend Sub-components](#layer-12-frontend-sub-components)
15. [Layer 13: Backend Auth, Export, Attachments](#layer-13-backend-auth-export-attachments)
16. [Layer 14: Backend Infrastructure](#layer-14-backend-infrastructure)
17. [Function Inventory & Grades](#function-inventory--grades)
18. [Critical Issues Summary](#critical-issues-summary)
19. [Recommendations](#recommendations)

---

## Execution Path Overview

```
User types question in ChatInterface
        │
        ▼
App.jsx::handleSendMessage(content)
        │
        ├─ Optimistically adds user + assistant skeleton to UI state
        │
        ▼
api.js::sendMessageStream(conversationId, content, ...)
        │
        ├─ POST /api/conversations/{id}/message/stream
        ├─ Reads SSE events via ReadableStream
        │
        ▼
main.py::send_message_stream()
        │
        ├─ storage.get_conversation()         ← Validates conversation exists
        ├─ storage.add_user_message()          ← Persists user message
        ├─ storage.mark_response_pending()     ← Marks in-progress
        │
        ├─ [Optional] perform_web_search()     ← Tavily/DuckDuckGo
        │
        ├─ SSE: stage1_start
        ├─ council.stage1_collect_responses_streaming()
        │       │
        │       ├─ openrouter.query_models_progressive()
        │       │       │
        │       │       ├─ For each model (parallel):
        │       │       │   └─ openrouter.query_model_streaming()
        │       │       │       └─ POST https://openrouter.ai/api/v1/chat/completions (stream=true)
        │       │       │
        │       │       ├─ SSE: stage1_token (per token per model)
        │       │       ├─ SSE: stage1_model_response (per model completion)
        │       │       └─ SSE: stage1_progress (per model completion)
        │       │
        │       └─ Returns: list[dict] with model, response, metrics
        │
        ├─ SSE: stage1_complete
        ├─ storage.update_pending_progress(stage1)
        │
        ├─ [Parallel] council.generate_conversation_title() (first message only)
        │
        ├─ SSE: stage2_start
        ├─ council.stage2_collect_rankings()
        │       │
        │       ├─ Anonymizes responses → "Response A", "Response B", ...
        │       ├─ Creates label_to_model mapping
        │       ├─ Builds ranking prompt with evaluation criteria
        │       │
        │       ├─ openrouter.query_models_parallel()
        │       │       └─ For each model: openrouter.query_model()
        │       │
        │       ├─ parse_ranking_from_text() per response
        │       └─ Returns: (rankings_list, label_to_model)
        │
        ├─ council.calculate_aggregate_rankings()
        ├─ SSE: stage2_complete + metadata
        ├─ storage.update_pending_progress(stage1+stage2)
        │
        ├─ SSE: stage3_start
        ├─ council.stage3_synthesize_final()
        │       │
        │       ├─ Builds chairman prompt with all context
        │       ├─ openrouter.query_model(chairman)
        │       └─ Returns: dict with model, response, metrics
        │
        ├─ SSE: stage3_complete
        │
        ├─ council.aggregate_metrics(stage1, stage2, stage3)
        ├─ SSE: metrics_complete
        │
        ├─ [Await] title generation → SSE: title_complete
        │
        ├─ council.convert_to_unified_result()
        ├─ storage.add_unified_message()
        ├─ storage.clear_pending()
        │
        └─ SSE: complete
```

---

## Layer 1: Frontend Entry Point

### File: `frontend/src/App.jsx`

#### `handleSendMessage(content, attachments = [], resume = false)`

**Location**: App.jsx:430-728

**Responsibilities**:
1. Sets `isLoading = true`
2. Optimistically adds user message to conversation state
3. Creates a partial assistant message skeleton (with loading flags)
4. Calls `api.sendMessageStream()` with SSE callback
5. SSE callback handles ~15 different event types to update UI state
6. On error, rolls back optimistic messages (removes last 2)

**Issues**:
- **MASSIVE function** — 300 lines with a giant switch statement inside a callback inside a function. This is the single biggest maintainability problem in the codebase
- The SSE callback mutates the last message object directly (`lastMsg.stage1 = event.data`). This is **NOT immutable** — React may not detect these changes reliably
- Error handling removes last 2 messages blindly — what if the optimistic add failed partially?
- The `resume` parameter path is complex and interleaved with normal flow
- No AbortController for cancellation — if user navigates away, the stream keeps running

---

## Layer 2: API Client

### File: `frontend/src/api.js`

#### `sendMessageStream(conversationId, content, useWebSearch, mode, arenaConfig, attachments, onEvent, resume, priorContext)`

**Location**: api.js:315-382

**Responsibilities**:
1. Constructs request body
2. POSTs to `/api/conversations/{id}/message/stream`
3. Reads response body as ReadableStream
4. Parses SSE `data:` lines and calls `onEvent` callback

**Issues**:
- **SSE parsing is fragile**: Splits on `\n` but SSE events can span multiple chunks. If a JSON payload is split across two `reader.read()` calls, the parse will fail silently (catches error and moves on)
- No AbortController support — cannot cancel the stream
- No reconnection logic
- No timeout handling — if the backend hangs, the client waits forever
- 9 parameters is too many — should be an options object

#### `sendMessage(conversationId, content, useWebSearch)` (non-streaming)

**Location**: api.js:285-300

**Issues**:
- This is the **legacy non-streaming endpoint** — still called from nowhere in current code but still exported. Dead code candidate

---

## Layer 3: FastAPI Endpoint

### File: `backend/main.py`

#### `send_message_stream(conversation_id, request, user)`

**Location**: main.py:562-958

**Responsibilities**:
1. Validates conversation exists
2. Delegates to `council_event_generator()` or `arena_event_generator()`
3. Returns `StreamingResponse` with SSE

#### `council_event_generator()` (nested async generator)

**Location**: main.py:582-803

**Responsibilities**:
1. Gets per-conversation config (or global fallback)
2. Handles resume mode (skips Stage 1 if partial data exists)
3. Processes attachments and web search
4. Runs Stage 1 streaming with queue-based event bridge
5. Runs Stage 2 (rankings)
6. Runs Stage 3 (synthesis)
7. Calculates metrics
8. Converts to unified format and saves
9. Clears pending state

**Issues**:
- **200+ line nested async generator** — extremely hard to test independently
- The `event_queue` bridge pattern (lines 654-713) is complex: Stage 1 runs as a task, pushes events to a queue, the generator pulls from the queue. This is correct but intricate and untestable in isolation
- Exception handling wraps the ENTIRE generator in one try/except — any error at any stage produces the same generic error event
- **Config not passed to stages correctly**: `council_event_generator` reads `council_models` and `chairman_model` from storage, but passes `council_models` to stage1 and stage2. However, `stage1_collect_responses_streaming` receives these, but `combined_context` building uses `request.content` directly — if web search context exists, it's prepended, but the **actual query text sent to Stage 2 and Stage 3 is still `request.content`** (the raw user input, not the enriched version). This means web search context is ONLY used in Stage 1, not in the ranking or synthesis prompts
- The `can_resume` check accesses nested dict without safe navigation — could crash on malformed pending data

#### `send_message(conversation_id, request, user)` (non-streaming)

**Location**: main.py:510-559

**Issues**:
- **Does NOT use per-conversation config**: Line 539 calls `run_full_council(request.content, use_web_search=request.use_web_search)` without passing `council_models` or `chairman_model` — it uses global defaults only
- Still uses legacy `add_assistant_message()` storage format instead of unified
- Dead endpoint? The frontend only uses the streaming version

---

## Layer 4: Council Orchestration

### File: `backend/council.py`

#### `stage1_collect_responses(user_query, web_search_context, council_models)`

**Location**: council.py:29-109

**Responsibilities**:
1. Gets effective council models
2. Builds system prompt + user prompt (with optional web search context)
3. Calls `query_models_parallel()`
4. Filters out None responses
5. Returns list of result dicts

**Issues**:
- System prompt is a hardcoded string literal — can't be configured or tested in isolation
- The **same system prompt** is duplicated verbatim in `stage1_collect_responses_streaming` (lines 152-162) — DRY violation
- No validation that `effective_council` is non-empty before querying
- Silently drops failed models — no logging of which models failed or why

#### `stage1_collect_responses_streaming(...)`

**Location**: council.py:112-216

**Issues**:
- **Near-complete duplication of `stage1_collect_responses`** — system prompt, message construction, result formatting are all copied. Only difference is using `query_models_progressive` instead of `query_models_parallel`
- `handle_model_complete` is a closure that appends to `stage1_results` — concurrent modification of a list from multiple async tasks could be a race condition (though in practice `query_models_progressive` awaits each completion serially via `as_completed`)
- The callback `on_model_response` is awaited inside the completion handler — if this callback is slow (e.g., serializing and sending SSE), it blocks the next model's completion notification

#### `stage2_collect_rankings(user_query, stage1_results, council_models)`

**Location**: council.py:219-326

**Responsibilities**:
1. Creates anonymous labels (A, B, C...)
2. Builds label_to_model mapping
3. Constructs ranking prompt
4. Queries all models in parallel
5. Parses rankings from each response
6. Returns (results, label_to_model)

**Issues**:
- The ranking prompt is a ~40 line string literal — untestable and unmaintainable
- Uses `query_models_parallel` (not streaming) — no progressive feedback during Stage 2
- **Labels break at 26 models** — `chr(65 + i)` only works for A-Z. With more than 26 council members this produces `[`, `\`, etc.
- No system message — the ranking prompt is sent as a bare user message
- If ALL models fail in stage 2, returns empty results with no error signal

#### `stage3_synthesize_final(user_query, stage1_results, stage2_results, chairman_model)`

**Location**: council.py:329-425

**Responsibilities**:
1. Builds chairman prompt with ALL stage 1 responses + stage 2 rankings
2. Queries the chairman model
3. Returns result dict

**Issues**:
- Chairman prompt is another massive string literal (~30 lines)
- **Reveals model names to chairman**: Line 361 `f"Model: {result['model']}"` — the chairman sees which model said what, which breaks the anonymization philosophy. Stage 2 uses anonymous labels, but Stage 3 reveals everything
- Fallback message on chairman failure is a generic string — no partial data recovery
- No retry logic for the single most important API call in the whole pipeline

#### `parse_ranking_from_text(ranking_text)`

**Location**: council.py:428-459

**Responsibilities**:
1. Looks for "FINAL RANKING:" section
2. Extracts numbered "Response X" patterns
3. Falls back to any "Response X" patterns in the full text

**Issues**:
- `import re` inside the function body — should be module-level
- **Regex is fragile**: Only matches single uppercase letter `[A-Z]`. "Response AA" would not match
- Fallback extracts ALL "Response X" mentions from the full text — if the model mentions "Response A" in its analysis before the ranking, that gets picked up as part of the ranking
- No validation that the parsed ranking contains the expected number of entries
- No deduplication — same response could appear multiple times

#### `aggregate_metrics(stage1_results, stage2_results, stage3_result)`

**Location**: council.py:462-559

**Responsibilities**:
1. Sums costs, tokens across all stages
2. Takes max latency for parallel stages (correct)
3. Adds sequential latency for stages 2 and 3
4. Rounds costs for display

**Issues**:
- Handles None/missing metrics defensively with `or 0.0` — good
- `total_latency_ms` logic: takes max of Stage 1 (parallel), then ADDS Stage 2 max and Stage 3 — this is correct for sequential execution, but doesn't account for the title generation task running in parallel
- No type safety — all dict access is string-keyed with no schema validation

#### `calculate_aggregate_rankings(stage2_results, label_to_model)`

**Location**: council.py:562-606

**Responsibilities**:
1. Re-parses rankings from raw text (calls `parse_ranking_from_text` again!)
2. Tracks positions for each model
3. Calculates average rank
4. Sorts by average rank

**Issues**:
- **Double parsing**: Stage 2 already parsed the ranking and stored it as `parsed_ranking`, but this function ignores that and re-parses from raw text. If parsing is non-deterministic, this could produce different results
- Uses `defaultdict(list)` imported inside function body
- No handling for models that got zero rankings (not mentioned by any evaluator)

#### `generate_conversation_title(user_query)`

**Location**: council.py:609-644

**Issues**:
- **Hardcoded model**: Uses `"google/gemini-2.5-flash"` — not configurable
- 30 second timeout is sensible
- Clean fallback to "New Conversation"

#### `perform_web_search(query)`

**Location**: council.py:647-667

**Issues**:
- Simple delegation wrapper — fine
- Returns tuple (result, error) — good pattern

#### `run_full_council(user_query, use_web_search, council_models, chairman_model)`

**Location**: council.py:670-734

**Issues**:
- **Only used by the non-streaming endpoint** — the streaming endpoint calls each stage directly
- Two completely separate code paths for the same logical operation is a major maintenance burden

#### `convert_to_unified_result(...)`

**Location**: council.py:737-819

**Issues**:
- Pure data transformation — testable
- Correctly maps stages to rounds
- Good bridge function

#### `convert_legacy_message_to_unified(message)`

**Location**: council.py:822-875

**Issues**:
- Handles backwards compatibility for old message format
- Re-calculates aggregate rankings from stored data — could fail if stored data is incomplete
- Mutates and returns the input dict — copies "extra" fields in a loop

---

## Layer 5: OpenRouter Client

### File: `backend/openrouter.py`

#### `query_model(model, messages, timeout)`

**Location**: openrouter.py:23-105

**Issues**:
- Creates a new `httpx.AsyncClient` per request — no connection pooling
- Catches ALL exceptions as one block — network errors, JSON parse errors, auth errors all look the same
- `logger.warning` for errors — should be `logger.error` for 500s and `logger.warning` for rate limits
- Cost data from OpenRouter's `usage` field may not always be present
- No retry logic for transient failures (429, 502, 503)

#### `query_models_parallel(models, messages, custom_messages)`

**Location**: openrouter.py:108-160

**Issues**:
- Uses `asyncio.gather()` — all-or-nothing completion. If one model takes 60s and others take 2s, everything waits
- No timeout at the gather level
- Double import of `asyncio` (module-level and inside function)

#### `query_model_streaming(model, messages, on_token, timeout)`

**Location**: openrouter.py:163-283

**Issues**:
- Creates a new `httpx.AsyncClient` per request — same connection pooling issue
- `reasoning_details` is always None in streaming mode — documented but not ideal
- `actual_model`, `request_id`, `provider` are all None in streaming mode — significant data loss compared to non-streaming
- Usage data may not be present in the final SSE chunk from some providers
- No handling for provider-specific SSE format differences

#### `query_models_progressive(models, messages, ...)`

**Location**: openrouter.py:286-379

**Issues**:
- Uses `asyncio.as_completed()` — good pattern for progressive results
- **Bug**: `task_to_model[completed_task]` — `as_completed` wraps tasks in new futures, so the original task object may not be the same reference. This is a **known Python asyncio issue**. In Python 3.12+, `as_completed` returns a different iterator type. This could cause KeyError crashes
- `pending_models.remove(model)` — O(n) on each completion. Minor but worth noting

---

## Layer 6: Data Models

### File: `backend/deliberation/deliberation.py`

#### Data classes: `Metrics`, `ParticipantResponse`, `Round`, `Synthesis`, `DeliberationResult`

**Issues**:
- Clean dataclass design — good
- `from_dict` / `to_dict` pattern is manual — could use Pydantic for validation
- `RoundType` is str Enum — correct for JSON serialization
- `Round.round_type` accepts both `RoundType` and `str` — loose typing
- `ParticipantResponse.from_dict` handles legacy "response" key fallback — good

---

## Layer 7: Storage

### File: `backend/storage.py`

#### `get_conversation(conversation_id, user_id, migrate_messages)`

**Location**: storage.py:129-156

**Issues**:
- **Reads JSON from disk on every call** — no caching. Every stage transition reads the full conversation from disk
- `migrate_legacy_messages` is called on EVERY read by default — unnecessary overhead
- No file locking — concurrent requests could corrupt data

#### `add_user_message(conversation_id, content, user_id)`

**Location**: storage.py:240-256

**Issues**:
- Reads entire conversation, appends message, writes entire conversation — O(n) on conversation size
- No file locking

#### `add_unified_message(conversation_id, result, user_id)`

**Location**: storage.py:373-395

**Issues**:
- Same read-modify-write pattern
- `get_conversation` with `migrate_messages=False` — correct to avoid migration overhead during writes

#### `list_conversations(user_id)`

**Location**: storage.py:206-237

**Issues**:
- **Reads EVERY conversation file** to get metadata — O(n) on number of conversations
- No pagination, no index
- For a user with 100+ conversations this becomes painfully slow

#### Pending message functions

**Location**: storage.py:430-606

**Issues**:
- All pending state in one JSON file per user — entire file read/written on every update
- `is_pending_stale` has hardcoded 10 minute timeout — not configurable per-operation
- `remove_last_user_message` reads with migration enabled (default) — unnecessary overhead

---

## Layer 8: Configuration

### File: `backend/config.py`

#### `get_council_models()` / `get_chairman_model()`

**Location**: config.py:84-103

**Issues**:
- **Reads JSON file from disk on every call** — no in-memory cache
- Called multiple times per request (once in `council_event_generator`, once per stage function that has a `council_models` default)
- `load_user_config()` does file I/O each time — adds latency to every operation

#### `reload_config()`

**Location**: config.py:159-193

**Issues**:
- Mutates module-level `OPENROUTER_API_KEY` — but `openrouter.py` imports it at module load time. If `openrouter.py` captured it as a local variable, the reload wouldn't propagate. Currently works because `openrouter.py` imports from `.config` and uses it at call time
- Manually patches `websearch.TAVILY_API_KEY` — fragile cross-module mutation

---

## Supporting Layers

### Telemetry (`backend/telemetry.py`)

- Clean no-op pattern when OTel is disabled — good
- `_NoOpTracer` / `_NoOpSpan` avoid conditional checks everywhere — good design
- `get_tracer()` creates new `_NoOpTracer()` on every call when disabled — minor allocation overhead

### Web Search (`backend/websearch.py`)

- Tavily → DuckDuckGo fallback pattern — good
- `asyncio.get_event_loop()` in `search_duckduckgo` — deprecated pattern, should use `asyncio.get_running_loop()`
- `_get_tavily_key()` reads from config module — good for hot reload

### Models (`backend/models.py`)

- In-memory cache with 1hr TTL — good
- `datetime.utcnow()` — deprecated, should use `datetime.now(timezone.utc)`
- Cache returns stale data on error — good resilience

---

## Layer 9: Frontend Rendering

These components render the council's output after each stage completes.

### File: `frontend/src/components/ChatInterface.jsx`

The main conversation view. Renders the message list and input area.

#### Helper functions at module scope:

- **`convertCouncilToRounds(assistantMsg)`**: Bridges legacy `stage1`/`stage2`/`stage3` format to the unified `rounds[]` format for rendering. Creates Round objects from each stage. Pure function but handles two format concerns.
- **`convertSynthesis(assistantMsg)`**: Extracts synthesis from either `deliberation.synthesis` (unified) or `stage3` (legacy). Pure function.
- **`getParticipantMapping(assistantMsg)`**: Extracts participant → model mapping from unified or legacy format.

#### Component internals:

- **`handleSubmit()`**: Dispatches user input. Delegates to `App.jsx::handleSendMessage`. Validates non-empty input, handles file attachments via `handleFileSelect`.
- **`handleKeyDown()`**: Enter to send, Shift+Enter for newline.
- **Streaming display**: Renders `SkeletonLoader` while loading, then `Round` components for each stage, then `Synthesis` for the final answer. Inline conversion logic (`convertCouncilToRounds`) runs on every render — not memoized.

**Issues**:
- `convertCouncilToRounds` is called inline in JSX — should be memoized with `useMemo`
- The component is a **300+ line render function** with inline conditional logic for mode switching (council vs arena), streaming progress display, file attachment UI, and web search toggles
- No error boundary — a crash in any child component (e.g., malformed markdown in `ReactMarkdown`) crashes the entire conversation view

### File: `frontend/src/components/Round.jsx`

Renders individual deliberation rounds (Stage 1 responses, Stage 2 rankings, Stage 3 content).

#### Helper functions at module scope:

- **`formatCost(cost)`**: Formats dollar amount. Returns null for zero/missing. Pure.
- **`getReasoningText(reasoningDetails)`**: Extracts reasoning from various formats (string, array of objects, single object). Handles `summary` and `content` keys. Pure.
- **`deAnonymizeText(text, labelToModel)`**: Replaces anonymous labels ("Response A") with model names using regex. Pure, well-focused.
- **`getTabLabel(response, index)`**: Gets tab label from response participant field or falls back to letter (A, B, C...).
- **`getModelName(response)`**: Extracts short model name from full model ID.
- **`getRoundCost(responses)`**: Sums costs across all responses in a round.

#### Component:

- Tab view with per-response content display
- Handles both unified format (response objects with `participant`, `model`, `content`) and legacy format (raw stage data)
- De-anonymization happens client-side: models see "Response A" but users see **bold model names** with explanation text
- Expandable reasoning section (uses Brain icon indicator)
- Copy button per response

**Issues**:
- `formatCost` and `getReasoningText` are **duplicated** in `Synthesis.jsx` — should be extracted to a shared utility
- Tab state resets when props change (no `key` management for tab persistence across re-renders)
- De-anonymization regex in `deAnonymizeText` only matches "Response [A-Z]" — same 26-model limit as backend

### File: `frontend/src/components/Synthesis.jsx`

Renders the chairman's final synthesized answer.

- **`formatCost(cost)`**: **DUPLICATE** of Round.jsx. Identical implementation.
- **`getReasoningText(reasoningDetails)`**: **DUPLICATE** of Round.jsx. Identical implementation.
- **`handleCopy()`**: Copies synthesis content to clipboard via `navigator.clipboard.writeText`.
- **`handleContinueDiscussion()`**: Forks conversation with synthesis context.

**Issues**:
- Two functions duplicated verbatim from Round.jsx — extract to shared utility
- Hardcoded `mode === 'arena'` checks — could use polymorphic rendering pattern
- Participant identity reveal section renders for arena mode only — clean conditional

### File: `frontend/src/components/MetricsDisplay.jsx`

Renders cost, token, and latency metrics.

- **`formatCost(cost)`**: Yet another copy of the cost formatter (3rd instance).
- **`formatLatency(ms)`**: Formats milliseconds to seconds with 1 decimal.
- **`formatTokens(count)`**: Formats token count with K suffix for thousands.

**Issues**:
- `formatCost` appears in THREE components (Round, Synthesis, MetricsDisplay) — critical DRY violation
- Clean expandable sections with per-stage and per-model breakdown
- Good use of optional chaining for nested metrics access

---

## Layer 10: Frontend Configuration UI

### File: `frontend/src/components/ModelSelector.jsx`

Full-featured model picker modal for selecting council members and chairman.

- Uses hooks: `useModels`, `useCuratedModels`, `useModelFiltering`, `useAutoExpandableGroups`
- **`toggleCouncilMember(modelId)`**: Toggles model in/out of the selected council set
- **`handleSave()`**: Persists selected models to backend config

**Issues**:
- Clean hook composition — business logic well-extracted from UI
- Modal overlay with click-outside-to-close — proper event cleanup
- Search, filter chips, and grouped model list all compose cleanly

### File: `frontend/src/components/ModelCuration.jsx`

Modal for curating favorite models (starred models).

- Similar hook composition to ModelSelector
- **`toggleCurated(modelId)`**: Toggles curated status
- **`addAll(modelIds)` / `removeAll(modelIds)`**: Bulk operations
- **`getBulkAction(provider, models)`**: Returns bulk add/remove action based on current curation state

**Issues**:
- Very similar structure to ModelSelector — could share a base modal component
- Bulk action logic is clean and well-thought-out

### File: `frontend/src/components/Sidebar.jsx`

Left sidebar with conversation list, config access, theme toggle.

- Manages conversation selection, creation, deletion, renaming
- Delegates to `ConversationItem` for per-conversation UI
- Delegates to `CouncilDisplay` for council member roster
- Config button opens ModelSelector modal
- Star button opens ModelCuration modal
- Theme toggle uses `useTheme` hook

**Issues**:
- Multiple responsibilities: conversation CRUD, config access, theme toggling, version display
- Complex state coordination between conversation selection and App.jsx
- Export handler delegates to API but no loading/error feedback

### File: `frontend/src/components/SkeletonLoader.jsx`

Loading skeleton components: `SkeletonTabs`, `SkeletonContent`, `SkeletonStage`, `SkeletonSynthesis`.

**Issues**:
- Pure presentational, CSS-animated. Zero logic, zero risk. Perfect testability.

### File: `frontend/src/components/VersionInfo.jsx`

Displays application version, git commit, and build time.

- Lazy-loads version data from `/api/version` on first open
- Links to GitHub commit and release URLs

**Issues**:
- Clean implementation. Minor: no error state display if API fetch fails (just shows "unknown" values).

---

## Layer 11: Frontend Hooks & Libraries

### File: `frontend/src/hooks/useModels.js`

Fetches available models from the backend with loading/error states.

- **`loadModels()`**: Fetches from `/api/models` (uses cache)
- **`refreshModels()`**: Fetches from OpenRouter (invalidates cache)

**Issues**:
- Clean hook with proper `useCallback` memoization
- Separates cached fetch from fresh fetch — good UX pattern
- No stale-while-revalidate — loading state blocks UI during refresh

### File: `frontend/src/hooks/useCuratedModels.js`

Manages the user's curated (starred) model list.

- **`toggle(modelId)`**: Toggles curated status (optimistic update via Set)
- **`addAll(modelIds)` / `removeAll(modelIds)` / `setAll(modelIds)`**: Bulk operations
- **`save()`**: Persists to backend
- **`isCurated(modelId)`**: Membership check

**Issues**:
- Clean Set-based state management
- Optimistic updates — changes are local until explicit `save()` call
- Error on load is silently swallowed (degrades to empty set) — acceptable for non-critical feature

### File: `frontend/src/hooks/useModelFiltering.js`

Filtering, searching, and grouping models.

- Multi-dimensional filter: text search, major providers, free only, curated only, min context length
- `useMemo`-based pipeline: filter → group → sort

**Issues**:
- Correct and complete dependency array on `useMemo`
- `clearFilters()` resets all dimensions — clean
- `hasActiveFilters` is a derived value (not state) — correct
- Filter pipeline is pure and composable

### File: `frontend/src/hooks/useExpandableGroups.js`

Two hooks: `useExpandableGroups` (manual) and `useAutoExpandableGroups` (reactive).

- **`useExpandableGroups`**: Set-based expand/collapse state. `toggle`, `expandAll`, `collapseAll`, `expandMatching`.
- **`useAutoExpandableGroups`**: Extends base hook. Auto-expands all groups when searching. Auto-expands groups containing selected items on mount.

**Issues**:
- Clean composition pattern — auto hook extends manual hook
- `useAutoExpandableGroups` has a subtle issue: `base.expandedCount === 0` guard prevents re-expansion, but if user collapses a group and then selections change, groups won't re-expand. Acceptable UX.

### File: `frontend/src/hooks/useTheme.js`

Manages light/dark/system theme preference.

- **`resolveTheme()`**: Resolves "system" to actual light/dark via `window.matchMedia`
- **`cycleTheme()`**: system → light → dark → system rotation
- Persists to `localStorage`, applies via `data-theme` attribute on `<html>`
- Listens for system preference changes (cleanup on unmount)

**Issues**:
- Clean implementation with proper event listener cleanup
- `resolvedTheme` is derived state that stays in sync — correct
- CSS variables in `index.css` use `@media (prefers-color-scheme: dark)` AND `[data-theme="dark"]` — both paths covered

### File: `frontend/src/lib/models.js`

Shared model utilities used by ModelSelector, ModelCuration, and hooks.

- **`MAJOR_PROVIDERS`**: Set of prioritized provider names
- **`formatPrice(price)`**: Formats per-token price as per-million display
- **`getDisplayName(model)`**: Extracts human-readable name from model object
- **`groupModelsByProvider(models)`**: Groups array by provider field
- **`sortProviders(providers)`**: Sorts with major providers first, then alphabetical
- **`isMajorProvider(provider)`**: Membership check
- **`formatContextLength(contextLength)`**: Formats as "128K"

**Issues**:
- Pure utility functions, all trivially testable
- Good JSDoc documentation
- `MAJOR_PROVIDERS` is hardcoded — could be configurable, but fine for now
- `formatPrice` returns "Free" for zero price — correct for OpenRouter models

---

## Layer 12: Frontend Sub-components

### File: `frontend/src/components/sidebar/ConversationItem.jsx`

Individual conversation item with rename/delete/export actions.

- Mini state machine: default → editing, default → deleting, default → export menu
- **`handleStartRename`** / **`handleFinishRename`** / **`handleCancelRename`**: Rename flow with input focus management
- **`handleDeleteClick`** / **`handleConfirmDelete`** / **`handleCancelDelete`**: Two-step delete confirmation
- **`handleExportClick`** / **`handleExport(format)`**: Export menu with markdown/JSON options

**Issues**:
- Clean state machine pattern — each state has its own render path
- `handleFinishRename` doesn't validate empty-after-trim (it does check `editingTitle.trim()`)
- `onBlur` triggers `handleFinishRename` — could cause double-save if user clicks outside after pressing Enter
- Click-outside listener for export menu properly cleans up

### File: `frontend/src/components/sidebar/CouncilDisplay.jsx`

Council member roster panel in the sidebar.

- **`getShortModelName(model)`**: Capitalizes last segment of "provider/model-name"
- **`getProvider(model)`**: Capitalizes first segment
- **`CouncilDisplay component`**: Expandable panel with chairman section and members list. Animated expand/collapse via `scrollHeight`.

**Issues**:
- `getShortModelName` only capitalizes first letter — "gpt-4" becomes "Gpt-4" (debatable UX)
- Animation uses `maxHeight` + `scrollHeight` — works but can be janky if content changes during animation
- `aria-expanded` attribute — good accessibility
- Separates chairman from regular members cleanly

### File: `frontend/src/components/models/ModelSearchBox.jsx`

Search input with optional icon and clear button.

**Issues**:
- Fully controlled component, minimal logic. Clean.

### File: `frontend/src/components/models/FilterChips.jsx`

Filter chip bar for model filtering.

**Issues**:
- Renders "My models" chip only when curated filter is applicable AND curated count > 0
- "Curated only" chip renders in a different spot when NOT in curation mode — slightly confusing conditional
- Clean controlled checkbox inputs

### File: `frontend/src/components/models/ModelGroups.jsx`

Three components: `ModelItem`, `ModelGroupHeader`, `ModelGroups`.

- **`ModelItem`**: Renders a single model with checkbox (selector) or star (curation) variant
- **`ModelGroupHeader`**: Provider group header with expand/collapse and optional bulk action button
- **`ModelGroups`**: Container that maps sorted providers to grouped sections

**Issues**:
- Clean variant pattern in ModelItem (checkbox vs star)
- `ModelGroups` accepts function props (`isExpanded`, `isSelected`, `getSelectedCount`, `getBulkAction`) — good inversion of control
- `.filter(m => m.id)` in ModelGroups — defensive but suggests models without IDs can exist in the data

---

## Layer 13: Backend Auth, Export, Attachments

### File: `backend/auth.py`

Reverse proxy header-based authentication.

- **`_parse_trusted_ips()`**: Parses CIDR and IP strings from env var. Handles errors gracefully.
- **`_is_trusted_ip(client_ip)`**: Checks IP against trusted list. Supports both IPv4/IPv6 addresses and CIDR networks.
- **`_get_client_ip(request)`**: Extracts client IP from `X-Forwarded-For` or direct connection.
- **`get_current_user(request)`**: Main auth function. Returns `User` if auth enabled + trusted IP + header present.
- **`require_auth(request)`**: FastAPI dependency that raises 401. For routes requiring auth.
- **`get_optional_user(request)`**: FastAPI dependency that never raises. For routes with optional auth.

**Issues**:
- `_is_trusted_ip` calls `_parse_trusted_ips()` on EVERY invocation — re-parses the env var string each time. Should cache the parsed result at module level or use `@lru_cache`
- `_get_client_ip` returns first IP from X-Forwarded-For — correct for standard nginx setup, but doesn't handle multi-hop proxies. Acceptable for documented single-proxy architecture
- `User` dataclass is clean. `get_optional_user` is a trivial wrapper — correct pattern for FastAPI dependency injection

### File: `backend/export.py`

Conversation export to Markdown and JSON.

- **`format_model_name(model_id)`**: Extracts last segment of "provider/model". Pure, trivial.
- **`export_to_markdown(conversation)`**: Builds complete markdown document from conversation data. Handles both council and arena formats. ~130 lines of string building.
- **`export_to_json(conversation)`**: Returns cleaned dict with selected fields. Essentially a whitelist filter.

**Issues**:
- `export_to_markdown` is a long function but well-structured with clear sections (header, config, messages)
- `datetime.fromisoformat` with manual "Z" replacement — Python 3.11+ handles "Z" natively, but this is safe
- No HTML escaping in markdown output — model responses with markdown-like content could produce unexpected formatting
- No test coverage implied by structure — but the functions are pure and testable

### File: `backend/attachments.py`

File attachment handling for conversations.

- **`get_attachments_dir(user_id)`** / **`ensure_attachments_dir(user_id)`**: User-scoped directory management.
- **`get_file_extension(filename)`** / **`get_file_type(filename)`**: File type classification.
- **`validate_file(filename, content)`**: Size and type validation.
- **`save_attachment(filename, content, user_id)`**: Saves with SHA-256 content hash naming.
- **`get_attachment_path(attachment_id, ext, user_id)`**: Retrieves stored file path.
- **`extract_text_from_pdf(content)`**: Uses PyMuPDF with pymupdf4llm fallback to basic extraction.
- **`extract_text_from_file(filename, content)`**: Routes to text decode, PDF extract, or None for images.
- **`encode_image_for_vision(filename, content)`**: Base64 encodes image for OpenRouter vision models.
- **`process_attachments(attachments, user_id)`**: Orchestrator that processes all attachments and returns (text_context, image_parts).

**Issues**:
- Content-hash naming is smart — deduplicates identical files automatically
- `extract_text_from_pdf` has three-level try/except nesting (pymupdf4llm → fitz basic → error string). Hard to test all paths
- `extract_text_from_file` tries UTF-8, falls back to Latin-1 — good encoding strategy
- `validate_file` is pure and testable — good separation
- `process_attachments` does file I/O in a loop — no parallelism for multiple attachments

---

## Layer 14: Backend Infrastructure

### File: `backend/logging_config.py`

Structured logging with JSON and human-readable formatters.

- **Context vars**: `get_correlation_id()`, `set_correlation_id()`, `get_current_user()`, `set_current_user()` — trivial ContextVar wrappers for request-scoped data.
- **`ContextAwareJsonFormatter.add_fields()`**: Adds timestamp, level, logger, correlation_id, user to JSON log records.
- **`ContextAwareFormatter.format()`**: Prepends `[correlation_id] [user]` prefix to human-readable logs.
- **`setup_logging()`**: Configures root logger based on `LOG_FORMAT` and `LOG_LEVEL` env vars.

**Issues**:
- `ContextAwareFormatter.format()` **mutates** `record.msg` and `record.args` — this is a side effect that could cause issues if the same record is formatted by multiple handlers. Should create a copy.
- `setup_logging()` modifies global state (root logger) — expected for logging setup, but makes testing difficult. Need to reset root logger in test fixtures.
- JSON formatter correctly uses `self.formatTime()` — consistent timestamp format
- Context vars are set via middleware in main.py — clean request-scoped pattern

### File: `backend/version.py`

Application version information.

- **`_get_git_commit()`**: Checks `GIT_COMMIT` env var first (Docker build), falls back to `git rev-parse HEAD` subprocess.
- **`_get_build_time()`**: Trivial env var read.
- **`get_version_info()`**: Cached with `@lru_cache`. Returns `VersionInfo` dataclass.
- **`VersionInfo`**: Dataclass with computed `commit_url` and `release_url` properties.

**Issues**:
- `subprocess.run` with `timeout=5` — good defensive timeout for git call
- `@lru_cache` — correct, version info is immutable for lifetime of process
- `REPO_URL` hardcoded — acceptable for this project
- Exception handling catches broad `(subprocess.SubprocessError, FileNotFoundError, OSError)` — correct set for subprocess failures

---

## Function Inventory & Grades

Scale: A (excellent) → F (critical issues)

### Maintainability (M) and Testability (T) grades:

| # | File | Function | M | T | Key Issues |
|---|------|----------|---|---|------------|
| 1 | council.py | `stage1_collect_responses` | B | C | Duplicated prompt, hardcoded system msg |
| 2 | council.py | `stage1_collect_responses_streaming` | C | D | 95% duplicate of #1, closure captures mutable list |
| 3 | council.py | `stage2_collect_rankings` | B- | C | Huge prompt literal, no system message, 26-model limit |
| 4 | council.py | `stage3_synthesize_final` | C | C | Breaks anonymization, no retry, huge prompt |
| 5 | council.py | `parse_ranking_from_text` | C | B | Fragile regex, inline import, no dedup |
| 6 | council.py | `aggregate_metrics` | B+ | A | Pure function, good null handling |
| 7 | council.py | `calculate_aggregate_rankings` | C | B | Double-parses rankings, inline import |
| 8 | council.py | `generate_conversation_title` | B | A- | Hardcoded model, but simple and testable |
| 9 | council.py | `perform_web_search` | A | A | Clean wrapper |
| 10 | council.py | `run_full_council` | B | B | Parallel code path to streaming — maintenance burden |
| 11 | council.py | `convert_to_unified_result` | A- | A | Pure transformation |
| 12 | council.py | `convert_legacy_message_to_unified` | B | B | Handles legacy, slightly complex |
| 13 | openrouter.py | `query_model` | C | D | No connection pooling, no retry, catch-all exception |
| 14 | openrouter.py | `query_models_parallel` | B | C | asyncio.gather blocks all, double import |
| 15 | openrouter.py | `query_model_streaming` | C | D | Same issues as #13, loses metadata |
| 16 | openrouter.py | `query_models_progressive` | C | D | Potential as_completed task identity bug |
| 17 | main.py | `send_message_stream` | B- | F | Delegates correctly, but the generator is untestable |
| 18 | main.py | `council_event_generator` | D | F | 200-line nested generator, untestable, error handling too broad |
| 19 | main.py | `send_message` (non-streaming) | D | D | Ignores per-conversation config, uses legacy storage |
| 20 | storage.py | `get_conversation` | C | B | No caching, disk I/O on every call |
| 21 | storage.py | `add_user_message` | C | B | Read-modify-write, no locking |
| 22 | storage.py | `add_unified_message` | C | B | Same read-modify-write pattern |
| 23 | storage.py | `list_conversations` | D | B | Reads ALL files, no pagination |
| 24 | storage.py | `mark_response_pending` | C | B | Single-file pending store |
| 25 | storage.py | `is_pending_stale` | B | A | Clean logic, good defaults |
| 26 | config.py | `get_council_models` | C | A | File I/O every call, no cache |
| 27 | config.py | `get_chairman_model` | C | A | Same as #26 |
| 28 | config.py | `reload_config` | C | C | Cross-module mutation |
| 29 | api.js | `sendMessageStream` | C | D | Fragile SSE parsing, no abort, 9 params |
| 30 | App.jsx | `handleSendMessage` | D | F | 300 lines, mutable state updates, giant switch |
| 31 | deliberation.py | Data models | A- | A | Clean dataclasses, could use Pydantic |
| 32 | telemetry.py | NoOp pattern | A | A | Clean, correct |
| 33 | websearch.py | `search_web` | B+ | B+ | Good fallback, deprecated asyncio call |
| 34 | models.py | `fetch_available_models` | B | B | Good caching, deprecated datetime |
| | | | | | |
| | **Frontend Rendering** | | | | |
| 35 | ChatInterface.jsx | `ChatInterface` component | D | F | 300+ line component, inline handlers, streaming state, untestable |
| 36 | ChatInterface.jsx | `convertCouncilToRounds` | C | B | Bridges legacy/unified formats, pure function, two format concerns |
| 37 | ChatInterface.jsx | `convertSynthesis` | B | B | Clean extraction helper, pure function |
| 38 | ChatInterface.jsx | `getParticipantMapping` | B | B | Simple extraction, handles both formats |
| 39 | Round.jsx | `Round` component | C | D | Complex tab state, dual format handling, ReactMarkdown dependency |
| 40 | Round.jsx | Utilities (formatCost, getReasoningText, getTabLabel, getModelName, getRoundCost) | B | A | Pure functions, simple, testable |
| 41 | Round.jsx | `deAnonymizeText` | B | A | Pure regex replacement, well-focused |
| 42 | Synthesis.jsx | `Synthesis` component | B | C | Manageable size, DUPLICATES formatCost and getReasoningText from Round |
| 43 | MetricsDisplay.jsx | `MetricsDisplay` component | B | C | Clean expandable sections, 3rd copy of formatCost |
| | | | | | |
| | **Frontend Config UI** | | | | |
| 44 | ModelSelector.jsx | `ModelSelector` component | B | C | Clean hook composition, async save with error handling |
| 45 | ModelCuration.jsx | `ModelCuration` component | B | C | Similar to ModelSelector, well-extracted hooks |
| 46 | Sidebar.jsx | `Sidebar` component | C | D | Multiple responsibilities, complex state coordination |
| 47 | SkeletonLoader.jsx | Skeleton components (4) | A | A | Pure presentational, CSS only, zero risk |
| 48 | VersionInfo.jsx | `VersionInfo` component | B | B | Simple, lazy-loads from API |
| 49 | ConversationItem.jsx | `ConversationItem` component | B | C | Mini state machine (editing/deleting/exporting), clean event handlers |
| 50 | CouncilDisplay.jsx | `CouncilDisplay` + helpers | B | B | Clean panel, animation, accessibility, pure helpers |
| | | | | | |
| | **Frontend Hooks & Lib** | | | | |
| 51 | useModels.js | `useModels` hook | A | B | Clean hook, useCallback, loading/error states |
| 52 | useCuratedModels.js | `useCuratedModels` hook | A | B | Optimistic updates, Set-based state |
| 53 | useModelFiltering.js | `useModelFiltering` hook | B | B | Solid useMemo pipeline, correct deps, composable filters |
| 54 | useExpandableGroups.js | `useExpandableGroups` + `useAutoExpandableGroups` | A | A | Clean Set state, good composition pattern |
| 55 | useTheme.js | `useTheme` hook | A | B | Clean, proper cleanup, localStorage persistence |
| 56 | lib/models.js | Utilities (formatPrice, getDisplayName, groupModelsByProvider, sortProviders, isMajorProvider, formatContextLength) | A | A | Pure functions, well-documented, trivially testable |
| 57 | models/*.jsx | Sub-components (ModelSearchBox, FilterChips, ModelItem, ModelGroupHeader, ModelGroups) | A | B | Clean presentational, good variant pattern, function prop inversion |
| | | | | | |
| | **Backend Auth** | | | | |
| 58 | auth.py | `_parse_trusted_ips` | B | A | Clean parsing, error handling |
| 59 | auth.py | `_is_trusted_ip` | C | B | Re-parses on EVERY call, should cache |
| 60 | auth.py | `_get_client_ip` | B | A | Simple X-Forwarded-For parsing |
| 61 | auth.py | `get_current_user` + `get_optional_user` + `require_auth` | B | B | Clean FastAPI dependency pattern |
| | | | | | |
| | **Backend Export** | | | | |
| 62 | export.py | `export_to_markdown` | C | B | ~130 line string builder, no HTML escaping |
| 63 | export.py | `export_to_json` + `format_model_name` | A | A | Trivially simple |
| | | | | | |
| | **Backend Attachments** | | | | |
| 64 | attachments.py | `validate_file` + `save_attachment` + `get_attachment_path` | B | C | File I/O, content-hash naming is smart |
| 65 | attachments.py | `extract_text_from_pdf` + `extract_text_from_file` + `encode_image_for_vision` | C | D | Nested try/except, external deps, hard to test |
| 66 | attachments.py | `process_attachments` | B | C | Orchestrator, filesystem loop, no parallelism |
| | | | | | |
| | **Backend Infrastructure** | | | | |
| 67 | logging_config.py | `setup_logging` + formatters | B | D | ContextAwareFormatter mutates record, global state |
| 68 | logging_config.py | Context var accessors (4) | A | A | Trivial ContextVar wrappers |
| 69 | version.py | `_get_git_commit` + `_get_build_time` + `get_version_info` | B | C | subprocess call, lru_cache is good |

---

## Critical Issues Summary

### P0 — Things That Are Broken

1. **`query_models_progressive` task identity bug — CONFIRMED** (openrouter.py:349-351): `asyncio.as_completed()` returns **coroutines**, not the original `Task` objects. The lookup `task_to_model[completed_task]` will **ALWAYS KeyError** because the coroutine is not in the dict. Tested and confirmed on Python 3.14.2. **This is the root cause of Council being broken.** The streaming endpoint (`/message/stream`) uses `query_models_progressive` for Stage 1, meaning every council request crashes here.

2. **SSE chunk splitting** (api.js:367-368): The `decoder.decode(value)` + `split('\n')` pattern doesn't handle SSE events that span multiple TCP chunks. A large Stage 1 response could be split mid-JSON, causing silent parse failures and missing data in the UI.

3. **Non-streaming endpoint ignores per-conversation config** (main.py:539): `run_full_council()` is called without the conversation's model config. If someone sets custom models per conversation, the non-streaming path ignores them.

### P1 — Maintainability Hazards

4. **Massive duplication**: `stage1_collect_responses` and `stage1_collect_responses_streaming` are 95% identical. Any prompt change must be made in two places.

5. **200-line untestable generator**: `council_event_generator` in main.py cannot be unit tested — it's a nested closure with database access, API calls, and SSE generation all interleaved.

6. **Two parallel code paths**: The streaming and non-streaming paths share zero orchestration code. Bug fixes must be applied twice.

7. **Chairman sees model names**: Stage 3 reveals which model said what, undermining the anonymization that Stage 2 carefully builds.

### P2 — Testability Gaps

8. **No dependency injection anywhere**: All functions import and call globals directly. To test `stage1_collect_responses` you must mock `query_models_parallel` at the module level.

9. **Storage reads disk on every call**: `get_council_models()`, `get_conversation()`, `load_user_config()` all hit the filesystem per call. Tests need a real filesystem or extensive mocking.

10. **Config reads not cached**: `load_user_config()` reads JSON from disk every time. In a single council run, this file is read 6+ times.

11. **No interfaces/protocols**: Nothing uses Python protocols or ABC. Swapping OpenRouter for a mock client requires monkey-patching.

### P3 — Code Quality

12. **Inline imports**: `re`, `defaultdict`, `asyncio` imported inside function bodies instead of module level.

13. **Deprecated patterns**: `datetime.utcnow()`, `asyncio.get_event_loop()`.

14. **26-model label limit**: `chr(65 + i)` breaks after 26 models.

15. **Double ranking parse**: `calculate_aggregate_rankings` re-parses text that was already parsed in Stage 2.

16. **`formatCost` duplicated 3 times**: Identical function in Round.jsx, Synthesis.jsx, and MetricsDisplay.jsx. Should be extracted to a shared utility.

17. **`getReasoningText` duplicated 2 times**: Identical function in Round.jsx and Synthesis.jsx.

18. **`_is_trusted_ip` re-parses on every call**: `auth.py` calls `_parse_trusted_ips()` on every IP check. The trusted IP list is static (from env var) and should be cached at module load.

19. **`ContextAwareFormatter.format()` mutates record**: Overwrites `record.msg` and `record.args` — could cause issues with multi-handler setups.

20. **ChatInterface lacks memoization**: `convertCouncilToRounds` runs inline on every render without `useMemo`.

---

## Recommendations

### Immediate (fix "shits broke")

1. **Fix `query_models_progressive`**: Replace `as_completed` task lookup with a wrapper that preserves model identity (use `asyncio.wait` with `FIRST_COMPLETED` instead, or wrap each task with its model name)

2. **Fix SSE parsing in api.js**: Accumulate a buffer and only parse complete `data: {...}\n\n` events

### Short-term (maintainability)

3. **Extract system prompts**: Move all prompt templates to a `prompts.py` module
4. **Merge stage1 functions**: Create one `stage1_collect_responses` that accepts a `streaming: bool` parameter
5. **Extract `council_event_generator`**: Move to `council.py` as a standalone async generator
6. **Fix Stage 3 anonymization**: Use labels instead of model names in the chairman prompt

### Short-term (frontend)

7. **Extract shared utilities**: Move `formatCost`, `getReasoningText` to `lib/formatting.js` — currently duplicated across 3 components
8. **Memoize `convertCouncilToRounds`**: Wrap in `useMemo` in ChatInterface to avoid re-computation on every render
9. **Add error boundary**: Wrap ChatInterface children in a React error boundary to prevent full-conversation crash on malformed markdown

### Medium-term (testability)

10. **Add dependency injection**: Create protocol classes for `LLMClient` and `Storage`, pass them as params
11. **Cache config reads**: Read config once at request start, pass as context
12. **Cache `_parse_trusted_ips`**: Parse once at module load or use `@lru_cache`
13. **Add integration test harness**: Mock OpenRouter at the HTTP level, test the full pipeline
14. **Remove non-streaming endpoint**: Or make it delegate to the streaming path with collected results

### Grade Distribution Summary

| Grade | Count (M) | Count (T) |
|-------|-----------|-----------|
| A     | 14        | 14        |
| B     | 30        | 18        |
| C     | 16        | 12        |
| D     | 5         | 9         |
| F     | 0         | 4         |

**Worst Testability (T:F)**: ChatInterface, council_event_generator, send_message_stream, handleSendMessage
**Worst Maintainability (M:D)**: ChatInterface, council_event_generator, send_message (non-streaming), list_conversations, handleSendMessage
