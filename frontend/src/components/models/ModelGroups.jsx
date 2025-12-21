import { Star, Check } from 'lucide-react';
import { formatPrice, getDisplayName, formatContextLength } from '../../lib/models';

/**
 * Single model item - supports checkbox (selector) and star (curation) variants.
 */
export function ModelItem({
  model,
  isSelected,
  onToggle,
  variant = 'checkbox', // 'checkbox' | 'star'
  showContext = false,
}) {
  const displayName = getDisplayName(model);

  if (variant === 'star') {
    return (
      <button
        className={`model-item ${isSelected ? 'curated' : ''}`}
        onClick={() => onToggle(model.id)}
      >
        <span className={`star-icon ${isSelected ? 'active' : ''}`}>
          <Star size={16} fill={isSelected ? 'currentColor' : 'none'} />
        </span>
        <span className="model-info">
          <span className="model-name" title={model.id}>
            {displayName}
          </span>
          <span className="model-meta">
            <span className="model-price">{formatPrice(model.pricing?.completion)}</span>
            {showContext && model.context_length && (
              <span className="model-context">
                {formatContextLength(model.context_length)}
              </span>
            )}
          </span>
        </span>
        {isSelected && <Check size={16} className="check-icon" />}
      </button>
    );
  }

  // Checkbox variant (default)
  return (
    <label className="model-option">
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggle(model.id)}
      />
      <span className="model-info">
        <span className="model-name" title={model.id}>
          {displayName}
        </span>
        <span className="model-price">{formatPrice(model.pricing?.completion)}</span>
      </span>
    </label>
  );
}

/**
 * Provider group header with expand/collapse and optional bulk actions.
 */
export function ModelGroupHeader({
  provider,
  isExpanded,
  onToggle,
  selectedCount = 0,
  totalCount,
  showSelectedBadge = false,
  showCuratedBadge = false,
  bulkAction = null, // { label, onClick }
}) {
  return (
    <div className="group-header">
      <button
        className="group-toggle-btn"
        onClick={onToggle}
        style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '16px 18px' }}
      >
        <span className="group-toggle">{isExpanded ? '▼' : '▶'}</span>
        <span className="group-name">{provider}</span>
        <span className="group-count">
          {showSelectedBadge && selectedCount > 0 && (
            <span className="selected-badge">{selectedCount} selected</span>
          )}
          {showCuratedBadge && selectedCount > 0 && (
            <span className="curated-badge">
              <Star size={10} /> {selectedCount}
            </span>
          )}
          <span className="total-count">{totalCount}</span>
        </span>
      </button>
      {isExpanded && bulkAction && (
        <button
          className="bulk-action-btn"
          onClick={bulkAction.onClick}
          title={bulkAction.title}
        >
          {bulkAction.label}
        </button>
      )}
    </div>
  );
}

/**
 * Container for grouped model list with provider sections.
 */
export function ModelGroups({
  sortedProviders,
  groupedModels,
  isExpanded,
  onToggleProvider,
  isSelected,
  onToggleModel,
  variant = 'checkbox',
  showContext = false,
  getSelectedCount = () => 0,
  getBulkAction = null,
}) {
  return (
    <div className="model-groups">
      {sortedProviders.map(provider => {
        const expanded = isExpanded(provider);
        const providerModels = groupedModels[provider];
        const selectedCount = getSelectedCount(provider);
        const bulkAction = getBulkAction?.(provider, providerModels);

        return (
          <div key={provider} className={`model-group ${expanded ? 'expanded' : ''}`}>
            <ModelGroupHeader
              provider={provider}
              isExpanded={expanded}
              onToggle={() => onToggleProvider(provider)}
              selectedCount={selectedCount}
              totalCount={providerModels.length}
              showSelectedBadge={variant === 'checkbox'}
              showCuratedBadge={variant === 'star'}
              bulkAction={bulkAction}
            />

            {expanded && (
              <div className="group-models">
                {providerModels.filter(m => m.id).map(model => (
                  <ModelItem
                    key={model.id}
                    model={model}
                    isSelected={isSelected(model.id)}
                    onToggle={onToggleModel}
                    variant={variant}
                    showContext={showContext}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
