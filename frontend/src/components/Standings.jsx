import { useState } from 'react';
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
import { Trophy } from 'lucide-react';
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

function buildChartSeries(history) {
  // history: { model: [{ts, rating, games}, ...] }
  // Recharts wants a flat array with { idx, [model1]: r1, [model2]: r2, ... }
  // We index by global match number across ALL series so lines align.
  const allEvents = [];
  Object.entries(history).forEach(([model, snapshots]) => {
    snapshots.forEach((s) => {
      allEvents.push({ ...s, model });
    });
  });
  allEvents.sort((a, b) => (a.ts > b.ts ? 1 : a.ts < b.ts ? -1 : 0));

  const lastRatings = {};
  const series = [];
  allEvents.forEach((event, idx) => {
    lastRatings[event.model] = event.rating;
    series.push({ idx: idx + 1, ts: event.ts, ...lastRatings });
  });
  return series;
}

export default function Standings() {
  const { data: rankingsData, isLoading: leaderboardLoading, error: leaderboardError } = useRankings();
  const [selectedModel, setSelectedModel] = useState(null);
  const { data: historyData, isLoading: historyLoading } = useRankingsHistory(selectedModel);

  const leaderboard = rankingsData?.leaderboard || [];
  const history = historyData?.history || {};
  const chartData = buildChartSeries(history);
  const modelKeys = Object.keys(history);

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

      {leaderboardError && (
        <div className="standings-error" role="alert">
          Failed to load standings: {leaderboardError.message}
        </div>
      )}

      <section className="standings-section">
        <h2>Leaderboard</h2>
        {leaderboardLoading ? (
          <div className="standings-empty">Loading…</div>
        ) : leaderboard.length === 0 ? (
          <div className="standings-empty">
            No matches recorded yet. Run a council round to start tracking ratings.
          </div>
        ) : (
          <table className="standings-table">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Model</th>
                <th scope="col" className="num">Rating</th>
                <th scope="col" className="num">Games</th>
                <th scope="col">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row) => (
                <tr
                  key={row.model}
                  className={selectedModel === row.model ? 'selected' : ''}
                  onClick={() =>
                    setSelectedModel(selectedModel === row.model ? null : row.model)
                  }
                >
                  <td className="rank">{row.rank}</td>
                  <td className="model" title={row.model}>{formatModel(row.model)}</td>
                  <td className="num">{Math.round(row.rating)}</td>
                  <td className="num">{row.games}</td>
                  <td className="ts">{formatTimestamp(row.last_updated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedModel && (
          <p className="standings-filter-hint">
            Filtered to <strong>{formatModel(selectedModel)}</strong> — click again to clear.
          </p>
        )}
      </section>

      <section className="standings-section">
        <h2>Trend</h2>
        {historyLoading ? (
          <div className="standings-empty">Loading…</div>
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
