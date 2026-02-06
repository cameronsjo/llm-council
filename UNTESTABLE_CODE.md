# Untestable Code Documentation

Methods documented here cannot be reasonably unit tested without complex mocking that would not verify meaningful behavior. They are tightly coupled to external services, filesystem I/O, or framework runtime.

For each entry: file path, function name, line number, and reason.

## Categories

### Network-Dependent (HTTP/API Calls)

| File | Function | Line | Reason |
|------|----------|------|--------|
| `backend/openrouter.py` | `query_model()` | 23 | Makes HTTP POST to OpenRouter API via httpx; response parsing tightly coupled to API shape |
| `backend/openrouter.py` | `query_models_parallel()` | 108 | Wraps `query_model()` with `asyncio.gather`; mocking every coroutine does not verify parallel behavior |
| `backend/openrouter.py` | `query_model_streaming()` | 163 | Streams SSE lines from OpenRouter via `httpx.AsyncClient.stream`; stateful line-by-line parsing |
| `backend/openrouter.py` | `query_models_progressive()` | 286 | Uses `asyncio.wait` over streaming/non-streaming queries; core logic tested in `tests/test_openrouter.py` |
| `backend/council.py` | `stage1_collect_responses()` | 31 | Orchestrates parallel LLM queries via `query_models_parallel` |
| `backend/council.py` | `stage1_collect_responses_streaming()` | 114 | Orchestrates progressive LLM queries with callback-driven streaming |
| `backend/council.py` | `stage2_collect_rankings()` | 221 | Sends anonymized ranking prompts to all council models in parallel |
| `backend/council.py` | `stage3_synthesize_final()` | 331 | Queries chairman model for synthesis; fallback on failure |
| `backend/council.py` | `run_full_council()` | 666 | End-to-end 3-stage orchestration calling web search + all stages sequentially |
| `backend/council.py` | `generate_conversation_title()` | 605 | Queries `google/gemini-2.5-flash` to generate a short title |
| `backend/council.py` | `perform_web_search()` | 643 | Delegates to `search_web()` then `format_search_results()` |
| `backend/arena.py` | `round1_initial_positions()` | 177 | Builds per-participant prompts and queries all models in parallel |
| `backend/arena.py` | `round_n_deliberation()` | 249 | Sends deliberation prompts referencing prior rounds to all models |
| `backend/arena.py` | `final_synthesis()` | 322 | Queries chairman model with full debate transcript for synthesis |
| `backend/arena.py` | `run_arena_debate()` | 465 | End-to-end multi-round debate orchestration |
| `backend/models.py` | `fetch_available_models()` | 21 | HTTP GET to OpenRouter models endpoint; writes to module-level cache |
| `backend/websearch.py` | `search_tavily()` | 21 | HTTP POST to Tavily search API |
| `backend/websearch.py` | `search_duckduckgo()` | 65 | Imports and calls `duckduckgo_search.DDGS` in a thread pool |
| `backend/websearch.py` | `search_web()` | 112 | Tries Tavily then falls back to DuckDuckGo; behavior depends on API key presence and external availability |

### Filesystem-Dependent (Disk I/O)

| File | Function | Line | Reason |
|------|----------|------|--------|
| `backend/storage.py` | `ensure_data_dir()` | 42 | Creates directories on disk via `Path.mkdir` |
| `backend/storage.py` | `create_conversation()` | 64 | Creates directory and writes JSON file |
| `backend/storage.py` | `get_conversation()` | 129 | Reads and deserializes JSON from disk; includes migration logic |
| `backend/storage.py` | `save_conversation()` | 190 | Writes JSON to disk |
| `backend/storage.py` | `list_conversations()` | 206 | Lists directory, opens and parses every JSON file |
| `backend/storage.py` | `add_user_message()` | 240 | Read-modify-write cycle on conversation JSON file |
| `backend/storage.py` | `add_assistant_message()` | 259 | Read-modify-write cycle on conversation JSON file |
| `backend/storage.py` | `update_conversation_title()` | 297 | Read-modify-write cycle on conversation JSON file |
| `backend/storage.py` | `delete_conversation()` | 315 | Calls `os.remove` on a file |
| `backend/storage.py` | `add_arena_message()` | 336 | Read-modify-write cycle on conversation JSON file |
| `backend/storage.py` | `add_unified_message()` | 373 | Read-modify-write cycle on conversation JSON file |
| `backend/storage.py` | `update_last_arena_message()` | 398 | Read-modify-write cycle with reverse search for arena message |
| `backend/storage.py` | `load_pending_messages()` | 451 | Reads pending.json from disk |
| `backend/storage.py` | `save_pending_messages()` | 470 | Writes pending.json to disk |
| `backend/storage.py` | `mark_response_pending()` | 485 | Read-modify-write cycle on pending.json |
| `backend/storage.py` | `update_pending_progress()` | 510 | Read-modify-write cycle on pending.json |
| `backend/storage.py` | `clear_pending()` | 529 | Read-modify-write cycle on pending.json |
| `backend/storage.py` | `get_pending_message()` | 544 | Reads pending.json from disk |
| `backend/storage.py` | `remove_last_user_message()` | 588 | Read-modify-write cycle on conversation JSON file |
| `backend/attachments.py` | `ensure_attachments_dir()` | 43 | Creates directories on disk via `Path.mkdir` |
| `backend/attachments.py` | `save_attachment()` | 97 | Writes binary file to disk |
| `backend/attachments.py` | `get_attachment_path()` | 139 | Checks file existence on disk via `os.path.exists` |
| `backend/attachments.py` | `extract_text_from_pdf()` | 161 | Requires PyMuPDF / pymupdf4llm libraries for PDF binary processing |
| `backend/attachments.py` | `process_attachments()` | 271 | Reads attachment files from disk and dispatches to extraction/encoding |

