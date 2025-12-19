import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import './ModelSelector.css';

/** Major providers to show when filter is active */
const MAJOR_PROVIDERS = new Set([
  'anthropic', 'openai', 'google', 'meta-llama', 'mistralai',
  'cohere', 'deepseek', 'x-ai', 'amazon', 'microsoft'
]);

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

  // Filter state
  const [showMajorOnly, setShowMajorOnly] = useState(true);
  const [showFreeOnly, setShowFreeOnly] = useState(false);
  const [minContext, setMinContext] = useState(0);

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
  const { groupedModels, sortedProviders, filteredCount, totalCount } = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    const filtered = availableModels.filter(m => {
      // Text search filter
      if (query) {
        const matchesQuery = m.name?.toLowerCase().includes(query) ||
          m.id.toLowerCase().includes(query) ||
          m.provider?.toLowerCase().includes(query);
        if (!matchesQuery) return false;
      }

      // Major providers filter
      if (showMajorOnly && !MAJOR_PROVIDERS.has(m.provider?.toLowerCase())) {
        return false;
      }

      // Free models filter
      if (showFreeOnly) {
        const price = m.pricing?.completion || 0;
        if (price > 0) return false;
      }

      // Context length filter
      if (minContext > 0 && (m.context_length || 0) < minContext) {
        return false;
      }

      return true;
    });

    const grouped = filtered.reduce((acc, model) => {
      const provider = model.provider || 'Other';
      if (!acc[provider]) acc[provider] = [];
      acc[provider].push(model);
      return acc;
    }, {});

    // Sort providers: major providers first, then alphabetically
    const providers = Object.keys(grouped).sort((a, b) => {
      const aMajor = MAJOR_PROVIDERS.has(a.toLowerCase());
      const bMajor = MAJOR_PROVIDERS.has(b.toLowerCase());
      if (aMajor && !bMajor) return -1;
      if (!aMajor && bMajor) return 1;
      return a.localeCompare(b);
    });

    return {
      groupedModels: grouped,
      sortedProviders: providers,
      filteredCount: filtered.length,
      totalCount: availableModels.length,
    };
  }, [availableModels, searchQuery, showMajorOnly, showFreeOnly, minContext]);

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

        <div className="filter-bar">
          <label className={`filter-chip ${showMajorOnly ? 'active' : ''}`}>
            <input
              type="checkbox"
              checked={showMajorOnly}
              onChange={(e) => setShowMajorOnly(e.target.checked)}
            />
            Major providers
          </label>
          <label className={`filter-chip ${showFreeOnly ? 'active' : ''}`}>
            <input
              type="checkbox"
              checked={showFreeOnly}
              onChange={(e) => setShowFreeOnly(e.target.checked)}
            />
            Free only
          </label>
          <select
            className="context-filter"
            value={minContext}
            onChange={(e) => setMinContext(Number(e.target.value))}
          >
            <option value={0}>Any context</option>
            <option value={32000}>32K+ context</option>
            <option value={100000}>100K+ context</option>
            <option value={200000}>200K+ context</option>
          </select>
        </div>

        <div className="filter-results-count">
          {filteredCount} of {totalCount} models
        </div>

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
