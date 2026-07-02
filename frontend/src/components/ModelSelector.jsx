import { useState, useEffect, useMemo, useRef } from 'react';
import { RefreshCw, Crown, X } from 'lucide-react';
import { useSeatColors } from '../hooks/useSeatColors';
import { useModelFiltering, useExpandableGroups } from '../hooks';
import { useAvailableModels, useCuratedModels, useRefreshModels } from '../hooks/queries';
import { ModelSearchBox, FilterChips, ModelGroups } from './models/index.js';
import './ModelSelector.css';

/**
 * Model selection modal — configures council members and chairman in one view.
 * Each model row has a ToggleSwitch (council membership) and a Crown button
 * (chairman designation). Shared `.cc-modal-*` chrome from index.css.
 */
export default function ModelSelector({
  selectedCouncil,
  selectedChairman,
  onCouncilChange,
  onChairmanChange,
  onSave,
  onCancel,
  filterStateRef = null,
}) {
  const [saving, setSaving] = useState(false);
  const searchInputRef = useRef(null);
  const { seatOf } = useSeatColors();

  // Auto-focus search when the modal opens
  useEffect(() => {
    const timer = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  // Fetch models and curated list
  const {
    data: modelsData,
    isLoading: loading,
    error: modelsError,
    refetch,
  } = useAvailableModels();
  const models = modelsData?.models || [];
  const error = modelsError ? 'Failed to load models' : null;
  const refreshModels = useRefreshModels();
  const refreshing = refreshModels.isPending;
  const refresh = () => refreshModels.mutate();

  const { data: curatedData, isLoading: curatedLoading } = useCuratedModels();
  const curatedIds = useMemo(() => new Set(curatedData?.curated_models || []), [curatedData]);

  // Filtering — restore saved filters or use curated defaults
  const filtering = useModelFiltering(
    models,
    curatedIds,
    filterStateRef?.current ?? {
      showCuratedOnly: curatedIds.size > 0,
      showMajorOnly: curatedIds.size === 0,
    }
  );

  const {
    groupedModels,
    sortedProviders,
    filteredCount,
    totalCount,
    searchQuery,
    setSearchQuery,
    filters,
    allProviders,
  } = filtering;

  // Persist filter state for next modal open
  useEffect(() => {
    if (!filterStateRef) return;
    filterStateRef.current = {
      showMajorOnly: filters.showMajorOnly,
      showFreeOnly: filters.showFreeOnly,
      showCuratedOnly: filters.showCuratedOnly,
      minContext: filters.minContext,
      selectedProviders: filters.selectedProviders,
    };
  }, [
    filterStateRef,
    filters.showMajorOnly,
    filters.showFreeOnly,
    filters.showCuratedOnly,
    filters.minContext,
    filters.selectedProviders,
  ]);

  // Expand/collapse state
  const { isExpanded, toggle: toggleProvider, expandAll } = useExpandableGroups();

  // Auto-expand when searching
  useEffect(() => {
    if (searchQuery) {
      expandAll(sortedProviders);
    }
  }, [searchQuery, sortedProviders, expandAll]);

  // Initially expand providers with selected models
  useEffect(() => {
    if (models.length > 0) {
      const providersWithSelected = new Set();
      selectedCouncil.forEach((id) => {
        const model = models.find((m) => m.id === id);
        if (model) providersWithSelected.add(model.provider || 'Other');
      });
      if (selectedChairman) {
        const chairModel = models.find((m) => m.id === selectedChairman);
        if (chairModel) providersWithSelected.add(chairModel.provider || 'Other');
      }
      if (providersWithSelected.size > 0) {
        expandAll(Array.from(providersWithSelected));
      }
    }
  }, [models, selectedCouncil, selectedChairman, expandAll]);

  // Count selected models per provider (for group header badges)
  const selectedPerProvider = useMemo(() => {
    const counts = {};
    selectedCouncil.forEach((id) => {
      const model = models.find((m) => m.id === id);
      if (model) {
        const provider = model.provider || 'Other';
        counts[provider] = (counts[provider] || 0) + 1;
      }
    });
    return counts;
  }, [selectedCouncil, models]);

  const toggleCouncilMember = (modelId) => {
    if (selectedCouncil.includes(modelId)) {
      const remaining = selectedCouncil.filter((m) => m !== modelId);
      onCouncilChange(remaining);
      // Keep the chairman invariant: the chair must be a council member.
      if (modelId === selectedChairman) {
        onChairmanChange(remaining[0] ?? '');
      }
    } else {
      onCouncilChange([...selectedCouncil, modelId]);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  const isValid = selectedCouncil.length >= 2 && selectedChairman;

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading || curatedLoading) {
    return (
      <div className="cc-modal-backdrop" onClick={onCancel}>
        <div className="cc-modal-panel" onClick={(e) => e.stopPropagation()}>
          <div className="ms-status-state">Loading models…</div>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="cc-modal-backdrop" onClick={onCancel}>
        <div className="cc-modal-panel" onClick={(e) => e.stopPropagation()}>
          <div className="ms-status-state ms-status-state--error">
            {error}
            <button onClick={refetch} className="ms-retry-btn">
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────
  return (
    <div className="cc-modal-backdrop" onClick={onCancel}>
      <div
        className="cc-modal-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Configure council"
      >
        {/* Header */}
        <div className="cc-modal-header">
          <div>
            <div className="cc-modal-title">Configure council</div>
            <div className="cc-modal-subtitle">
              <span className="ms-count-num">{selectedCouncil.length}</span> models convened ·{' '}
              <Crown
                size={11}
                style={{ verticalAlign: 'middle', marginBottom: 1 }}
                aria-hidden="true"
              />{' '}
              marks the chairman
            </div>
          </div>
          <button className="cc-modal-close" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="cc-modal-body ms-body">
          <ModelSearchBox ref={searchInputRef} value={searchQuery} onChange={setSearchQuery} />

          <FilterChips
            filters={filters}
            curatedCount={curatedIds.size}
            showCuratedFilter={true}
            showContextFilter={true}
            showProviderChips={true}
            allProviders={allProviders}
          />

          <div className="ms-filter-row">
            <span className="ms-filter-count">
              <span className="ms-count-num">{filteredCount}</span> of{' '}
              <span className="ms-count-num">{totalCount}</span> models
            </span>
            <button
              className={`ms-refresh-btn${refreshing ? ' ms-refresh-btn--spinning' : ''}`}
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
            isSelected={(id) => selectedCouncil.includes(id)}
            onToggleModel={toggleCouncilMember}
            variant="council"
            getSelectedCount={(provider) => selectedPerProvider[provider] || 0}
            seatOf={seatOf}
            isChairman={(id) => id === selectedChairman}
            onSetChairman={onChairmanChange}
          />
        </div>

        {/* Footer */}
        <div className="cc-modal-footer">
          <span className="ms-footer-count">
            <span className="ms-count-num">{selectedCouncil.length}</span> of 10 selected
          </span>
          <div className="ms-footer-actions">
            <button className="ms-cancel-btn" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button className="ms-save-btn" onClick={handleSave} disabled={!isValid || saving}>
              {saving ? 'Saving…' : 'Save council'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