### Framework-Dependent (FastAPI / React)

| File | Function | Line | Reason |
|------|----------|------|--------|
| `backend/auth.py` | `get_current_user()` | 118 | Requires FastAPI `Request` object with headers and client IP |
| `backend/auth.py` | `require_auth()` | 161 | Wraps `get_current_user()` with HTTPException; FastAPI dependency |
| `backend/auth.py` | `get_optional_user()` | 185 | Delegates to `get_current_user()`; FastAPI dependency |
| `backend/main.py` | `health_check()` | 192 | FastAPI endpoint handler |
| `backend/main.py` | `get_version()` | 198 | FastAPI endpoint handler |
| `backend/main.py` | `get_config()` | 215 | FastAPI endpoint handler |
| `backend/main.py` | `get_user_info()` | 233 | FastAPI endpoint with auth dependency injection |
| `backend/main.py` | `update_config()` | 247 | FastAPI endpoint handler |
| `backend/main.py` | `reload_config_endpoint()` | 268 | FastAPI endpoint handler |
| `backend/main.py` | `get_available_models()` | 299 | FastAPI endpoint wrapping `fetch_available_models()` |
| `backend/main.py` | `refresh_available_models()` | 306 | FastAPI endpoint wrapping cache invalidation + fetch |
| `backend/main.py` | `upload_attachment()` | 318 | FastAPI endpoint with `UploadFile` dependency |
| `backend/main.py` | `list_conversations()` | 347 | FastAPI endpoint with auth dependency |
| `backend/main.py` | `create_conversation()` | 354 | FastAPI endpoint with auth dependency |
| `backend/main.py` | `get_conversation()` | 371 | FastAPI endpoint with auth dependency |
| `backend/main.py` | `update_conversation()` | 384 | FastAPI endpoint with auth dependency |
| `backend/main.py` | `delete_conversation()` | 402 | FastAPI endpoint with auth dependency |
| `backend/main.py` | `export_conversation_markdown()` | 415 | FastAPI endpoint returning StreamingResponse |
| `backend/main.py` | `export_conversation_json()` | 437 | FastAPI endpoint returning StreamingResponse |
| `backend/main.py` | `get_pending_status()` | 459 | FastAPI endpoint with auth dependency |
| `backend/main.py` | `clear_pending_status()` | 491 | FastAPI endpoint with auth dependency |
| `backend/main.py` | `send_message()` | 511 | FastAPI endpoint orchestrating full council pipeline |
| `backend/main.py` | `send_message_stream()` | 563 | FastAPI SSE endpoint; council pipeline logic extracted to `backend/council_stream.py` (tested) |
| `backend/main.py` | `extend_arena_debate_stream()` | 962 | FastAPI SSE endpoint extending existing arena debate |
| `backend/main.py` | `logging_context_middleware()` | 92 | FastAPI middleware managing request-scoped correlation IDs |
| `frontend/src/App.jsx` | `App` | 1-799 | React component with state, effects, callbacks, and API integration |
| `frontend/src/components/ChatInterface.jsx` | `ChatInterface` | 1-751 | React component with textarea, event handling, SSE streaming |
| `frontend/src/components/Sidebar.jsx` | `Sidebar` | 1-206 | React component with conversation list, rename, delete actions |
| `frontend/src/components/ModelSelector.jsx` | `ModelSelector` | 1-207 | React modal component with search, grouping, multi-select |
| `frontend/src/components/ModelCuration.jsx` | `ModelCuration` | 1-196 | React modal component for curating model list |
| `frontend/src/components/Round.jsx` | `Round` | 1-236 | React component rendering debate round with tabs |
| `frontend/src/components/Synthesis.jsx` | `Synthesis` | 1-150 | React component rendering chairman synthesis |
| `frontend/src/components/MetricsDisplay.jsx` | `MetricsDisplay` | 1-80 | React component rendering token/cost metrics |
| `frontend/src/components/SkeletonLoader.jsx` | `SkeletonLoader` | 1-73 | React component rendering loading placeholders |
| `frontend/src/components/VersionInfo.jsx` | `VersionInfo` | 1-128 | React component fetching and displaying version info |
| `frontend/src/hooks/useModels.js` | `useModels` | 1-63 | React hook fetching models from API on mount |
| `frontend/src/hooks/useCuratedModels.js` | `useCuratedModels` | 1-110 | React hook managing curated model state with API calls |
| `frontend/src/hooks/useModelFiltering.js` | `useModelFiltering` | 1-146 | React hook with `useMemo`/`useCallback` for model search and grouping |
| `frontend/src/hooks/useExpandableGroups.js` | `useExpandableGroups` | 1-114 | React hook managing expand/collapse state for provider groups |
| `frontend/src/hooks/useTheme.js` | `useTheme` | 1-82 | React hook reading/writing `localStorage` and toggling DOM class |

