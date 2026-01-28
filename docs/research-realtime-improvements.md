# Research: Real-Time Improvements for LLM Council

## Executive Summary

The current LLM Council implementation uses Server-Sent Events (SSE) for streaming but operates in a **stage-blocking pattern** where users must wait for **all models** to complete before seeing any results. This research identifies specific improvements to reduce perceived latency from 30+ seconds to under 1 second for first response visibility.

## Current Architecture Analysis

### How Streaming Works Today

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Current Event Flow                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  User Query                                                          │
│      ↓                                                               │
│  [web_search_start] ──────────────────────────────────► (2-5s wait)  │
│  [web_search_complete]                                               │
│      ↓                                                               │
│  [stage1_start] ──────► Query ALL models in parallel                 │
│                              ↓                                       │
│                         Wait for SLOWEST model ────────► (10-30s)    │
│                              ↓                                       │
│  [stage1_complete] ──► Send ALL responses at once                    │
│      ↓                                                               │
│  [stage2_start] ──────► Query ALL models in parallel                 │
│                              ↓                                       │
│                         Wait for SLOWEST model ────────► (10-30s)    │
│                              ↓                                       │
│  [stage2_complete] ──► Send ALL rankings at once                     │
│      ↓                                                               │
│  [stage3_start] ──────► Query chairman                               │
│                              ↓                                       │
│  [stage3_complete] ──► Send synthesis                                │
│      ↓                                                               │
│  [complete]                                                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

Total perceived wait: 30-90 seconds before seeing ANYTHING useful
```

### Key Files

| File | Responsibility |
|------|----------------|
| `backend/main.py:549-724` | SSE event generator for council mode |
| `backend/council.py` | Stage functions using `asyncio.gather()` |
| `backend/openrouter.py:100-152` | Parallel model queries (blocking) |
| `frontend/src/api.js:301-368` | SSE consumption |
| `frontend/src/App.jsx` | State updates on events |

### Current Bottlenecks

1. **`asyncio.gather()` waits for ALL tasks** in `query_models_parallel()`
2. **No OpenRouter streaming** - full responses fetched at once
3. **Sequential stage execution** - Stage 2 waits for complete Stage 1
4. **Heavy event payloads** - entire stage data sent in one event

---

## Improvement Opportunities

### 1. Per-Model Progressive Streaming (HIGH IMPACT)

**Problem**: Users wait for slowest model even when fast models respond in <1s.

**Solution**: Stream each model response as it arrives using `asyncio.as_completed()`.

**Current code** (`openrouter.py:136-141`):
```python
responses = await asyncio.gather(*tasks)  # Waits for ALL
result = dict(zip(models, responses))
```

**Proposed code**:
```python
async def query_models_streaming(models, messages, on_model_complete):
    """Query models and stream results as each completes."""
    tasks = {
        asyncio.create_task(query_model(model, messages)): model
        for model in models
    }

    for completed in asyncio.as_completed(tasks.keys()):
        result = await completed
        model = tasks[completed]
        await on_model_complete(model, result)
```

**New event flow**:
```
[stage1_start]
[stage1_model_response] → {model: "gpt-4o", response: "...", index: 1, total: 5}
[stage1_model_response] → {model: "claude-opus", response: "...", index: 2, total: 5}
[stage1_progress] → {completed: 2, total: 5, pending: ["gemini-2", ...]}
...
[stage1_complete] → {all_responses: [...]}
```

**Impact**: First response visible in ~500ms-2s instead of 30s.

---

### 2. OpenRouter Token Streaming (HIGH IMPACT)

**Problem**: Model responses arrive as complete blocks, not progressively.

**Discovery**: OpenRouter supports SSE streaming with `stream: true`.

```python
# Current request
payload = {
    "model": model,
    "messages": messages,
}

# Streaming request
payload = {
    "model": model,
    "messages": messages,
    "stream": True,  # Enable SSE
}
```

**OpenRouter streaming response format**:
```
data: {"choices":[{"delta":{"content":"The "}}]}
data: {"choices":[{"delta":{"content":"answer "}}]}
data: {"choices":[{"delta":{"content":"is..."}}]}
data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":50,"completion_tokens":100}}
data: [DONE]
```

**Proposed implementation**:
```python
async def query_model_streaming(model, messages, on_token):
    """Stream tokens from a model via OpenRouter."""
    payload = {"model": model, "messages": messages, "stream": True}

    async with httpx.AsyncClient() as client:
        async with client.stream("POST", OPENROUTER_API_URL,
                                  headers=headers, json=payload) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: ") and line != "data: [DONE]":
                    data = json.loads(line[6:])
                    if delta := data["choices"][0].get("delta", {}).get("content"):
                        await on_token(delta)
```

**Frontend rendering**: Append tokens to model tab in real-time.

---

### 3. Early Web Search Parallelization (MEDIUM IMPACT)

**Problem**: Web search blocks model queries.

**Current**:
```
[web_search_start] ─────────────────► [web_search_complete]
                                                ↓
                                      [stage1_start] ──► query models
```

**Proposed**:
```
[web_search_start] ───────────────────────────────────► [web_search_complete]
         ↓ (immediately)                                          ↓
