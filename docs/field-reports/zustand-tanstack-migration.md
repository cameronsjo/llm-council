# Zustand + TanStack Query Migration — Field Report

**Date:** 2026-03-26
**Type:** architecture
**Project:** llm-council

## Goal

Replace vanilla React state management (13 `useState` hooks, manual fetch effects, 24-prop component interfaces) with Zustand for UI state and TanStack Query for server state. Motivated by the SSE resilience work, which exposed how fragile hand-rolled polling and manual cache invalidation are.

## Architecture

### Before: Everything in App.jsx

```
App.jsx (490 lines)
├── 13 useState hooks (conversations, config, mode, sidebar, auth, ...)
├── 4 manual fetch functions + useEffects (loadConversations, loadConfig, ...)
├── Manual setInterval polling for pending status
├── pendingPollRef with manual cleanup
├── 24 props → ChatInterface
├── 12 props → Sidebar
└── useConversationStream hook (streaming state)
```

### After: Three Layers

```
Zustand (useUIStore)           ← Transient UI state
├── mode, arenaRoundCount       (session preferences)
├── sidebarOpen                 (layout)
├── useWebSearch                (toggle)
├── currentConversationId       (selection)
├── pendingForkContext           (cross-conversation context)
└── authExpired                 (session health)

TanStack Query (hooks/queries.js) ← Server state
├── useConfig()                 (feature flags, model config)
├── useConversations()          (sidebar list)
├── useConversation(id)         (conversation detail)
├── usePendingStatus(id)        (polling via refetchInterval)
├── useAvailableModels()        (OpenRouter catalog, 5min stale)
├── useCuratedModels()          (user's pinned models)
├── useUserInfo()               (auth user metadata)
└── Mutations with auto-invalidation (create, delete, rename, config)

useConversationStream (unchanged) ← Streaming state
├── conversationReducer         (SSE event → state machine)
├── AbortController lifecycle   (cancellation)
└── _executeStream              (deduplicated handler, 51% reduction)
```

### What Stayed the Same

- **`conversationReducer.js`** — the streaming state machine. Already pure and well-structured. Zustand and TanStack wrap around it, they don't replace it.
- **`api.js`** — the API layer. TanStack Query calls it; we didn't duplicate or abstract it further.
- **SSE streaming** — not REST, can't use TanStack Query. The stream hook fires `invalidateQueries` on completion to sync the query cache.

## Decisions Made

### Zustand over Context/Redux

- No boilerplate (no Provider tree, no action creators, no reducers for simple state)
- Components import `useUIStore` directly — no prop drilling, no Context re-render cascades
- Selectors are just function calls: `useUIStore((s) => s.mode)`

### TanStack Query over manual fetching

The manual pattern was:
```javascript
const [data, setData] = useState(null);
useEffect(() => { fetchData().then(setData); }, [deps]);
// + manual error handling, loading state, refetch on mutation, stale detection
```

TanStack gives us:
- **Automatic caching** — `useConfig()` called from 3 components, fetched once
- **Polling** — `refetchInterval` replaces `setInterval` + `useRef` + cleanup (20 lines → 1 config key)
- **Invalidation** — mutations automatically invalidate related queries (`deleteConversation` → refetch conversations list)
- **Loading/error states** — `{ data, isLoading, error }` out of the box

### Kept old hooks temporarily

`useModels.js` and `useCuratedModels.js` were NOT deleted because `ModelCuration.jsx` (outside refactor scope) still imports them. TanStack equivalents exist in `queries.js` and are used by `ModelSelector.jsx`. The old hooks can be removed when `ModelCuration.jsx` is migrated.

## Gotchas

- **`refetchInterval` takes a function, not just a number.** To conditionally poll (only when pending and not stale), you return the interval or `false`:
  ```javascript
  refetchInterval: (query) => {
    const data = query.state.data;
    if (data?.pending && !data?.stale) return 5000;
    return false;
  }
  ```

- **Query invalidation from outside React components** requires `useQueryClient()` inside the hook, not a module-level client reference. We created `useStreamInvalidation()` as a hook that returns a callback.

- **Zustand store actions are stable references** — unlike `useState` setters wrapped in callbacks, Zustand's `set` doesn't cause unnecessary re-renders. This eliminated several `useCallback` wrappers.

- **TanStack Query's `enabled` flag** prevents queries from firing until their dependencies are ready. `useConversation(id)` with `enabled: !!id` prevents a fetch with `id=null`.

## Recommendations

1. **Split state by lifecycle, not by location.** UI state (mode, sidebar) changes on user interaction. Server state (conversations, config) changes on API calls. Streaming state (rounds, synthesis) changes on SSE events. Each layer has different caching, invalidation, and persistence needs.

2. **Start with TanStack Query for reads, Zustand for the rest.** Don't try to put everything in one store. TanStack handles caching/staleness/polling automatically. Zustand handles the stuff TanStack can't (synchronous UI state, cross-component flags).

3. **Keep the reducer for streaming.** SSE events are a state machine — each event transitions state based on the current shape. That's what reducers are for. Don't fight it.

4. **Invalidate, don't refetch.** After a mutation, call `invalidateQueries` and let TanStack decide when to refetch (immediately if a component is mounted and watching, lazily otherwise). Don't manually call `refetch()`.

## Key Takeaways

- The migration was surgical — 15 files changed, but each change was mechanical (move state source, remove prop, add import)
- Prop drilling from 24 to 13 (ChatInterface) and 12 to 2 (Sidebar) made the component interfaces dramatically clearer
- The `useConversationStream` deduplication (423 → 206 lines) was an independent win — extract a generic stream executor, make each handler a thin delegate
- TanStack Query's `refetchInterval` replaced the exact manual polling code that was buggy in the SSE resilience investigation — the bug that started this whole session
- Total state management code decreased despite adding two new libraries — Zustand and TanStack Query replace more code than they add
