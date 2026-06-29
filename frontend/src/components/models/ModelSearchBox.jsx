import { forwardRef } from 'react';
import { Search, X } from 'lucide-react';

/**
 * Search input with clear button for filtering models.
 */
export const ModelSearchBox = forwardRef(function ModelSearchBox(
  { value, onChange, placeholder = 'Search models or providers…', showIcon = true },
  ref
) {
  return (
    <div className="search-box">
      {showIcon && <Search size={14} className="search-icon" aria-hidden="true" />}
      <input
        ref={ref}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`search-input${showIcon ? ' search-input--icon' : ''}`}
      />
      {value && (
        <button
          className="search-clear"
          onClick={() => onChange('')}
          title="Clear search"
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
});
