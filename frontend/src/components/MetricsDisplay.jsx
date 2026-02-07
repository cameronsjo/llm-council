import { useState } from 'react';
import { formatCostAlways, formatLatency, formatTokens } from '../lib/formatting';
import './MetricsDisplay.css';

/**
 * Display aggregated metrics (cost, tokens, latency) for a council response.
 * Supports both new keys (responses/rankings/synthesis) and legacy keys (stage1/stage2/stage3).
 */
export default function MetricsDisplay({ metrics }) {
  const [expanded, setExpanded] = useState(false);

  if (!metrics || metrics.total_cost === 0) return null;

  const byStage = metrics.by_stage || {};
  // Support both new and legacy keys for backward compat with old conversations
  const responses = byStage.responses || byStage.stage1 || {};
  const rankings = byStage.rankings || byStage.stage2 || {};
  const synthesis = byStage.synthesis || byStage.stage3 || {};

  return (
    <div className="metrics-display">
      <div className="metrics-summary" onClick={() => setExpanded(!expanded)}>
        <div className="metrics-row">
          <div className="metric">
            <span className="metric-icon">💰</span>
            <span className="metric-value">{formatCostAlways(metrics.total_cost)}</span>
            <span className="metric-label">cost</span>
          </div>
          <div className="metric">
            <span className="metric-icon">📝</span>
            <span className="metric-value">{formatTokens(metrics.total_tokens)}</span>
            <span className="metric-label">tokens</span>
          </div>
          <div className="metric">
            <span className="metric-icon">⏱️</span>
            <span className="metric-value">{formatLatency(metrics.total_latency_ms)}</span>
            <span className="metric-label">latency</span>
          </div>
          <button className="expand-btn" aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="metrics-details">
          <div className="stage-metrics">
            <div className="stage-row">
              <span className="stage-name">Responses</span>
              <span className="stage-cost">{formatCostAlways(responses.cost || 0)}</span>
              <span className="stage-tokens">{formatTokens(responses.tokens || 0)} tokens</span>
              <span className="stage-latency">{formatLatency(responses.latency_ms || 0)}</span>
            </div>
            <div className="stage-row">
              <span className="stage-name">Rankings</span>
              <span className="stage-cost">{formatCostAlways(rankings.cost || 0)}</span>
              <span className="stage-tokens">{formatTokens(rankings.tokens || 0)} tokens</span>
              <span className="stage-latency">{formatLatency(rankings.latency_ms || 0)}</span>
            </div>
            <div className="stage-row">
              <span className="stage-name">Synthesis</span>
              <span className="stage-cost">{formatCostAlways(synthesis.cost || 0)}</span>
              <span className="stage-tokens">{formatTokens(synthesis.tokens || 0)} tokens</span>
              <span className="stage-latency">{formatLatency(synthesis.latency_ms || 0)}</span>
            </div>
          </div>

          {(responses.models?.length > 0 || rankings.models?.length > 0) && (
            <div className="model-metrics">
              <div className="model-metrics-header">Per-Model Breakdown</div>
              {responses.models?.map((m, i) => (
                <div key={`s1-${i}`} className="model-row">
                  <span className="model-name" title={m.model}>{m.model?.split('/').pop()}</span>
                  <span className="model-cost">{formatCostAlways(m.cost)}</span>
                  <span className="model-latency">{formatLatency(m.latency_ms)}</span>
                  <span className="model-provider">{m.provider}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
