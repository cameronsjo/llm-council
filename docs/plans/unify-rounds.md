# Plan: Unify Council Stages with Arena Rounds

## Goal

Replace the hardcoded `stage1`/`stage2`/`stage3` structure in Council mode with a flexible `rounds[]` array that matches Arena mode, enabling shared components and data models.

## Unified Data Model

```python
@dataclass
class Round:
    """A single round of deliberation (works for both modes)."""
    round_number: int
    round_type: str  # "responses" | "rankings" | "opening" | "rebuttal" | "closing"
    responses: list[dict]  # Participant responses
    metadata: dict | None = None  # Round-specific data (label_to_model, aggregate_rankings)
    metrics: dict | None = None

@dataclass
class Synthesis:
    """Final synthesis from chairman (both modes)."""
    model: str
    content: str
    metrics: dict | None = None

# Stored message structure (both modes)
{
    "role": "assistant",
    "mode": "council" | "arena",
    "rounds": [...],
    "synthesis": {...},
    "participant_mapping": {...},  # Maps "Response A" -> model or "Participant A" -> model
    "metrics": {...}
}
```

## Council Mode Mapping

| Old Structure | New Structure |
|--------------|---------------|
| `stage1: [...]` | `rounds[0]` with `round_type: "responses"` |
| `stage2: [...]` | `rounds[1]` with `round_type: "rankings"`, metadata includes `label_to_model`, `aggregate_rankings` |
| `stage3: {...}` | `synthesis: {...}` |

## Implementation Steps

### Phase 1: Backend Models

1. **Create `backend/deliberation/deliberation.py`** with unified dataclasses
2. **Update `council.py`** to return unified structure
3. **Update `arena.py`** to use same structure (already close)
4. **Update `main.py`** SSE events to use consistent event types

### Phase 2: Storage Migration

1. **Update `storage.py`** to write new format
2. **Add migration function** to convert old conversations on read
3. Keep backward-compatible read (detect old format, convert on-the-fly)

### Phase 3: API Events

Unify streaming events:
```
# Both modes
round_start -> {round_number, round_type}
round_complete -> {round_number, round_type, responses, metadata?}
synthesis_start
synthesis_complete -> {model, content}
```

### Phase 4: Frontend

1. **Create `components/Round.jsx`** - unified round display
2. **Create `components/Synthesis.jsx`** - unified synthesis display
3. **Update `App.jsx`** to use new components for both modes
4. **Deprecate** Stage1.jsx, Stage2.jsx, Stage3.jsx, ArenaRound.jsx (or keep as wrappers)

## Files to Modify

### Backend
- `backend/deliberation/` - New unified data models package
- `backend/council.py` - Return unified structure
- `backend/arena.py` - Align with unified structure
- `backend/main.py` - Store in unified format
- `backend/storage.py` - New format + lazy migration on read

### Frontend
- `frontend/src/App.jsx` - Use unified components
- `frontend/src/components/Round.jsx` (new)
- `frontend/src/components/Synthesis.jsx` (new)
- `frontend/src/components/RoundTabs.jsx` (new) - Tabbed responses within a round

## Risks & Mitigations

1. **Breaking existing conversations**: Migration function handles this
2. **Complex merge**: Work in feature branch, test thoroughly
3. **UI regression**: Keep old components as fallback initially

## Success Criteria

- [ ] Both modes use `rounds[]` array
- [ ] Single `Round` component renders both council and arena rounds
- [ ] Existing conversations still load correctly
- [ ] No UI regression in either mode
- [ ] Reduced code duplication