### Browser API-Dependent (fetch / EventSource)

| File | Function | Line | Reason |
|------|----------|------|--------|
| `frontend/src/api.js` | `api.getConfig()` | 13 | Browser `fetch()` to `/api/config` |
| `frontend/src/api.js` | `api.getVersion()` | 24 | Browser `fetch()` to `/api/version` |
| `frontend/src/api.js` | `api.getUserInfo()` | 35 | Browser `fetch()` to `/api/user` |
| `frontend/src/api.js` | `api.updateConfig()` | 46 | Browser `fetch()` POST to `/api/config` |
| `frontend/src/api.js` | `api.getAvailableModels()` | 66 | Browser `fetch()` to `/api/models` |
| `frontend/src/api.js` | `api.refreshModels()` | 78 | Browser `fetch()` POST to `/api/models/refresh` |
| `frontend/src/api.js` | `api.getCuratedModels()` | 91 | Browser `fetch()` to `/api/curated-models` |
| `frontend/src/api.js` | `api.updateCuratedModels()` | 102 | Browser `fetch()` POST to `/api/curated-models` |
| `frontend/src/api.js` | `api.listConversations()` | 119 | Browser `fetch()` to `/api/conversations` |
| `frontend/src/api.js` | `api.createConversation()` | 132 | Browser `fetch()` POST to `/api/conversations` |
| `frontend/src/api.js` | `api.getConversation()` | 156 | Browser `fetch()` to `/api/conversations/{id}` |
| `frontend/src/api.js` | `api.deleteConversation()` | 169 | Browser `fetch()` DELETE to `/api/conversations/{id}` |
| `frontend/src/api.js` | `api.renameConversation()` | 185 | Browser `fetch()` PATCH to `/api/conversations/{id}` |
| `frontend/src/api.js` | `api.exportMarkdown()` | 206 | Browser `fetch()` returning Blob |
| `frontend/src/api.js` | `api.exportJson()` | 220 | Browser `fetch()` returning Blob |
| `frontend/src/api.js` | `api.uploadAttachment()` | 235 | Browser `fetch()` POST with FormData |
| `frontend/src/api.js` | `api.getPendingStatus()` | 256 | Browser `fetch()` to `/api/conversations/{id}/pending` |
| `frontend/src/api.js` | `api.clearPending()` | 269 | Browser `fetch()` DELETE to `/api/conversations/{id}/pending` |
| `frontend/src/api.js` | `api.sendMessage()` | 285 | Browser `fetch()` POST to `/api/conversations/{id}/message` |
| `frontend/src/api.js` | `api.sendMessageStream()` | 315 | Browser `fetch()` with `ReadableStream` reader for SSE parsing |
| `frontend/src/api.js` | `api.extendDebateStream()` | 390 | Browser `fetch()` with `ReadableStream` reader for SSE parsing |

### Runtime / Global State

| File | Function | Line | Reason |
|------|----------|------|--------|
| `backend/telemetry.py` | `setup_telemetry()` | 30 | Mutates module-level globals `_tracer` and `_telemetry_enabled`; configures OTel SDK |
| `backend/telemetry.py` | `get_tracer()` | 93 | Reads module-level `_tracer` global; returns real tracer or no-op proxy |
| `backend/telemetry.py` | `is_telemetry_enabled()` | 25 | Reads module-level `_telemetry_enabled` global |
| `backend/telemetry.py` | `instrument_fastapi()` | 154 | Calls `FastAPIInstrumentor.instrument_app()`; modifies app middleware |
| `backend/telemetry.py` | `instrument_httpx()` | 175 | Calls `HTTPXClientInstrumentor().instrument()`; global side effect |
| `backend/logging_config.py` | `setup_logging()` | 111 | Replaces root logger handlers; global side effect on logging infrastructure |

## Testing Strategy

For untestable code, we rely on:

- **Integration tests** (future): End-to-end tests against a running backend with mocked external APIs at the HTTP boundary.
- **Manual testing** via the running application to validate full request/response flows.
- **Pure function tests** in `tests/` and `frontend/src/__tests__/` cover the extractable logic: ranking parsing, metrics aggregation, participant mapping, file validation, IP trust checking, format utilities, and data conversion functions.
