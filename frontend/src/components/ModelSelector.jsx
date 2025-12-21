import { useState, useEffect, useMemo } from 'react';
import { useModels, useCuratedModels, useModelFiltering, useExpandableGroups } from '../hooks';
import { formatPrice, getDisplayName } from '../lib/models';
import { ModelSearchBox, FilterChips, ModelGroups } from './models/index.js';
import './ModelSelector.css';

/**
 * Model selection UI for configuring council members and chairman.
 */
export default function ModelSelector({
  selectedCouncil,
  selectedChairman,
  onCouncilChange,
  onChairmanChange,
  onSave,
  onCancel,
}) {
  const [saving, setSaving] = useState(false);

  // Fetch models and curated list
  const { models, loading, error, refetch } = useModels();
  const { curatedIds, loading: curatedLoading } = useCuratedModels();

  // Filtering with curated default
  const filtering = useModelFiltering(models, curatedIds, {
    showCuratedOnly: curatedIds.size > 0,
    showMajorOnly: curatedIds.size === 0,
  });

  const {
    groupedModels,
    sortedProviders,
    filteredCount,
    totalCount,
    searchQuery,
    setSearchQuery,
    filters,
  } = filtering;

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
      selectedCouncil.forEach(id => {
        const model = models.find(m => m.id === id);
        if (model) providersWithSelected.add(model.provider || 'Other');
      });
      if (providersWithSelected.size > 0) {
        expandAll(Array.from(providersWithSelected));
      }
    }
  }, [models, selectedCouncil, expandAll]);

  // Count selected models per provider
  const selectedPerProvider = useMemo(() => {
    const counts = {};
    selectedCouncil.forEach(id => {
      const model = models.find(m => m.id === id);
      if (model) {
        const provider = model.provider || 'Other';
        counts[provider] = (counts[provider] || 0) + 1;
      }
    });
    return counts;
  }, [selectedCouncil, models]);

  const toggleCouncilMember = (modelId) => {
    if (selectedCouncil.includes(modelId)) {
      onCouncilChange(selectedCouncil.filter(m => m !== modelId));
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

  if (loading || curatedLoading) {
    return (
      <div className="model-selector">
        <div className="model-selector-loading">Loading models...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="model-selector">
        <div className="model-selector-error">
          {error}
          <button onClick={refetch} className="retry-btn">Retry</button>
        </div>
      </div>
    );
  }

  const isValid = selectedCouncil.length >= 2 && selectedChairman;

  return (
    <div className="model-selector">
      <div className="selector-section">
        <h4>Council Members ({selectedCouncil.length})</h4>
        <p className="selector-help">Select 2+ models to participate in the council</p>

        <ModelSearchBox
          value={searchQuery}
          onChange={setSearchQuery}
        />

        <FilterChips
          filters={filters}
          curatedCount={curatedIds.size}
          showCuratedFilter={true}
          showContextFilter={true}
        />

        <div className="filter-results-count">
          {filteredCount} of {totalCount} models
        </div>

        <ModelGroups
          sortedProviders={sortedProviders}
          groupedModels={groupedModels}
          isExpanded={isExpanded}
          onToggleProvider={toggleProvider}
          isSelected={(id) => selectedCouncil.includes(id)}
          onToggleModel={toggleCouncilMember}
          variant="checkbox"
          getSelectedCount={(provider) => selectedPerProvider[provider] || 0}
        />
      </div>

      <div className="selector-section">
        <h4>Chairman</h4>
        <p className="selector-help">The model that synthesizes the final answer</p>
        <select
          value={selectedChairman}
          onChange={(e) => onChairmanChange(e.target.value)}
          className="chairman-select"
        >
          <option value="">Select a chairman...</option>
          {sortedProviders.map(provider => (
            <optgroup key={provider} label={provider}>
              {groupedModels[provider]?.map(model => (
                <option key={model.id} value={model.id}>
                  {getDisplayName(model)} ({formatPrice(model.pricing?.completion)})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="selector-actions">
        <button
          className="cancel-btn"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className="save-btn"
          onClick={handleSave}
          disabled={!isValid || saving}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      {!isValid && (
        <p className="validation-warning">
          {selectedCouncil.length < 2 && 'Select at least 2 council members. '}
          {!selectedChairman && 'Select a chairman.'}
        </p>
      )}
    </div>
  );
}
