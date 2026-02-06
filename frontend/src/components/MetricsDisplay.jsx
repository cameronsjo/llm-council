import { useState } from 'react';
import { formatCostAlways, formatLatency, formatTokens } from '../lib/formatting';
import './MetricsDisplay.css';

/**
 * Display aggregated metrics (cost, tokens, latency) for a council response.
 */
export default function MetricsDisplay({ metrics }) {
  const [expanded, setExpanded] = useState(false);

  if (!metrics || metrics.total_cost === 0) return null;

  const byStage = metrics.by_stage || {};

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
              <span className="stage-name">Stage 1 (Responses)</span>
              <span className="stage-cost">{formatCostAlways(byStage.stage1?.cost || 0)}</span>
              <span className="stage-tokens">{formatTokens(byStage.stage1?.tokens || 0)} tokens</span>
              <span className="stage-latency">{formatLatency(byStage.stage1?.latency_ms || 0)}</span>
            </div>
            <div className="stage-row">
              <span className="stage-name">Stage 2 (Rankings)</span>
              <span className="stage-cost">{formatCostAlways(byStage.stage2?.cost || 0)}</span>
              <span className="stage-tokens">{formatTokens(byStage.stage2?.tokens || 0)} tokens</span>
              <span className="stage-latency">{formatLatency(byStage.stage2?.latency_ms || 0)}</span>
            </div>
            <div className="stage-row">
              <span className="stage-name">Stage 3 (Synthesis)</span>
              <span className="stage-cost">{formatCostAlways(byStage.stage3?.cost || 0)}</span>
              <span className="stage-tokens">{formatTokens(byStage.stage3?.tokens || 0)} tokens</span>
              <span className="stage-latency">{formatLatency(byStage.stage3?.latency_ms || 0)}</span>
            </div>
          </div>

          {(byStage.stage1?.models?.length > 0 || byStage.stage2?.models?.length > 0) && (
            <div className="model-metrics">
              <div className="model-metrics-header">Per-Model Breakdown</div>
              {byStage.stage1?.models?.map((m, i) => (
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
