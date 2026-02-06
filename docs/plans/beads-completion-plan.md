# Beads Completion Plan

> Generated 2026-02-06, Iteration 1

## Execution Order

Grouped by natural dependency and priority. P1 first, then P2, then P3.
Some beads are related and benefit from being done sequentially.

---

## GROUP 1: Backend OpenRouter Layer (P1)

### council-o7u: query_model

**Status:** done
**Branch:** fix/council-o7u-query-model
**Approach:** Add shared httpx.AsyncClient via module-level factory (lazy singleton). Add retry with exponential backoff for 429/502/503 status codes (max 3 retries). Replace catch-all `except Exception` with differentiated handling: `httpx.HTTPStatusError` for API errors, `httpx.TimeoutException` for timeouts, `Exception` as final fallback. Each logs differently.
**Alternatives considered:** (1) Dependency-injected client — cleaner but over-engineered for this codebase. (2) tenacity library for retry — adds dependency, `asyncio.sleep` loop is simpler. (3) Context manager client per-request — current approach, wasteful but simple.
**PR:** https://github.com/cameronsjo/llm-council/pull/8
**Notes:** Also fixed query_model_streaming metadata extraction (council-dcv) in same PR.

### council-dcv: query_model_streaming

**Status:** done
**Branch:** fix/council-o7u-query-model (bundled with council-o7u)
**Approach:** Share the same httpx client from council-o7u fix. Extract metadata from SSE stream chunks — OpenRouter includes `model`, `id`, and `provider` in streaming `data` chunks. Parse these from the first chunk and populate the result dict. Also added differentiated error handling.
**Alternatives considered:** (1) Separate metadata fetch after stream — adds latency. (2) Accept data loss — simple but the non-streaming path sets expectations. (3) Parse every chunk for metadata — wasteful, first chunk is sufficient.
**PR:** https://github.com/cameronsjo/llm-council/pull/8
**Notes:** Bundled with council-o7u since changes were in same file and closely related.

---

## GROUP 2: Backend Council Logic (P1 + P2)

### council-35i: stage3_synthesize_final (P1 - CRITICAL BUG)

**Status:** done
**Branch:** fix/council-35i-anonymize-stage3
**Approach:** Replace `f"Model: {result['model']}"` with anonymous labels in the chairman prompt. Use same "Response A, B, C" labels from Stage 2. Chairman sees anonymous labels, not model names. This preserves the core anonymization design. Also add simple retry (1 retry) for the chairman call since it's the most important single API call.
**Alternatives considered:** (1) Keep model names but document it as intentional — breaks the project's stated design principle. (2) Use different labels than Stage 2 — confusing, better to reuse same labels. (3) Don't retry chairman — risky since entire council result depends on it.
**PR:** https://github.com/cameronsjo/llm-council/pull/9
**Notes:** Also anonymized Stage 2 evaluator names as "Evaluator 1, 2, 3..."

### council-c31: stage1_collect_responses (P2)

**Status:** done
**Branch:** fix/council-c31-stage1-prompts
**Approach:** Extract system prompt to a module-level constant (shared with streaming variant). Add logging for failed models (`logger.warning` with model name). Add validation: if `effective_council` is empty, raise ValueError immediately instead of silently returning empty list.
**Alternatives considered:** (1) Separate prompts.py module — overkill for 2 prompts. (2) Move prompts to config — they're not user-configurable, they're implementation details.
**PR:** https://github.com/cameronsjo/llm-council/pull/13
**Notes:** Also merged streaming/non-streaming, extracted helpers, fixed falsy empty-list check.

### council-bw0: stage1_collect_responses_streaming (P2)

**Status:** done
**Branch:** fix/council-c31-stage1-prompts (bundled with council-c31)
**Approach:** Merge with `stage1_collect_responses` using a `streaming: bool = False` parameter and optional callbacks. The non-streaming path just doesn't pass callbacks to `query_models_progressive`. This eliminates 95% code duplication. The shared function uses `query_models_progressive` for both paths (it already falls back to gather-like behavior when no callbacks are provided).
**Alternatives considered:** (1) Keep separate functions — maintains clarity but 95% duplication is unacceptable. (2) Extract shared helper called by both — still 2 functions but less duplication. (3) Strategy pattern — over-engineered.
**PR:** https://github.com/cameronsjo/llm-council/pull/13
**Notes:** Bundled with council-c31. Used callback presence to auto-detect streaming mode.

### council-a0z: stage2_collect_rankings (P2)

