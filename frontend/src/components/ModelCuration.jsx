import { useEffect } from 'react';
import { X, Star } from 'lucide-react';
import { useModels, useCuratedModels, useModelFiltering, useExpandableGroups } from '../hooks';
import { ModelSearchBox, FilterChips, ModelGroups } from './models/index.js';
import './ModelCuration.css';

/**
 * Model curation screen for selecting favorite models.
 */
export default function ModelCuration({ onClose, onSave }) {
  // Fetch models
  const { models, loading, error: modelsError } = useModels();

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

  // Filtering
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

  // Count curated per provider
  const curatedPerProvider = {};
  curatedIds.forEach(id => {
    const model = models.find(m => m.id === id);
    if (model) {
      const provider = model.provider || 'Other';
      curatedPerProvider[provider] = (curatedPerProvider[provider] || 0) + 1;
    }
  });

  const handleSave = async () => {
    const success = await save();
    if (success) {
      onSave?.(curated.asArray);
      onClose();
    }
  };

  const getBulkAction = (provider, providerModels) => {
    const allCurated = providerModels.every(m => curatedIds.has(m.id));
    return {
      label: allCurated ? 'Remove all' : 'Add all',
      title: allCurated ? 'Remove all from curated' : 'Add all to curated',
      onClick: () => allCurated
        ? removeAll(providerModels.map(m => m.id))
        : addAll(providerModels.map(m => m.id)),
    };
  };

  const error = modelsError || saveError;

  if (loading || curated.loading) {
    return (
      <div className="model-curation-overlay">
        <div className="model-curation">
          <div className="curation-loading">Loading models...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="model-curation-overlay">
      <div className="model-curation">
        <div className="curation-header">
          <div className="curation-title">
            <Star size={24} />
            <h2>Curate Your Models</h2>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <p className="curation-description">
          Select your favorite models to create a curated list. Only curated models will appear in the model selector.
        </p>

        {error && <div className="curation-error">{error}</div>}

        <ModelSearchBox
          value={searchQuery}
          onChange={setSearchQuery}
          showIcon={true}
        />

        <FilterChips
          filters={filters}
          showCuratedFilter={false}
          showContextFilter={false}
        />

        <div className="filter-results">
          <span>{filteredCount} of {totalCount} models</span>
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

        <div className="curation-actions">
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
