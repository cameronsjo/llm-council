import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from 'recharts';
import { Trophy, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useRankings, useRankingsHistory } from '../hooks/queries';
import './Standings.css';

// Stage palette for line colors — falls back to burgundy/gold/sage tones for >3 series.
const SERIES_COLORS = [
  'var(--color-stage1-accent)',
  'var(--color-stage2-accent)',
  'var(--color-stage3-accent)',
  'var(--color-burgundy)',
  'var(--color-gold-dark)',
  'var(--color-burgundy-light)',
];

const SORTABLE_COLUMNS = [
  { key: 'rank', label: 'Rank', numeric: true },
  { key: 'model', label: 'Model', numeric: false },
  { key: 'rating', label: 'Rating', numeric: true },
  { key: 'games', label: 'Games', numeric: true },
  { key: 'last_updated', label: 'Last seen', numeric: false },
];

function formatModel(id) {
  // OpenRouter ids look like "anthropic/claude-sonnet-4.5" — show the right half.
  return id?.split('/').slice(-1)[0] || id;
}

function formatTimestamp(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * Group history snapshots by timestamp so each x-step represents one real
 * match event, not one per-model snapshot. Without this grouping a single
 * pairwise match (which updates two models simultaneously) would create
 * two x-steps and distort the trend.
 */
function buildChartSeries(history) {
  const eventsByTs = new Map();
  Object.entries(history).forEach(([model, snapshots]) => {
    snapshots.forEach((s) => {
      if (!eventsByTs.has(s.ts)) eventsByTs.set(s.ts, {});
      eventsByTs.get(s.ts)[model] = s.rating;
    });
  });
  const sortedTs = [...eventsByTs.keys()].sort();
  const lastRatings = {};
  return sortedTs.map((ts, i) => {
    Object.assign(lastRatings, eventsByTs.get(ts));
    return { idx: i + 1, ts, ...lastRatings };
  });
}

export default function Standings() {
  const { data: rankingsData, isLoading: leaderboardLoading, error: leaderboardError } = useRankings();
  const [selectedModel, setSelectedModel] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'rating', dir: 'desc' });
  const {
    data: historyData,
    isLoading: historyLoading,
    error: historyError,
  } = useRankingsHistory(selectedModel);

  const leaderboard = rankingsData?.leaderboard || [];
  const history = historyData?.history || {};
  const chartData = useMemo(() => buildChartSeries(history), [history]);
  const modelKeys = Object.keys(history);

  const sortedLeaderboard = useMemo(() => {
    const { key, dir } = sortConfig;
    const sorted = [...leaderboard].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : 1;
      return dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [leaderboard, sortConfig]);

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key !== key) {
        // First click on a new column: numeric defaults to desc, text to asc.
        const col = SORTABLE_COLUMNS.find((c) => c.key === key);
        return { key, dir: col?.numeric ? 'desc' : 'asc' };
      }
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  };

  const toggleSelection = (model) => {
    setSelectedModel((current) => (current === model ? null : model));
  };

  const sortIcon = (key) => {
    if (sortConfig.key !== key) {
      return <ArrowUpDown size={12} aria-hidden="true" className="sort-icon inactive" />;
    }
    return sortConfig.dir === 'asc'
      ? <ArrowUp size={12} aria-hidden="true" className="sort-icon" />
      : <ArrowDown size={12} aria-hidden="true" className="sort-icon" />;
  };

  return (
    <main className="standings">
      <header className="standings-header">
        <Trophy size={28} className="standings-icon" aria-hidden="true" />
        <div>
          <h1>Council Standings</h1>
          <p className="standings-subtitle">
            ELO ratings derived from Stage 2 peer rankings, replayed across every council round.
          </p>
        </div>
      </header>

      <section className="standings-section">
        <h2>Leaderboard</h2>
        {leaderboardLoading ? (
          <div className="standings-empty">Loading…</div>
        ) : leaderboardError ? (
          <div className="standings-error" role="alert">
            Failed to load leaderboard: {leaderboardError.message || 'Unknown error'}
          </div>
        ) : leaderboard.length === 0 ? (
          <div className="standings-empty">
            No matches recorded yet. Run a council round to start tracking ratings.
          </div>
        ) : (
          <table className="standings-table">
            <thead>
              <tr>
                {SORTABLE_COLUMNS.map((col) => {
                  const isActive = sortConfig.key === col.key;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      className={col.numeric ? 'num' : ''}
                      aria-sort={
                        isActive
                          ? sortConfig.dir === 'asc' ? 'ascending' : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        className="sort-header-btn"
                        onClick={() => handleSort(col.key)}
                      >
                        <span>{col.label}</span>
                        {sortIcon(col.key)}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedLeaderboard.map((row) => {
                const isSelected = selectedModel === row.model;
                return (
                  <tr key={row.model} className={isSelected ? 'selected' : ''}>
                    <td className="rank">{row.rank}</td>
                    <td className="model" title={row.model}>
                      <button
                        type="button"
                        className="model-select-btn"
                        aria-pressed={isSelected}
                        aria-label={
                          isSelected
                            ? `Clear filter on ${formatModel(row.model)}`
                            : `Filter trend chart to ${formatModel(row.model)}`
                        }
                        onClick={() => toggleSelection(row.model)}
                      >
                        {formatModel(row.model)}
                      </button>
                    </td>
                    <td className="num">{Math.round(row.rating)}</td>
                    <td className="num">{row.games}</td>
                    <td className="ts">{formatTimestamp(row.last_updated)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {selectedModel && (
          <p className="standings-filter-hint">
            Filtered to <strong>{formatModel(selectedModel)}</strong> — click the model name again to clear.
          </p>
        )}
      </section>

      <section className="standings-section">
        <h2>Trend</h2>
        {historyLoading ? (
          <div className="standings-empty">Loading…</div>
        ) : historyError ? (
          <div className="standings-error" role="alert">
            Failed to load trend history: {historyError.message || 'Unknown error'}
          </div>
        ) : modelKeys.length === 0 ? (
          <div className="standings-empty">No history yet.</div>
        ) : (
          <div className="standings-chart">
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid stroke="var(--color-border-light)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="idx"
                  stroke="var(--color-text-muted)"
                  label={{ value: 'Match #', position: 'insideBottom', offset: -2, fill: 'var(--color-text-muted)' }}
                />
                <YAxis
                  stroke="var(--color-text-muted)"
                  domain={['dataMin - 20', 'dataMax + 20']}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface-elevated)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8125rem',
                  }}
                  labelFormatter={(idx) => `Match ${idx}`}
                  formatter={(value, name) => [Math.round(value), formatModel(name)]}
                />
                <Legend formatter={(value) => formatModel(value)} />
                {modelKeys.map((model, i) => (
                  <Line
                    key={model}
                    type="monotone"
                    dataKey={model}
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </main>
  );
}
