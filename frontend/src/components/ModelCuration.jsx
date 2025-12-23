import { useEffect, useMemo } from 'react';
import { X, Star } from 'lucide-react';
import { useModels, useCuratedModels, useModelFiltering, useExpandableGroups } from '../hooks';
import { ModelSearchBox, FilterChips, ModelGroups } from './models/index.js';
import './ModelCuration.css';

/**
 * Model curation modal for selecting favorite models.
 * Mirrors ModelSelector structure for consistency.
 */
export default function ModelCuration({ onClose, onSave }) {
  // Fetch models
  const { models, loading, error: modelsError, refetch } = useModels();

  // Curated models state
  const curated = useCuratedModels();
  const {
    curatedIds,
    toggle: toggleCurated,
    addAll,
    removeAll,
    save,
    saving,
    error: saveError,
  } = curated;

  // Filtering - no curated filter in curation mode
  const filtering = useModelFiltering(models, curatedIds);
  const {
    groupedModels,
    sortedProviders,
    filteredCount,
    totalCount,
    searchQuery,
    setSearchQuery,
    filters,
  } = filtering;

  // Expand/collapse
  const { isExpanded, toggle: toggleProvider, expandAll } = useExpandableGroups();

  // Auto-expand when searching
  useEffect(() => {
    if (searchQuery) {
      expandAll(sortedProviders);
    }
  }, [searchQuery, sortedProviders, expandAll]);

  // Initially expand providers with curated models
  useEffect(() => {
    if (models.length > 0 && curatedIds.size > 0) {
      const providersWithCurated = new Set();
      curatedIds.forEach((id) => {
        const model = models.find((m) => m.id === id);
        if (model) providersWithCurated.add(model.provider || 'Other');
      });
      if (providersWithCurated.size > 0) {
        expandAll(Array.from(providersWithCurated));
      }
    }
  }, [models, curatedIds, expandAll]);

  // Count curated per provider
  const curatedPerProvider = useMemo(() => {
    const counts = {};
    curatedIds.forEach((id) => {
      const model = models.find((m) => m.id === id);
      if (model) {
        const provider = model.provider || 'Other';
        counts[provider] = (counts[provider] || 0) + 1;
      }
    });
    return counts;
  }, [curatedIds, models]);

  const handleSave = async () => {
    const success = await save();
    if (success) {
      onSave?.(curated.asArray);
      onClose();
    }
  };

  const getBulkAction = (provider, providerModels) => {
    const allCurated = providerModels.every((m) => curatedIds.has(m.id));
    return {
      label: allCurated ? 'Remove all' : 'Add all',
      title: allCurated ? 'Remove all from curated' : 'Add all to curated',
      onClick: () =>
        allCurated
          ? removeAll(providerModels.map((m) => m.id))
          : addAll(providerModels.map((m) => m.id)),
    };
  };

  const error = modelsError || saveError;

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (loading || curated.loading) {
    return (
      <div className="curation-overlay" onClick={onClose}>
        <div className="curation-modal" onClick={(e) => e.stopPropagation()}>
          <div className="curation-loading">Loading models...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="curation-overlay" onClick={onClose}>
      <div className="curation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="curation-header">
          <div className="curation-title">
            <Star size={20} />
            <h2>Curate Your Models</h2>
          </div>
          <button className="curation-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="curation-body">
          <p className="curation-description">
            Select your favorite models to create a curated list. Only curated models will appear
            in the model selector.
          </p>

          {error && (
            <div className="curation-error">
              {error}
              <button onClick={refetch} className="retry-btn">
                Retry
              </button>
            </div>
          )}

          <ModelSearchBox value={searchQuery} onChange={setSearchQuery} />

          <FilterChips
            filters={filters}
            showCuratedFilter={false}
            showContextFilter={false}
          />

          <div className="curation-results">
            <span>
              {filteredCount} of {totalCount} models
            </span>
            <span className="curated-count">
              <Star size={14} /> {curatedIds.size} curated
            </span>
          </div>

          <ModelGroups
            sortedProviders={sortedProviders}
            groupedModels={groupedModels}
            isExpanded={isExpanded}
            onToggleProvider={toggleProvider}
            isSelected={(id) => curatedIds.has(id)}
            onToggleModel={toggleCurated}
            variant="star"
            showContext={true}
            getSelectedCount={(provider) => curatedPerProvider[provider] || 0}
            getBulkAction={getBulkAction}
          />
        </div>

        <div className="curation-footer">
          <button className="cancel-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="save-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : `Save ${curatedIds.size} Models`}
          </button>
        </div>
      </div>
    </div>
  );
}
