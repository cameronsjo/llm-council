# Frontend Refactor Plan

**Status: COMPLETED** (2024-12-20)

## Problem Statement

The model-related components had significant code duplication and poor separation of concerns:

- `ModelSelector.jsx` (382 lines) and `ModelCuration.jsx` (360 lines) shared ~80% identical logic
- Business logic (filtering, grouping, formatting) mixed with UI rendering
- No reusable hooks for common patterns (fetching, filtering, expansion state)
- Sidebar.jsx (281 lines) had too many responsibilities

## Final Structure

```
frontend/src/
├── api.js                          # Existing - API client
├── hooks/
│   ├── index.js                   # Barrel export
│   ├── useModels.js               # Fetch & cache available models
│   ├── useCuratedModels.js        # CRUD for curated models
│   ├── useModelFiltering.js       # Search, filter, group logic
│   └── useExpandableGroups.js     # Expand/collapse state
├── lib/
│   └── models.js                  # Constants & utilities
├── components/
│   ├── models/
│   │   ├── index.js               # Barrel export
│   │   ├── ModelSearchBox.jsx     # Search input with clear
│   │   ├── FilterChips.jsx        # Filter chip bar
│   │   └── ModelGroups.jsx        # Model list with ModelItem, ModelGroupHeader
│   ├── sidebar/
│   │   ├── index.js               # Barrel export
│   │   ├── ConversationItem.jsx   # Single conversation with actions
│   │   └── CouncilDisplay.jsx     # Council members section
│   ├── ModelSelector.jsx          # Refactored - 196 lines
│   ├── ModelCuration.jsx          # Refactored - 152 lines
│   └── Sidebar.jsx                # Refactored - 111 lines
```

## Results

| File | Before | After | Reduction |
|------|--------|-------|-----------|
| `ModelSelector.jsx` | 382 | 196 | **-49%** |
| `ModelCuration.jsx` | 360 | 152 | **-58%** |
| `Sidebar.jsx` | 281 | 111 | **-60%** |
| **Total** | **1,023** | **459** | **-55%** |

## Completed Phases

### Phase 1: Extract Shared Logic ✓

Created reusable hooks:
- `useModels()` - Fetch available models with loading/error states
- `useCuratedModels()` - CRUD operations with optimistic updates
- `useModelFiltering()` - Search, filter chips, grouping, sorting
- `useExpandableGroups()` - Expand/collapse state management

Created utility library:
- `lib/models.js` - MAJOR_PROVIDERS, formatPrice, getDisplayName, etc.

### Phase 2: Extract UI Components ✓

Created shared components:
- `ModelSearchBox` - Search input with clear button
- `FilterChips` - Filter chip bar (major providers, free only, curated)
- `ModelGroups` - Provider-grouped model list
- `ModelItem` - Individual model row (checkbox/star variants)
- `ModelGroupHeader` - Collapsible provider header with counts

### Phase 3: Refactor Main Components ✓

- `ModelSelector.jsx` now uses hooks + shared components
- `ModelCuration.jsx` now uses hooks + shared components
- Zero code duplication between the two

### Phase 4: Sidebar Decomposition ✓

- `ConversationItem` - Handles rename/delete with own state
- `CouncilDisplay` - Council members section with expand/collapse
- `Sidebar.jsx` - Thin coordinator component

### Phase 5: CSS Consolidation

**Skipped** - Another developer is working on CSS improvements separately.

## Benefits Achieved

1. **Single source of truth** - Model utilities defined once
2. **Testable in isolation** - Each hook can be unit tested
3. **Feature changes in one place** - Adding model features = change one file
4. **Clear separation of concerns** - Data fetching, business logic, UI all separate
5. **Reusable components** - ModelGroups, FilterChips work for any model list
6. **Smaller components** - Each file is focused and readable
