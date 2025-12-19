import { useState, useEffect } from 'react';
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

  const formatPrice = (price) => {
    if (!price || price === 0) return 'Free';
    // Price is per token, convert to per million tokens
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

  // Group models by provider
  const groupedModels = availableModels.reduce((acc, model) => {
    const provider = model.provider;
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(model);
    return acc;
  }, {});

  // Sort providers alphabetically
  const sortedProviders = Object.keys(groupedModels).sort();

  const isValid = selectedCouncil.length >= 2 && selectedChairman;

  return (
    <div className="model-selector">
      <div className="selector-section">
        <h4>Council Members ({selectedCouncil.length})</h4>
        <p className="selector-help">Select 2+ models to participate in the council</p>
        <div className="model-groups">
          {sortedProviders.map(provider => (
            <div key={provider} className="model-group">
              <div className="group-header">{provider}</div>
              <div className="group-models">
                {groupedModels[provider].map(model => (
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
            </div>
          ))}
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
          {availableModels.map(model => (
            <option key={model.id} value={model.id}>
              {model.name || model.id} ({formatPrice(model.pricing?.completion)})
            </option>
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
