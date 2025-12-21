import { Search, X } from 'lucide-react';

/**
 * Search input with clear button for filtering models.
 */
export function ModelSearchBox({
  value,
  onChange,
  placeholder = 'Search models...',
  showIcon = false,
}) {
  return (
    <div className="search-box">
      {showIcon && <Search size={16} className="search-icon" />}
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="search-input"
      />
      {value && (
        <button
          className="search-clear"
          onClick={() => onChange('')}
          title="Clear search"
        >
          {showIcon ? <X size={14} /> : '×'}
        </button>
      )}
    </div>
  );
}
