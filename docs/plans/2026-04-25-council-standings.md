# Council Standings — Persistent ELO Ratings

## Context

Every Council Stage 2 round produces rich peer-review signal: each model ranks all the others. Today that signal evaporates the moment the conversation renders. We can capture it cheaply and turn it into a longitudinal scoreboard — a "Standings" page that shows which models actually win the most peer reviews over time, and how individual models trend as their providers ship updates.

**Why now:** the data is already shaped for this. `stage2_collect_rankings()` returns per-voter parsed rankings, and `calculate_aggregate_rankings()` already computes per-round summaries. We just need to persist the underlying pairwise comparisons and replay them as ELO ratings.

**Intended outcome:** a new "Standings" view in the frontend backed by two new endpoints, fed by a single tap point in the council stream pipeline. No changes to the existing council flow, no schema migrations to existing storage.

---

## Architecture

```text
Stage 2 result (council_stream.py:324)
        ↓
record_stage2_matches()  ← new: extract pairwise comparisons, append to JSONL, update ratings
        ↓
data/[users/{u}/]rankings/
    matches.jsonl   ← append-only source of truth, one comparison per line
    ratings.json    ← derived current state, atomic-write
        ↓
GET /api/rankings           → leaderboard from ratings.json
GET /api/rankings/history   → time series replayed from matches.jsonl
        ↓
Standings.jsx (table + recharts trend)
```

**Scoring system:** ELO with K=32, initial rating 1500. Each Stage 2 round emits `V × C(N,2)` pairwise updates where V = voters, N = models — typically 4 voters × 6 pairs = 24 updates per round.

**Per-user isolation** mirrors the existing conversation storage pattern via `user_id` parameter on every storage function.

---

## Backend Changes

### New: `backend/elo.py`
Pure-functions module. No I/O. Exports:
- `INITIAL_RATING = 1500`, `K_FACTOR = 32`
- `expected_score(rating_a, rating_b) -> float`
- `update_pair(rating_a, rating_b, score_a) -> tuple[float, float]` — returns new ratings
- `extract_pairwise(parsed_ranking, label_to_model) -> list[tuple[str, str]]` — `[(winner_model, loser_model), ...]` from a ranking list

### New: `backend/rankings_storage.py`
Mirrors `storage.py` patterns: `user_id` param, fcntl locking, atomic-write via tempfile+rename. Exports:
- `record_stage2_matches(stage2_results, label_to_model, conversation_id, user_id)` — main entry point
  - For each voter's `parsed_ranking`, extract pairwise comparisons
  - Append all to `matches.jsonl` (single fcntl-locked append)
  - Update `ratings.json` (read-modify-write under same lock)
- `load_ratings(user_id) -> dict` — leaderboard data
- `replay_history(user_id, model_filter=None) -> dict[str, list[dict]]` — walks JSONL, returns `{model_id: [{ts, rating, games}, ...]}` per-model snapshots

**Match record schema** (one JSON object per line):

```json
{"ts": "2026-04-25T18:52:00Z", "conversation_id": "abc", "voter": "openai/gpt-5.1", "winner": "anthropic/claude-opus", "loser": "google/gemini-pro"}
```

**Ratings file schema:**
```json
{
  "version": 1,
  "ratings": {
    "openai/gpt-5.1": {"rating": 1532.4, "games": 48, "last_updated": "2026-04-25T18:52:00Z"}
  }
}
```

### Tap point: `backend/council_stream.py:324-329`
After `aggregate_rankings = calculate_aggregate_rankings(...)`, add:
```python
try:
    record_stage2_matches(stage2_results, label_to_model, conversation_id, user_id)
except Exception as exc:
    logger.warning("rankings persist failed: %s", exc)  # never break the stream
```
Wrapped in try/except — rankings persistence must never fail the streaming response.

### New endpoints in `backend/main.py`
Inserted after the conversations block (~line 543), following existing route conventions:

```python
@app.get("/api/rankings")
async def get_rankings(user: User | None = Depends(get_optional_user)) -> dict
    # Returns sorted leaderboard: [{model, rating, games, rank, last_updated}, ...]

@app.get("/api/rankings/history")
async def get_rankings_history(
    model: str | None = None,
    user: User | None = Depends(get_optional_user)
) -> dict
    # Returns {history: {model: [{ts, rating, games}, ...]}} — all models, or filtered to one
```

Both readonly, both honor `user_id = user.username if user else None`.

---

## Frontend Changes

### 1. New dependency
`cd frontend && npm install recharts` — line/area charts, ~80KB gzipped, declarative React API.

### 2. `frontend/src/stores/uiStore.js`
Add view-switching state:
```javascript
currentView: 'chat',  // 'chat' | 'standings'
setCurrentView: (view) => set({ currentView: view }),
```

