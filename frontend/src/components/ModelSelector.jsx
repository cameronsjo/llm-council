import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
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
  const [availableModels, setAvailableModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProviders, setExpandedProviders] = useState(new Set());

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      setLoading(true);
      setError(null);
      const { models } = await api.getAvailableModels();
      setAvailableModels(models);
    } catch (err) {
      setError('Failed to load models');
      console.error('Failed to load models:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleCouncilMember = (modelId) => {
    if (selectedCouncil.includes(modelId)) {
      onCouncilChange(selectedCouncil.filter(m => m !== modelId));
    } else {
      onCouncilChange([...selectedCouncil, modelId]);
    }
  };

  const toggleProvider = (provider) => {
    setExpandedProviders(prev => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  };

  const formatPrice = (price) => {
    if (!price || price === 0) return 'Free';
    const perMillion = price * 1000000;
    if (perMillion < 0.01) return '<$0.01/M';
    return `$${perMillion.toFixed(2)}/M`;
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  // Filter and group models
  const { groupedModels, sortedProviders, filteredCount } = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    const filtered = query
      ? availableModels.filter(m =>
          m.name?.toLowerCase().includes(query) ||
          m.id.toLowerCase().includes(query) ||
          m.provider?.toLowerCase().includes(query)
        )
      : availableModels;

    const grouped = filtered.reduce((acc, model) => {
      const provider = model.provider || 'Other';
      if (!acc[provider]) acc[provider] = [];
      acc[provider].push(model);
      return acc;
    }, {});

    return {
      groupedModels: grouped,
      sortedProviders: Object.keys(grouped).sort(),
      filteredCount: filtered.length,
    };
  }, [availableModels, searchQuery]);

  // Count selected models per provider
  const selectedPerProvider = useMemo(() => {
    const counts = {};
    selectedCouncil.forEach(id => {
      const model = availableModels.find(m => m.id === id);
      if (model) {
        const provider = model.provider || 'Other';
        counts[provider] = (counts[provider] || 0) + 1;
      }
    });
    return counts;
  }, [selectedCouncil, availableModels]);

  // Auto-expand providers with selected models or when searching
  useEffect(() => {
    if (searchQuery) {
      setExpandedProviders(new Set(sortedProviders));
    }
  }, [searchQuery, sortedProviders]);

  // Initially expand providers with selected models
  useEffect(() => {
    if (availableModels.length > 0 && expandedProviders.size === 0) {
      const providersWithSelected = new Set();
      selectedCouncil.forEach(id => {
        const model = availableModels.find(m => m.id === id);
        if (model) providersWithSelected.add(model.provider || 'Other');
      });
      if (providersWithSelected.size > 0) {
        setExpandedProviders(providersWithSelected);
      }
    }
  }, [availableModels, selectedCouncil]);

  if (loading) {
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
          <button onClick={loadModels} className="retry-btn">Retry</button>
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

        <div className="search-box">
          <input
            type="text"
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          {searchQuery && (
            <button
              className="search-clear"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {searchQuery && (
          <div className="search-results-count">
            {filteredCount} model{filteredCount !== 1 ? 's' : ''} found
          </div>
        )}

        <div className="model-groups">
          {sortedProviders.map(provider => {
            const isExpanded = expandedProviders.has(provider);
            const selectedCount = selectedPerProvider[provider] || 0;
            const models = groupedModels[provider];

            return (
              <div key={provider} className={`model-group ${isExpanded ? 'expanded' : ''}`}>
                <button
                  className="group-header"
                  onClick={() => toggleProvider(provider)}
                >
                  <span className="group-toggle">{isExpanded ? '▼' : '▶'}</span>
                  <span className="group-name">{provider}</span>
                  <span className="group-count">
                    {selectedCount > 0 && (
                      <span className="selected-badge">{selectedCount} selected</span>
                    )}
                    <span className="total-count">{models.length}</span>
                  </span>
                </button>

                {isExpanded && (
                  <div className="group-models">
                    {models.map(model => (
                      <label key={model.id} className="model-option">
                        <input
                          type="checkbox"
                          checked={selectedCouncil.includes(model.id)}
                          onChange={() => toggleCouncilMember(model.id)}
                        />
                        <span className="model-info">
                          <span className="model-name" title={model.id}>
                            {model.name || model.id.split('/').pop()}
                          </span>
                          <span className="model-price">{formatPrice(model.pricing?.completion)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
                  {model.name || model.id.split('/').pop()} ({formatPrice(model.pricing?.completion)})
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