**Status:** done
**Branch:** fix/council-a0z-stage2-labels
**Approach:** Fix label generation to handle 26+ models using AA, AB, AC... pattern. Extract ranking prompt to module-level constant. Add system message to ranking calls. Add logging for empty results. Keep existing ranking parsing logic (it works well enough).
**Alternatives considered:** (1) Limit to 26 models — artificial restriction. (2) Use numeric labels — less readable than letters. (3) Refactor parse_ranking_from_text — it works, don't fix what isn't broken.
**PR:** https://github.com/cameronsjo/llm-council/pull/14
**Notes:** Also updated parse_ranking_from_text regex to handle multi-letter labels, fixed falsy check to `is not None`, added system message. 17 new tests.

### council-1g6: run_full_council (P2)

**Status:** done
**Branch:** fix/council-1g6-remove-dead-code
**Approach:** Check if this is truly dead code — verify that only the non-streaming endpoint (`/api/conversations/{id}/message`) uses it and that the frontend never calls that endpoint. If confirmed dead, remove both `run_full_council` and the non-streaming endpoint. This also resolves council-8dz.
**Alternatives considered:** (1) Keep and fix — maintaining 2 code paths is a burden. (2) Make streaming path delegate to this — would require significant restructuring. (3) Mark as deprecated — half-measure.
**PR:** https://github.com/cameronsjo/llm-council/pull/12
**Notes:** Removed run_full_council (66 lines), non-streaming endpoint (51 lines), frontend sendMessage (20 lines), 4 unused imports. -144 lines total.

### council-8dz: send_message non-streaming (P2)

**Status:** done
**Branch:** fix/council-1g6-remove-dead-code (bundled with council-1g6)
**Approach:** Remove the non-streaming `/api/conversations/{id}/message` endpoint and `run_full_council`. Frontend only uses `/message/stream`. Confirm by searching frontend for the endpoint URL.
**Alternatives considered:** (1) Fix to use per-conversation config — work for dead code. (2) Keep as fallback — adds maintenance burden for unused code.
**PR:** https://github.com/cameronsjo/llm-council/pull/12
**Notes:** Bundled with council-1g6.

---

## GROUP 3: Frontend SSE + UI (P1 + P2)

### council-cwv: sendMessageStream frontend (P1)

**Status:** done
**Branch:** fix/council-cwv-sse-buffer
**Approach:** Add SSE buffer accumulation to handle chunks that split mid-JSON. Maintain a `buffer` string, append each chunk, then split on `\n\n` (SSE event boundary). Only parse complete events. This is the standard SSE parsing pattern. The AbortController and signal were already added in the recent useConversationStream refactor — verify this is done and mark as resolved if so. The 9-parameter issue was also addressed by the hook refactor (parameters are now spread across hook + api).
**Alternatives considered:** (1) Use EventSource API — doesn't support POST requests. (2) Use a library like `eventsource-parser` — adds a dependency for ~20 lines of code. (3) Keep current parsing — silently loses data on chunk boundaries.
**PR:** https://github.com/cameronsjo/llm-council/pull/10
**Notes:** Extracted readSSEStream() shared helper used by both sendMessageStream and extendDebateStream. 10 new vitest tests.

### council-75a: ChatInterface audit (P1)

**Status:** done
**Branch:** fix/council-75a-chatinterface-cleanup
**Approach:** The recent useConversationStream refactor already moved streaming state management out. Remaining issues: handleSubmit validation logic can be extracted to a pure function, attachment handling can be simplified. Focus on testability — extract pure validation/transformation functions. Don't restructure the component itself (that's a bigger refactor).
**Alternatives considered:** (1) Full component split — too large for one bead. (2) Extract to smaller components — risks prop drilling. (3) Just add tests for what's testable — pragmatic.
**PR:** https://github.com/cameronsjo/llm-council/pull/11
**Notes:** Extracted 5 pure functions to lib/messageUtils.js, 24 tests. Component reduced by ~99 lines.

### council-iux: Round component audit (P2)

**Status:** done
**Branch:** fix/council-iux-round-component
**Approach:** Extract de-anonymization logic to a pure utility function (takes raw text + label_to_model, returns text with model names bolded). This is currently inline in the component. Make it testable. Simplify legacy vs unified format handling — check if legacy format still needs support or if migration handles it.
**Alternatives considered:** (1) Rewrite component — too big. (2) Add prop-types/TypeScript — different concern. (3) Just document the complexity — doesn't fix testability.
**PR:** https://github.com/cameronsjo/llm-council/pull/16
**Notes:** Extracted 5 functions (deAnonymizeText, getResponseContent, getTabLabel, getModelDisplayName, getRoundCost) to lib/roundUtils.js. 23 tests.

### council-9hu: Sidebar component audit (P2)

