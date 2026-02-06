import { useMemo, useState } from 'react';
import {
  MAJOR_PROVIDERS,
  groupModelsByProvider,
  sortProviders,
} from '../lib/models';

/**
 * Default filter state.
 */
const DEFAULT_FILTERS = {
  showMajorOnly: false,
  showFreeOnly: false,
  showCuratedOnly: false,
  minContext: 0,
  selectedProviders: new Set(), // empty = show all
};

/**
 * Hook for filtering, searching, and grouping models.
 *
 * @param {Array} models - Array of model objects to filter
 * @param {Set} curatedIds - Set of curated model IDs (for curated filter)
 * @param {Object} initialFilters - Initial filter state overrides
 * @returns {Object} Filtering state and controls
 */
export function useModelFiltering(
  models = [],
  curatedIds = new Set(),
  initialFilters = {}
) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showMajorOnly, setShowMajorOnly] = useState(
    initialFilters.showMajorOnly ?? DEFAULT_FILTERS.showMajorOnly
  );
  const [showFreeOnly, setShowFreeOnly] = useState(
    initialFilters.showFreeOnly ?? DEFAULT_FILTERS.showFreeOnly
  );
  const [showCuratedOnly, setShowCuratedOnly] = useState(
    initialFilters.showCuratedOnly ?? DEFAULT_FILTERS.showCuratedOnly
  );
  const [minContext, setMinContext] = useState(
    initialFilters.minContext ?? DEFAULT_FILTERS.minContext
  );
  const [selectedProviders, setSelectedProviders] = useState(
    initialFilters.selectedProviders ?? DEFAULT_FILTERS.selectedProviders
  );

  const toggleProvider = (provider) => {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  };

  // All unique providers from unfiltered model list (for chip rendering)
  const allProviders = useMemo(() => {
    const providers = new Set(models.map((m) => m.provider).filter(Boolean));
    return sortProviders(Array.from(providers));
  }, [models]);

  const result = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    const filtered = models.filter((m) => {
      // Text search
      if (query) {
        const matchesQuery =
          m.name?.toLowerCase().includes(query) ||
          m.id.toLowerCase().includes(query) ||
          m.provider?.toLowerCase().includes(query);
        if (!matchesQuery) return false;
      }

      // Major providers filter
      if (showMajorOnly && !MAJOR_PROVIDERS.has(m.provider?.toLowerCase())) {
        return false;
      }

      // Free models filter
      if (showFreeOnly && (m.pricing?.completion || 0) > 0) {
        return false;
      }

      // Curated only filter
      if (showCuratedOnly && !curatedIds.has(m.id)) {
        return false;
      }

      // Context length filter
      if (minContext > 0 && (m.context_length || 0) < minContext) {
        return false;
      }

      // Per-provider filter
      if (selectedProviders.size > 0 && !selectedProviders.has(m.provider?.toLowerCase())) {
        return false;
      }

      return true;
    });

    const grouped = groupModelsByProvider(filtered);
    const providers = sortProviders(Object.keys(grouped));

    return {
      filteredModels: filtered,
      groupedModels: grouped,
      sortedProviders: providers,
      filteredCount: filtered.length,
      totalCount: models.length,
    };
  }, [
    models,
    searchQuery,
    showMajorOnly,
    showFreeOnly,
    showCuratedOnly,
    minContext,
    selectedProviders,
    curatedIds,
  ]);

  /**
   * Clear all filters and search.
   */
  const clearFilters = () => {
    setSearchQuery('');
    setShowMajorOnly(DEFAULT_FILTERS.showMajorOnly);
    setShowFreeOnly(DEFAULT_FILTERS.showFreeOnly);
    setShowCuratedOnly(DEFAULT_FILTERS.showCuratedOnly);
    setMinContext(DEFAULT_FILTERS.minContext);
    setSelectedProviders(DEFAULT_FILTERS.selectedProviders);
  };

  /**
   * Check if any filters are active.
   */
  const hasActiveFilters =
    searchQuery ||
    showMajorOnly ||
    showFreeOnly ||
    showCuratedOnly ||
    minContext > 0 ||
    selectedProviders.size > 0;

  return {
    // Results
    ...result,

    // Search
    searchQuery,
    setSearchQuery,

    // Filter controls (grouped for easy prop spreading)
    filters: {
      showMajorOnly,
      setShowMajorOnly,
      showFreeOnly,
      setShowFreeOnly,
      showCuratedOnly,
      setShowCuratedOnly,
      minContext,
      setMinContext,
      selectedProviders,
      toggleProvider,
    },

    // Provider data
    allProviders,

    // Utilities
    clearFilters,
    hasActiveFilters,
  };
}
