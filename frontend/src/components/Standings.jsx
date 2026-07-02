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
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useRankings, useRankingsHistory, useConversations, useConfig } from '../hooks/queries';
import { useSeatColors } from '../hooks/useSeatColors';
import { KpiCard, SeatAvatar } from './ui';
import './Standings.css';

const SORTABLE_COLUMNS = [
  { key: 'rank', label: '#', numeric: true },
  { key: 'model', label: 'model', numeric: false },
  { key: 'rating', label: 'rating', numeric: true },
  { key: 'games', label: 'games', numeric: true },
  { key: 'last_updated', label: 'last seen', numeric: false },
];

function formatModel(id) {
  // OpenRouter ids look like "anthropic/claude-sonnet-4.5" — show the right half.
  return id?.split('/').slice(-1)[0] || id;
}

function formatProvider(id) {
  return id?.split('/')[0] || '';
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

/** Short date for KPI display: relative within 24h, then "Mon DD". */
function formatShortDate(iso) {
  if (!iso) return '—';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const hrs = diff / 3600000;
    if (hrs < 1) return `${Math.floor(diff / 60000)}m ago`;
    if (hrs < 24) return `${Math.floor(hrs)}h ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

/**
 * Group history snapshots by timestamp so each x-step represents one real
 * match event, not one per-model snapshot.
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
  const {
    data: rankingsData,
    isLoading: leaderboardLoading,
    error: leaderboardError,
  } = useRankings();
  const { data: config } = useConfig();
  const { data: conversations = [] } = useConversations();
  const [selectedModel, setSelectedModel] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'rating', dir: 'desc' });
  const {
    data: historyData,
    isLoading: historyLoading,
    error: historyError,
  } = useRankingsHistory(selectedModel);

  const { seatOf } = useSeatColors();
  const chairmanModel = config?.chairman_model || '';

  const leaderboard = useMemo(() => rankingsData?.leaderboard || [], [rankingsData]);
  const history = useMemo(() => historyData?.history || {}, [historyData]);
  const chartData = useMemo(() => buildChartSeries(history), [history]);
  const modelKeys = Object.keys(history);

  // Highest rating in the board — used to normalize bar widths.
  const maxRating = useMemo(
    () => (leaderboard.length ? Math.max(...leaderboard.map((r) => r.rating || 0)) : 1),
    [leaderboard]
  );

  // KPI derived values
  const totalGames = useMemo(
    () => leaderboard.reduce((s, r) => s + (r.games || 0), 0),
    [leaderboard]
  );

  const mostRecentTs = useMemo(() => {
    const ts = leaderboard
      .map((r) => r.last_updated)
      .filter(Boolean)
      .sort()
      .pop();
    return formatShortDate(ts);
  }, [leaderboard]);

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
      return <ArrowUpDown size={11} aria-hidden="true" className="sort-icon inactive" />;
    }
    return sortConfig.dir === 'asc' ? (
      <ArrowUp size={11} aria-hidden="true" className="sort-icon" />
    ) : (
      <ArrowDown size={11} aria-hidden="true" className="sort-icon" />
    );
  };

  return (
    <main className="standings">
      <div className="standings-inner">
        {/* H1 in --font-head */}
        <div className="standings-heading">
          <h1>Council standings</h1>
          <p className="standings-subtitle">
            ELO ratings derived from Stage 2 peer rankings, replayed across every council round.
          </p>
        </div>

        {/* KPI strip — frontend-only, real data only */}
        <div className="standings-kpi-strip">
          <KpiCard label="DELIBERATIONS" value={conversations.length} sub="all time" />
          <KpiCard label="MODELS TRACKED" value={leaderboard.length} sub="in leaderboard" />
          <KpiCard label="TOTAL MATCHES" value={totalGames} sub="peer ballots cast" />
          <KpiCard label="MOST RECENT" value={mostRecentTs} sub="last deliberation" />
        </div>

        {/* Leaderboard */}
        <section className="standings-section">
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
            <>
              <table className="standings-table" aria-label="Council standings leaderboard">
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
                              ? sortConfig.dir === 'asc'
                                ? 'ascending'
                                : 'descending'
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
                    const isTop = row.rank === 1;
                    const seat = seatOf(row.model);
                    const barWidth = Math.round(((row.rating || 0) / maxRating) * 100);
                    const isChair = row.model === chairmanModel;

                    return (
                      <tr
                        key={row.model}
                        className={[isTop ? 'row-top' : '', isSelected ? 'selected' : '']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {/* Rank */}
                        <td className="rank">
                          <span className="rank-num">{row.rank}</span>
                        </td>

                        {/* Model: avatar + name + CHAIR tag + provider */}
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
                            <SeatAvatar
                              color={seat.color}
                              name={formatModel(row.model)}
                              size={28}
                            />
                            <div className="model-info">
                              <div className="model-name-row">
                                <span className="model-name">{formatModel(row.model)}</span>
                                {isChair && <span className="model-chair-tag">CHAIR</span>}
                              </div>
                              <span className="model-sub">
                                {formatProvider(row.model)} · {row.games} councils
                              </span>
                            </div>
                          </button>
                        </td>

                        {/* Rating: seat-colored bar + numeric value */}
                        <td className="rating-cell">
                          <div className="rating-bar-wrap">
                            <div className="rating-bar-track">
                              <div
                                className="rating-bar-fill"
                                style={{
                                  width: `${barWidth}%`,
                                  background: seat.color,
                                }}
                              />
                            </div>
                            <span className="rating-val">{Math.round(row.rating)}</span>
                          </div>
                        </td>

                        {/* Games */}
                        <td className="num games-cell">{row.games}</td>

                        {/* Last seen */}
                        <td className="ts">{formatTimestamp(row.last_updated)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="standings-footnote">
                rating = ELO score derived from blind peer rankings across deliberations
              </p>
            </>
          )}
          {selectedModel && (
            <p className="standings-filter-hint">
              Filtered to <strong>{formatModel(selectedModel)}</strong> — click the model name again
              to clear.
            </p>
          )}
        </section>

        {/* Trend chart */}
        <section className="standings-section">
          <h2 className="standings-section-heading">Trend</h2>
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
                  <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="idx"
                    stroke="var(--fg-faint)"
                    tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--fg-faint)' }}
                    label={{
                      value: 'Match #',
                      position: 'insideBottom',
                      offset: -2,
                      fill: 'var(--fg-faint)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                    }}
                  />
                  <YAxis
                    stroke="var(--fg-faint)"
                    tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--fg-faint)' }}
                    domain={['dataMin - 20', 'dataMax + 20']}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-raised)',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.75rem',
                      color: 'var(--fg)',
                    }}
                    labelStyle={{ color: 'var(--fg-faint)' }}
                    labelFormatter={(idx) => `Match ${idx}`}
                    formatter={(value, name) => [Math.round(value), formatModel(name)]}
                  />
                  <Legend
                    formatter={(value) => formatModel(value)}
                    wrapperStyle={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
                  />
                  {modelKeys.map((model) => (
                    <Line
                      key={model}
                      type="monotone"
                      dataKey={model}
                      stroke={seatOf(model).color}
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
      </div>
    </main>
  );
}