**Status:** done
**Branch:** fix/council-9hu-sidebar-cleanup
**Approach:** The Sidebar delegates to ConversationItem for per-conversation logic. Main issue is mixed responsibilities. Extract config modal trigger and theme toggle into separate small components or hooks. Keep conversation list management in Sidebar. Focus on reducing prop count.
**Alternatives considered:** (1) Full decomposition — too many components. (2) Use context for shared state — over-engineering. (3) Just document — doesn't improve testability.
**PR:** https://github.com/cameronsjo/llm-council/pull/17
**Notes:** Extracted getUserInitial, getUserDisplayName, getThemeLabel to lib/sidebarUtils.js. 13 tests. Component already well-structured with sub-components.

---

## GROUP 4: Investigation Beads (P2)

### council-swr: Arena Mode deep dive

**Status:** pending
**Branch:** fix/council-swr-arena-audit
**Approach:** This is a research/documentation bead, not a code change. Trace the full arena execution path, grade every function, create arena-deep-dive.md similar to council-deep-dive.md. Create new beads for any bugs found. No code changes in this PR.
**Alternatives considered:** (1) Fix bugs as we find them — scope creep. (2) Skip the audit — miss important bugs.
**PR:**
**Notes:** Output is a document + potentially new beads.

### council-2yf: Websearch deep dive (BUG)

**Status:** pending
**Branch:** fix/council-2yf-websearch-audit
**Approach:** Trace the full websearch flow. Check: is Tavily API actually called? Does the context reach models? Does the frontend toggle work? We have existing tests in test_websearch.py — check those first. May result in fixes or just documentation of what's broken.
**Alternatives considered:** (1) Just remove websearch — drastic. (2) Replace Tavily with different provider — scope creep.
**PR:**
**Notes:** Check if existing tests pass first.

---

## GROUP 5: P3 Pure Extractions

### council-u91: Extract _build_partial_message_from_pending

**Status:** done
**Branch:** N/A (no code changes needed)
**Approach:** Verified function no longer exists after useConversationStream refactor.
**PR:** N/A
**Notes:** Resolved by prior refactor. Code removed entirely.

### council-4vt: Extract _build_partial_assistant_message

**Status:** done
**Branch:** N/A (no code changes needed)
**Approach:** Verified `buildAssistantMessage` already extracted to `conversationReducer.js`.
**PR:** N/A
**Notes:** Resolved by prior refactor.

### council-d1r: Extract _should_migrate_message predicate

**Status:** done
**Branch:** fix/council-d1r-storage-extractions
**Approach:** In `storage.py`, extract the migration logic predicate from `migrate_legacy_messages` into a standalone `_should_migrate_message(message)` function. Add test for it.
**Alternatives considered:** (1) Keep inline — it's a simple predicate, extraction may be overkill. (2) Remove migration entirely — risky if old data exists.
**PR:** https://github.com/cameronsjo/llm-council/pull/15
**Notes:** Bundled with council-bqa. 11 tests total.

### council-bqa: Extract _extract_conversation_metadata

**Status:** done
**Branch:** fix/council-d1r-storage-extractions (bundled with council-d1r)
**Approach:** In `storage.py`, extract the metadata extraction logic from `list_conversations` into `_extract_conversation_metadata(conversation)`. Add test.
**Alternatives considered:** (1) Keep inline — simpler. (2) Create a full serialization layer — overkill.
**PR:** https://github.com/cameronsjo/llm-council/pull/15
**Notes:** Added defensive .get() for missing messages key.

---

## Summary

| Bead | Group | Status | Approach |
|------|-------|--------|----------|
| council-o7u | 1 | pending | Shared client + retry + differentiated errors |
| council-dcv | 1 | pending | Share client + extract stream metadata |
| council-35i | 2 | pending | Anonymize stage3 chairman prompt |
| council-c31 | 2 | pending | Extract prompts + add logging |
| council-bw0 | 2 | pending | Merge streaming/non-streaming stage1 |
| council-a0z | 2 | pending | Fix 26+ labels + extract prompt |
| council-1g6 | 2 | pending | Remove dead code (with council-8dz) |
| council-8dz | 2 | pending | Remove non-streaming endpoint |
| council-cwv | 3 | pending | SSE buffer accumulation |
| council-75a | 3 | pending | Extract testable functions |
| council-iux | 3 | pending | Extract de-anonymization util |
| council-9hu | 3 | pending | Decompose mixed responsibilities |
| council-swr | 4 | pending | Arena audit document |
| council-2yf | 4 | pending | Websearch investigation |
| council-u91 | 5 | pending | Check if already resolved |
| council-4vt | 5 | pending | Check if already resolved |
| council-d1r | 5 | pending | Extract migration predicate |
| council-bqa | 5 | pending | Extract metadata extractor |
