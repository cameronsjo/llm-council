import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, Brain, Copy, Check, RotateCw, Hash, Coins } from 'lucide-react';
import MetricsDisplay from './MetricsDisplay';
import { SeatAvatar } from './ui';
import { useSeatColors } from '../hooks/useSeatColors';
import { formatCost, formatLatency, formatTokens, getReasoningText } from '../lib/formatting';
import {
  deAnonymizeText,
  getResponseContent,
  getTabLabel,
  getModelDisplayName,
  getRoundCost,
} from '../lib/roundUtils';
import './Round.css';

// Round type labels for display
const ROUND_TYPE_LABELS = {
  responses: 'First opinions',
  rankings: 'Peer review',
  opening: 'Opening',
  rebuttal: 'Rebuttal',
  closing: 'Closing',
};

export default function Round({
  round,
  participantMapping,
  isCollapsible = false,
  defaultCollapsed = false,
  showMetrics = false,
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { seatOf } = useSeatColors();

  if (!round || !round.responses || round.responses.length === 0) {
    return null;
  }

  const roundType = round.round_type;
  const isRankings = roundType === 'rankings';
  const isArenaRound = ['opening', 'rebuttal', 'closing'].includes(roundType);
  const roundLabel = ROUND_TYPE_LABELS[roundType] || `Round ${round.round_number}`;

  const roundCost = getRoundCost(round);

  const currentResponse = round.responses[activeTab];
  const currentSeat = seatOf(currentResponse.model);
  const reasoningText = getReasoningText(currentResponse.reasoning_details);
  const hasReasoning = !!reasoningText;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getResponseContent(currentResponse));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Round header — shared by both paths
  const roundHeader = (
    <div
      className={`round-header ${isCollapsible ? 'collapsible' : ''}`}
      onClick={isCollapsible ? () => setIsCollapsed(!isCollapsed) : undefined}
    >
      <div className="round-title-row">
        {round.round_number && <span className="round-number">Round {round.round_number}</span>}
        <h3 className="round-title">{roundLabel}</h3>
        {roundCost > 0 && (
          <span className="round-cost" title="Cost for this round">
            <Coins size={11} strokeWidth={2} />
            {formatCost(roundCost)}
          </span>
        )}
      </div>
      {isCollapsible && (
        <button className="collapse-toggle" aria-label={isCollapsed ? 'Expand' : 'Collapse'}>
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
    </div>
  );

  // Arena rounds render as a 2-column debate grid instead of tabs
  if (isArenaRound) {
    return (
      <div className={`round round-${roundType} ${isCollapsed ? 'collapsed' : ''}`}>
        {roundHeader}
        {!isCollapsed && (
          <div className="arena-round-grid">
            {round.responses.map((resp, index) => {
              const modelId =
                resp.model || (participantMapping && participantMapping[resp.participant]) || null;
              const seat = seatOf(modelId);
              const modelName = getModelDisplayName(resp, participantMapping);
              const shortName = modelName?.split('/')[1] || modelName || resp.participant;
              const role = index === 0 ? 'FOR' : 'AGAINST';

              return (
                <div
                  key={index}
                  className="arena-card"
                  style={{ borderTop: `3px solid ${seat.color}` }}
                >
                  <div className="arena-card-header">
                    <span className="arena-seat-dot" style={{ background: seat.color }} />
                    <span className="arena-card-name">{shortName}</span>
                    <span className="arena-card-role" style={{ color: seat.color }}>
                      {role}
                    </span>
                  </div>
                  <div className="arena-card-body markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {getResponseContent(resp)}
                    </ReactMarkdown>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Council rounds (Stage 1 responses, Stage 2 rankings) — tab layout
  return (
    <div className={`round round-${roundType} ${isCollapsed ? 'collapsed' : ''}`}>
      {roundHeader}

      {!isCollapsed && (
        <>
          {isRankings && (
            <p className="round-description">
              Each model evaluated all responses (anonymized as Response A, B, C, etc.) and provided
              rankings. Below, model names are shown in <strong>bold</strong> for readability, but
              the original evaluation used anonymous labels.
            </p>
          )}

          {/* Tab bar — one tab per model, seat dot + short name */}
          <div className="tabs round-tabs" role="tablist" aria-label={`${roundLabel} tabs`}>
            {round.responses.map((resp, index) => {
              const seat = seatOf(resp.model);
              const isActive = activeTab === index;
              return (
                <button
                  key={resp.model ?? index}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  className={`tab ${isActive ? 'active' : ''}`}
                  style={isActive ? { '--tab-accent-color': seat.color } : undefined}
                  onClick={() => setActiveTab(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight') {
                      setActiveTab((activeTab + 1) % round.responses.length);
                    } else if (e.key === 'ArrowLeft') {
                      setActiveTab(
                        (activeTab - 1 + round.responses.length) % round.responses.length
                      );
                    }
                  }}
                >
                  <span
                    className="tab-seat-dot"
                    style={{ background: seat.color, opacity: isActive ? 1 : 0.55 }}
                  />
                  {getTabLabel(resp, false)}
                  {resp.reasoning_details && (
                    <Brain size={12} className="reasoning-indicator" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Active tab panel */}
          <div className="tab-content" role="tabpanel">
            <div className="tab-content-header">
              <div className="model-info">
                <SeatAvatar
                  color={currentSeat.color}
                  name={getModelDisplayName(currentResponse, participantMapping)}
                  size={28}
                />
                <div className="model-name-group">
                  <span className="model-name">
                    {(() => {
                      const full = getModelDisplayName(currentResponse, participantMapping);
                      return full?.split('/')[1] || full;
                    })()}
                  </span>
                  {currentResponse.participant && (
                    <span className="model-anon-id">{currentResponse.participant}</span>
                  )}
                </div>
              </div>
              <div className="tab-header-actions">
                {currentResponse.stance && (
                  <span
                    className="stance-chip"
                    style={{
                      color: currentSeat.color,
                      background: currentSeat.soft,
                    }}
                  >
                    {currentResponse.stance}
                  </span>
                )}
                <button className="copy-btn" onClick={handleCopy} title="Copy response">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            {hasReasoning && (
              <div className="reasoning-section">
                <button
                  className="reasoning-toggle"
                  onClick={() => setReasoningExpanded(!reasoningExpanded)}
                >
                  {reasoningExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <Brain size={14} />
                  <span>Reasoning Process</span>
                </button>
                {reasoningExpanded && (
                  <div className="reasoning-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{reasoningText}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}

            <div className="response-content markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {isRankings
                  ? deAnonymizeText(getResponseContent(currentResponse), participantMapping)
                  : getResponseContent(currentResponse)}
              </ReactMarkdown>
            </div>

            {/* Extracted ranking for peer-review round */}
            {isRankings && currentResponse.parsed_ranking?.length > 0 && (
              <div className="parsed-ranking">
                <strong>Extracted Ranking:</strong>
                <ol>
                  {currentResponse.parsed_ranking.map((label, i) => (
                    <li key={i}>
                      {participantMapping?.[label]
                        ? participantMapping[label].split('/')[1] || participantMapping[label]
                        : label}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Per-response metrics row */}
            {currentResponse.metrics && (
              <div className="response-metrics">
                {currentResponse.metrics.latency_ms != null && (
                  <span className="response-metric">
                    <RotateCw size={11} strokeWidth={2} className="metric-glyph" />
                    <span className="metric-val">
                      {formatLatency(currentResponse.metrics.latency_ms)}
                    </span>
                  </span>
                )}
                {currentResponse.metrics.tokens != null && (
                  <span className="response-metric">
                    <Hash size={11} strokeWidth={2} className="metric-glyph" />
                    <span className="metric-val">
                      {formatTokens(currentResponse.metrics.tokens)}
                    </span>
                  </span>
                )}
                {formatCost(currentResponse.metrics.cost) && (
                  <span className="response-metric">
                    <Coins size={11} strokeWidth={2} className="metric-glyph" />
                    <span className="metric-val">{formatCost(currentResponse.metrics.cost)}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Aggregate peer standings for rankings round */}
          {isRankings && round.metadata?.aggregate_rankings?.length > 0 && (
            <div className="aggregate-rankings">
              <h4 className="aggregate-rankings-title">Peer standings</h4>
              <p className="aggregate-rankings-desc">
                Aggregate rank across all ballots — lower is better.
              </p>
              <div className="aggregate-list">
                {round.metadata.aggregate_rankings.map((agg, index) => {
                  const seat = seatOf(agg.model);
                  const N = round.metadata.aggregate_rankings.length;
                  const barWidth =
                    N > 1 ? Math.max(8, ((N - agg.average_rank + 1) / N) * 100) : 100;
                  return (
                    <div key={agg.model} className="aggregate-item">
                      <span className="rank-position">#{index + 1}</span>
                      <span className="rank-dot" style={{ background: seat.color }} />
                      <span className="rank-model">{agg.model.split('/')[1] || agg.model}</span>
                      <div className="rank-bar-track">
                        <div
                          className="rank-bar-fill"
                          style={{ width: `${barWidth}%`, background: seat.color }}
                        />
                      </div>
                      <span className="rank-score">{agg.average_rank.toFixed(2)}</span>
                      <span className="rank-votes">{agg.rankings_count} votes</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {showMetrics && round.metrics && <MetricsDisplay metrics={round.metrics} />}
        </>
      )}
    </div>
  );
}
