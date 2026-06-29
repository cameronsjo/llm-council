import { useEffect, useMemo } from 'react';
import { X, Star, RefreshCw } from 'lucide-react';
import { useModels, useCuratedModels, useModelFiltering, useExpandableGroups } from '../hooks';
import { ModelSearchBox, FilterChips, ModelGroups } from './models/index.js';
import './ModelCuration.css';

/**
 * Model curation modal — select favourite models for the curated list.
 * Uses shared .cc-modal-* chrome from index.css.
 */
export default function ModelCuration({ onClose, onSave }) {
  // Fetch models
  const { models, loading, refreshing, error: modelsError, refetch, refresh } = useModels();

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

  // Filtering — no curated filter in curation mode
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

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading || curated.loading) {
    return (
      <div className="cc-modal-backdrop" onClick={onClose}>
        <div className="cc-modal-panel mc-panel" onClick={(e) => e.stopPropagation()}>
          <div className="mc-status-loading">Loading models…</div>
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────
  return (
    <div className="cc-modal-backdrop" onClick={onClose}>
      <div className="cc-modal-panel mc-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="cc-modal-header">
          <div className="mc-title-group">
            <div className="cc-modal-title">
              <Star size={18} className="mc-title-icon" aria-hidden="true" />
              Curate Your Models
            </div>
          </div>
          <button className="cc-modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="cc-modal-body mc-body">
          <p className="mc-description">
            Select your favourite models to create a curated list. Only curated models will appear
            in the model selector by default.
          </p>

          {error && (
            <div className="mc-error">
              {error}
              <button onClick={refetch} className="mc-retry-btn">
                Retry
              </button>
            </div>
          )}

          <ModelSearchBox value={searchQuery} onChange={setSearchQuery} />

          <FilterChips filters={filters} showCuratedFilter={false} showContextFilter={false} />

          <div className="mc-results-row">
            <span className="mc-model-count">
              <span className="mc-num">{filteredCount}</span> of{' '}
              <span className="mc-num">{totalCount}</span> models
            </span>
            <span className="mc-curated-count">
              <Star size={13} aria-hidden="true" />
              <span className="mc-num">{curatedIds.size}</span> curated
            </span>
            <button
              className={`mc-refresh-btn${refreshing ? ' mc-refresh-btn--spinning' : ''}`}
              onClick={refresh}
              disabled={refreshing}
              title="Refresh models from OpenRouter"
            >
              <RefreshCw size={14} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
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

        {/* Footer */}
        <div className="cc-modal-footer">
          <button className="mc-cancel-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="mc-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : `Save ${curatedIds.size} Models`}
          </button>
        </div>
      </div>
    </div>
  );
}
