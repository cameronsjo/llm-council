import { Star } from 'lucide-react';

/**
 * Filter chip bar for model filtering options.
 */
export function FilterChips({
  filters,
  curatedCount = 0,
  showCuratedFilter = false,
  showContextFilter = false,
}) {
  const {
    showMajorOnly,
    setShowMajorOnly,
    showFreeOnly,
    setShowFreeOnly,
    showCuratedOnly,
    setShowCuratedOnly,
    minContext,
    setMinContext,
  } = filters;

  return (
    <div className="filter-bar">
      {showCuratedFilter && curatedCount > 0 && (
        <label className={`filter-chip curated ${showCuratedOnly ? 'active' : ''}`}>
          <input
            type="checkbox"
            checked={showCuratedOnly}
            onChange={(e) => setShowCuratedOnly(e.target.checked)}
          />
          <Star size={12} /> My models ({curatedCount})
        </label>
      )}
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
      {!showCuratedFilter && (
        <label className={`filter-chip ${showCuratedOnly ? 'active' : ''}`}>
          <input
            type="checkbox"
            checked={showCuratedOnly}
            onChange={(e) => setShowCuratedOnly(e.target.checked)}
          />
          <Star size={12} /> Curated only
        </label>
      )}
      {showContextFilter && (
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
      )}
    </div>
  );
}