### 3. `frontend/src/api.js`
Add to the `api` export object:
```javascript
async getRankings() { return fetchJSON(`${API_BASE}/api/rankings`, {}, 'Failed to get rankings'); },
async getRankingsHistory(model) {
  const qs = model ? `?model=${encodeURIComponent(model)}` : '';
  return fetchJSON(`${API_BASE}/api/rankings/history${qs}`, {}, 'Failed to get rankings history');
},
```

### 4. `frontend/src/hooks/queries.js`
Mirror existing query hook style:
```javascript
export function useRankings() {
  return useQuery({ queryKey: ['rankings'], queryFn: api.getRankings, staleTime: 30_000 });
}
export function useRankingsHistory(model) {
  return useQuery({
    queryKey: ['rankingsHistory', model],
    queryFn: () => api.getRankingsHistory(model),
    staleTime: 30_000,
  });
}
```

### 5. `frontend/src/components/Sidebar.jsx`
Add a nav row above the conversations list — two buttons: "Chat" and "Standings" — that call `setCurrentView`. Use existing CSS-variable styling (`--color-burgundy` for the active state).

### 6. `frontend/src/App.jsx`
Conditional render at the existing render point (~line 312):
```jsx
{currentView === 'standings' ? <Standings /> : <ChatInterface ... />}
```

### 7. New: `frontend/src/components/Standings.jsx` + `Standings.css`
Two sections, both wrapped in the existing `.app` content container:
- **Leaderboard table** — columns: rank, model, rating, games, last updated. Sortable by rating (default desc). Empty state when no matches yet.
- **Trend chart** — recharts `<LineChart>` with one line per model, x-axis = match number (or timestamp if reasonable), y-axis = rating. Click a row in the table to filter to a single model.

Use stage tokens from `index.css` for line colors so the chart fits the existing palette.

---

## Testing

New test files mirroring existing pytest layout:

- `tests/test_elo.py` — pure math. Verify `expected_score` symmetry, `update_pair` zero-sum property, K=32 calibration on known examples.
- `tests/test_rankings_storage.py` — JSONL append idempotency under concurrent writes (use `_pending_lock` style fixture), ratings.json replay equivalence (replaying the log produces the same ratings as live updates).
- `tests/test_rankings_api.py` — endpoint smoke: empty state returns `{}`, after one round leaderboard is sorted, history endpoint returns time series.

No frontend tests (existing project has none for components).

---

## Verification

End-to-end check after implementation:

1. **Backend unit tests pass:** `make test` (or `uv run pytest tests/test_elo.py tests/test_rankings_storage.py tests/test_rankings_api.py -v`)
2. **Live integration:**
   - `make dev`
   - Open http://localhost:5173, run a Council round with 4 models
   - Inspect `data/rankings/matches.jsonl` — should have 24 lines (4 voters × 6 pairs)
   - Inspect `data/rankings/ratings.json` — 4 models, all with `games > 0`, ratings sum to ~6000 (zero-sum invariant ± float drift)
   - Click "Standings" in sidebar — leaderboard renders sorted by rating
   - Run a second Council round — leaderboard updates, trend chart shows two data points per model
3. **Auth-mode isolation:** with `LLMCOUNCIL_AUTH_ENABLED=true`, two simulated users see independent leaderboards (run from different `Remote-User` headers, verify `data/users/{u}/rankings/` directories exist separately).
4. **Failure isolation:** delete write permissions on the rankings dir mid-run; the council stream still completes successfully (warning in logs, no SSE error).

---

## Out of Scope (YAGNI for v1)

- **Backfilling historical conversations** — possible by re-reading existing JSON files but adds replay logic and edge cases. Punt to a one-shot CLI script later if useful.
- **Arena Mode scoring** — debate rounds aren't ranked the same way. Separate design.
- **Confidence intervals / Glicko-2** — ELO with K=32 is good enough until we have thousands of rounds.
- **Voter-trust weighting** — circular and unjustified by current data.
- **Model deprecation handling** — no UI to hide retired models. Add when it actually annoys us.

---

## Critical Files

**Modify:**
- `backend/council_stream.py` — single tap point, ~5 lines added
- `backend/main.py` — two new endpoints
- `frontend/src/api.js` — two new methods
- `frontend/src/hooks/queries.js` — two new hooks
- `frontend/src/stores/uiStore.js` — `currentView` slice
- `frontend/src/components/Sidebar.jsx` — nav row
- `frontend/src/App.jsx` — conditional render

**Create:**
- `backend/elo.py` — pure ELO math
- `backend/rankings_storage.py` — JSONL + ratings persistence
- `frontend/src/components/Standings.jsx` + `Standings.css`
- `tests/test_elo.py`
- `tests/test_rankings_storage.py`
- `tests/test_rankings_api.py`

**Reuse (no changes):**
- `backend/council.py:621-661` — `calculate_aggregate_rankings()` already returns per-round summary; ELO module consumes the same `stage2_results` + `label_to_model` shape
- `backend/storage.py:557-597` — fcntl locking + atomic write pattern, copied not abstracted
- `backend/auth.py:185-197` — `get_optional_user` dependency wired identically