[stage1_start] ──► query models (without context)      [inject search context]
```

**Strategy**: Start model queries immediately, then append web search context to later stages or re-query with context.

---

### 4. Stage Pipelining (MEDIUM IMPACT, HIGH COMPLEXITY)

**Problem**: Stage 2 waits for complete Stage 1.

**Proposed**: Begin Stage 2 rankings for early-arriving responses.

```
Model A responds at t=1s → Start Stage 2 ranking for A
Model B responds at t=2s → Start Stage 2 ranking for A,B
Model C responds at t=3s → Start Stage 2 ranking for A,B,C
Model D responds at t=30s → Complete all rankings
```

**Complexity**: High - requires careful synchronization and may affect ranking quality.

---

### 5. Rich Progress Events (LOW-MEDIUM IMPACT)

**Problem**: Users only see "Loading..." with no context.

**Proposed new events**:
```json
{
  "type": "stage1_progress",
  "data": {
    "completed": 2,
    "total": 5,
    "elapsed_ms": 3500,
    "completed_models": ["openai/gpt-4o", "anthropic/claude-sonnet"],
    "pending_models": ["google/gemini-2", "meta/llama-3"],
    "fastest_model": "openai/gpt-4o",
    "fastest_latency_ms": 1200
  }
}
```

**Frontend enhancement**: Progress bar, model status indicators, ETA display.

---

### 6. Per-Model Cancellation (LOW-MEDIUM IMPACT)

**Problem**: One slow model blocks entire stage.

**Solution**: Allow users to skip waiting for specific models.

```
Frontend: "Model X is taking long. [Skip this model]"
         ↓
Backend: Cancel task, continue with available responses
```

---

### 7. Incremental Metrics (LOW IMPACT)

**Problem**: All metrics calculated after Stage 3.

**Proposed**: Stream metrics as they become available.

```json
{"type": "metrics_partial", "data": {"stage": 1, "models": 2, "tokens": 2500, "cost": 0.01}}
```

---

## Implementation Priority Matrix

| Improvement | Impact | Effort | Priority |
|-------------|--------|--------|----------|
| Per-model progressive streaming | HIGH | MEDIUM | **P0** |
| OpenRouter token streaming | HIGH | MEDIUM | **P0** |
| Rich progress events | MEDIUM | LOW | **P1** |
| Web search parallelization | MEDIUM | LOW | **P1** |
| Per-model cancellation | MEDIUM | MEDIUM | **P2** |
| Stage pipelining | MEDIUM | HIGH | **P3** |
| Incremental metrics | LOW | LOW | **P3** |

---

## Recommended Implementation Plan

### Phase 1: Quick Wins (1-2 days)

1. **Add progress events** - Simple addition to existing stage loops
2. **Frontend progress UI** - Show pending models, elapsed time

### Phase 2: Progressive Model Streaming (3-5 days)

1. **Refactor `query_models_parallel`** to use `asyncio.as_completed()`
2. **Add `stage1_model_response` events** for each model completion
3. **Update frontend** to render tabs progressively
4. **Handle partial state** during streaming

### Phase 3: Token Streaming (5-7 days)

1. **Implement OpenRouter streaming** in `openrouter.py`
2. **Add token-level events** through SSE
3. **Frontend streaming renderer** with typewriter effect
4. **Handle streaming + parallel** coordination

### Phase 4: Advanced Optimizations (ongoing)

1. Web search parallelization
2. Per-model cancellation
3. Stage pipelining experiments

---

## Technical Considerations

### Backend Changes Required

```python
# New function signature
async def query_models_streaming(
    models: list[str],
    messages: list[dict],
    on_model_start: Callable[[str], Awaitable[None]],
    on_model_token: Callable[[str, str], Awaitable[None]],
    on_model_complete: Callable[[str, dict], Awaitable[None]],
) -> dict[str, dict]:
    """Query models with progressive streaming callbacks."""
    ...
```

### Frontend Changes Required

1. **Streaming state management** - Separate from conversation state
2. **Progressive tab rendering** - Show tabs as responses arrive
3. **Token accumulation** - Append chunks to response content
4. **Optimistic UI** - Show placeholders for pending models

### SSE Considerations

1. **Event ordering** - Model responses may arrive out of order
2. **Backpressure** - Handle slow clients gracefully
3. **Reconnection** - Resume from partial state on disconnect
4. **Buffering** - Browser SSE buffers may delay small events

---

## Expected Outcomes

| Metric | Current | After Phase 2 | After Phase 3 |
|--------|---------|---------------|---------------|
| Time to first response | 30-90s | ~1s | ~200ms |
| Time to first token | N/A | ~1s | ~200ms |
| Perceived responsiveness | Poor | Good | Excellent |
| User feedback during wait | Minimal | Model progress | Token-by-token |

---

## Appendix: OpenRouter Streaming Reference

Based on research, OpenRouter SSE streaming:

- Enable with `stream: true` in request body
- Returns chunks as `data: {...}` events
- Content in `choices[0].delta.content`
- Usage stats in final chunk before `[DONE]`
- Occasional comment payloads (ignore per SSE spec)

**Sources**:
- [OpenRouter Streaming Docs](https://openrouter.ai/docs/api/reference/streaming)
- [OpenRouter API Reference](https://openrouter.ai/docs/api/reference/overview)
- [OpenRouter FAQ](https://openrouter.ai/docs/faq)

---

## Conclusion

The most impactful improvement is **per-model progressive streaming**, which transforms the user experience from waiting 30+ seconds with no feedback to seeing the first response within 1-2 seconds. Combined with OpenRouter token streaming, this creates a truly real-time chat experience comparable to direct LLM interfaces.

The implementation is straightforward using Python's `asyncio.as_completed()` pattern and requires minimal changes to the existing SSE infrastructure.
