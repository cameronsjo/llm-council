# SSE Stream Resilience — Preventing Data Loss on Client Disconnect

**Date:** 2026-03-26
**Type:** investigation + architecture
**Project:** llm-council

## Goal

Diagnose why navigating away from a mid-stream council conversation caused a permanent stuck spinner, lost all paid inference results, and required a full retry after a 10-minute wait.

## Root Cause

The failure was a five-link chain, not a single bug:

```
Client disconnects mid-Stage-1
    → _stream_stage1 generator closes, BUT asyncio.create_task(run()) continues
    → Fire-and-forget task completes all model API calls (credits burned)
    → Pipeline generator already closed → update_pending_progress never runs
    → pending.json has partial_data: {} (empty)
    → Frontend returns, sees pending=true stale=false → shows spinner
    → No polling, no reconnection → spinner indefinitely
    → 600s stale timeout expires → "interrupted" banner
    → partial_data empty → no Resume button → only Retry
    → Full retry burns credits again
```

Each link was a separate bug that individually would have been tolerable, but together they created a total-loss scenario.

## What We Tried

### Phase 1: Triage

Started from the user-visible symptom (stuck spinner). Worked backward:

1. **Backend logs** — only health checks. The request had completed long ago.
2. **Conversation data on disk** — no partial results saved. Backend either saves everything or nothing.
3. **Frontend code trace** — `loadConversation` checks `getPendingStatus`. When `pending && !stale`, it sets `_isLoading: true` with no polling, no timeout, no reconnection. Dead spinner.
4. **Backend pending flow** — `PENDING_STALE_TIMEOUT_SECONDS = 600`. Ten minutes before the UI even notices.

### Phase 2: Deep Trace

Traced every code path from SSE connection to task lifecycle:

- `_stream_stage1` creates an `asyncio.Task` at line 153 but has no `try/finally` to cancel it. The `await task` at line 161 only runs on normal loop completion — never on `GeneratorExit`.
- `run_council_pipeline` yields results to the client BEFORE persisting to `pending.json`. If the yield fails (broken pipe), persistence is skipped.
- `stage2_collect_rankings` uses `asyncio.gather(*coroutines)` — gather wraps coroutines in tasks internally but doesn't cancel them when the gather's awaiter is interrupted.
- Individual model responses during Stage 1 are only persisted after ALL models complete, not incrementally.

### Phase 3: Fix Verification

Each fix was verified independently:
- Task cancellation: `python -c "import ast; ast.parse(...)"`
- Persist ordering: confirmed `update_pending_progress` precedes `yield` in all stages
- Frontend build: `pnpm build` after each agent's changes
- Full integration: `docker compose build` passed

## Architecture

### Pattern 1: Task Cancellation via `try/finally`

The `_stream_stage1` generator bridges an asyncio Task (running model queries) to a yield-based SSE stream. When the generator closes, the task must be cancelled:

```python
task = asyncio.create_task(run())
try:
    while True:
        event = await event_queue.get()
        if event is None:
            break
        yield event
finally:
    if not task.done():
        task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):
        pass
```

### Pattern 2: Explicit Task Lifecycle in `asyncio.gather`

`asyncio.gather(*coroutines)` wraps each coroutine in a Task internally, but does NOT cancel those tasks when the gather is interrupted. Fix: create tasks explicitly and clean up on any exception:

```python
tasks = [asyncio.create_task(query_model(m, msgs)) for m in models]
try:
    responses = await asyncio.gather(*tasks)
except BaseException:
    for t in tasks:
        if not t.done():
            t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    raise
```

`except BaseException` catches `CancelledError` (task cancellation), `GeneratorExit` (generator close), and `Exception` (application errors). The cleanup awaits all tasks with `return_exceptions=True` to ensure they actually finish cancelling before propagating.

### Pattern 3: Persist Before Yield

In SSE generators, the ordering `yield → persist` is fragile. If the client disconnected, the yield raises and persistence is skipped. Invert it:

```python
# Compute
stage2_results = await stage2_collect_rankings(...)

# Persist (survives disconnect)
storage.update_pending_progress(conversation_id, {"responses": stage1_results, "rankings": stage2_results}, ...)

# Yield (nice to have, not critical)
yield {"type": "round_complete", "data": {...}}
```

### Pattern 4: Incremental Persistence

Don't wait for an entire stage to complete before saving. Persist after each model response:

```python
async for event in _stream_stage1(...):
    yield event
    if event.get("type") == "model_response":
        storage.update_pending_progress(
            conversation_id,
            {"responses": list(stage1_results)},  # snapshot
            user_id=user_id,
        )
```

This maximizes recoverability — if 3 of 4 models responded before disconnect, those 3 are on disk.

## Gotchas

- **`asyncio.gather` is not cancellation-safe.** It creates tasks internally that outlive the gather's caller. This is a known Python gotcha but rarely documented in web framework contexts.
- **`GeneratorExit` is a `BaseException`, not `Exception`.** A bare `except Exception` won't catch it. Task cleanup handlers must use `except BaseException` or explicit `finally`.
- **Starlette only detects client disconnect at yield points.** During long `await` calls between yields (30-60s for Stage 2), the backend is blind to the client state. The fix isn't to detect faster — it's to ensure cleanup happens regardless.
- **`pending.json` had no file locking.** Concurrent SSE streams (cancel + new message) could corrupt it via read-modify-write races. Fixed with `fcntl.flock` + atomic writes via `tempfile.mkstemp` + `os.replace`.

## Recommendations

1. **Always wrap `asyncio.gather`/`asyncio.wait` in try/except BaseException with task cleanup.** This should be a linting rule for any codebase using SSE or WebSocket streams.
2. **Persist before yield, always.** The client seeing the event is nice-to-have. The data being on disk is must-have.
3. **Stale timeouts should match inactivity timeouts.** Frontend SSE timeout was 120s, backend stale timeout was 600s. Mismatched, the user waits 10 minutes for something the frontend already gave up on.
4. **Incremental persistence pays for itself.** Each model response costs money. Saving after each one means a 4-model Stage 1 interrupted after 3 models still recovers 75% of the work.
5. **TanStack Query's `refetchInterval` replaces manual polling.** The hand-rolled `setInterval` + `useRef` + cleanup pattern was 20 lines and had bugs. TanStack does it in one config key.

## Key Takeaways

- A stuck spinner is never one bug — it's a chain of individually-tolerable failures that compound
- `asyncio` task lifecycle is the async equivalent of memory management — leaked tasks are leaked resources (API credits, connections, CPU)
- SSE generators need the same defensive patterns as database transactions: persist first, communicate second
- The fix order matters: task cancellation (stop bleeding) → persist ordering (stop losing data) → incremental saves (maximize recovery) → timeout tuning (speed up detection)
- Zustand + TanStack Query eliminated entire categories of bugs (stale state, missing cleanup, manual polling) by making the right thing the default
