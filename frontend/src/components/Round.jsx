import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronRight, Brain, Copy, Check, DollarSign } from 'lucide-react';
import MetricsDisplay from './MetricsDisplay';
import './Round.css';

// Format cost for display
function formatCost(cost) {
  if (!cost || cost === 0) return null;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

// Round type labels for display
const ROUND_TYPE_LABELS = {
  responses: 'Individual Responses',
  rankings: 'Peer Rankings',
  opening: 'Opening Statements',
  rebuttal: 'Rebuttals',
  closing: 'Closing Arguments',
};

// Extract reasoning text from various formats
function getReasoningText(reasoningDetails) {
  if (!reasoningDetails) return null;
  if (typeof reasoningDetails === 'string') return reasoningDetails;

  if (Array.isArray(reasoningDetails)) {
    return reasoningDetails
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item.summary) return item.summary;
        if (item.content) return item.content;
        return null;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  if (reasoningDetails.summary) return reasoningDetails.summary;
  if (reasoningDetails.content) return reasoningDetails.content;
  return null;
}

// De-anonymize text by replacing labels with model names
function deAnonymizeText(text, participantMapping) {
  if (!participantMapping) return text;

  let result = text;
  Object.entries(participantMapping).forEach(([label, model]) => {
    const modelShortName = model.split('/')[1] || model;
    result = result.replace(new RegExp(label, 'g'), `**${modelShortName}**`);
  });
  return result;
}

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

  if (!round || !round.responses || round.responses.length === 0) {
    return null;
  }

  const roundType = round.round_type;
  const isRankings = roundType === 'rankings';
  const isArenaRound = ['opening', 'rebuttal', 'closing'].includes(roundType);
  const roundLabel = ROUND_TYPE_LABELS[roundType] || `Round ${round.round_number}`;

  // Calculate round cost from metrics or responses
  const getRoundCost = () => {
    if (round.metrics?.cost) return round.metrics.cost;
    if (round.metrics?.total_cost) return round.metrics.total_cost;
    // Sum from individual responses
    let total = 0;
    for (const resp of round.responses) {
      const cost = resp.metrics?.cost || 0;
      total += cost;
    }
    return total;
  };
  const roundCost = getRoundCost();

  const currentResponse = round.responses[activeTab];
  const reasoningText = getReasoningText(currentResponse.reasoning_details);
  const hasReasoning = !!reasoningText;

  // Get content - unified format uses 'content', legacy uses 'response' or 'ranking'
  const getContent = (resp) => resp.content || resp.response || resp.ranking || '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getContent(currentResponse));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Get tab label - use participant for arena, model for council
  const getTabLabel = (resp) => {
    if (isArenaRound) {
      return resp.participant;
    }
    return resp.model?.split('/')[1] || resp.model || resp.participant;
  };

  // Get model display name
  const getModelName = (resp) => {
    if (participantMapping && resp.participant) {
      return participantMapping[resp.participant] || resp.model;
    }
    return resp.model;
  };

  return (
    <div className={`round round-${roundType} ${isCollapsed ? 'collapsed' : ''}`}>
      <div
        className={`round-header ${isCollapsible ? 'collapsible' : ''}`}
        onClick={isCollapsible ? () => setIsCollapsed(!isCollapsed) : undefined}
      >
        <div className="round-title-row">
          {round.round_number && <span className="round-number">Round {round.round_number}</span>}
          <h3 className="round-title">{roundLabel}</h3>
          {roundCost > 0 && (
            <span className="round-cost" title="Cost for this round">
              <DollarSign size={12} />
              {formatCost(roundCost)}
            </span>
          )}
        </div>
        {isCollapsible && (
          <button className="collapse-toggle" aria-label={isCollapsed ? 'Expand' : 'Collapse'}>
            {isCollapsed ? '▶' : '▼'}
          </button>
        )}
      </div>

      {!isCollapsed && (
        <>
          {isRankings && (
            <p className="round-description">
              Each model evaluated all responses (anonymized as Response A, B, C, etc.) and provided
              rankings. Below, model names are shown in <strong>bold</strong> for readability, but
              the original evaluation used anonymous labels.
            </p>
          )}

          <div className="tabs" role="tablist" aria-label={`${roundLabel} tabs`}>
            {round.responses.map((resp, index) => (
              <button
                key={index}
                role="tab"
                aria-selected={activeTab === index}
                tabIndex={activeTab === index ? 0 : -1}
                className={`tab ${activeTab === index ? 'active' : ''}`}
                onClick={() => setActiveTab(index)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') {
                    setActiveTab((activeTab + 1) % round.responses.length);
                  } else if (e.key === 'ArrowLeft') {
                    setActiveTab((activeTab - 1 + round.responses.length) % round.responses.length);
                  }
                }}
              >
                {getTabLabel(resp)}
                {resp.reasoning_details && (
                  <Brain size={12} className="reasoning-indicator" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>

          <div className="tab-content" role="tabpanel">
            <div className="tab-content-header">
              <div className="model-info">
                {isArenaRound && (
                  <span className="participant-label">{currentResponse.participant}</span>
                )}
                <span className="model-name">{getModelName(currentResponse)}</span>
              </div>
              <button className="copy-btn" onClick={handleCopy} title="Copy response">
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
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
                    <ReactMarkdown>{reasoningText}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}

            <div className="response-content markdown-content">
              <ReactMarkdown>
                {isRankings
                  ? deAnonymizeText(getContent(currentResponse), participantMapping)
                  : getContent(currentResponse)}
              </ReactMarkdown>
            </div>

            {/* Parsed ranking for rankings round */}
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
          </div>

          {/* Aggregate rankings for rankings round */}
          {isRankings && round.metadata?.aggregate_rankings?.length > 0 && (
            <div className="aggregate-rankings">
              <h4>Aggregate Rankings (Street Cred)</h4>
              <p className="description">
                Combined results across all peer evaluations (lower score is better):
              </p>
              <div className="aggregate-list">
                {round.metadata.aggregate_rankings.map((agg, index) => (
                  <div key={index} className="aggregate-item">
                    <span className="rank-position">#{index + 1}</span>
                    <span className="rank-model">{agg.model.split('/')[1] || agg.model}</span>
                    <span className="rank-score">Avg: {agg.average_rank.toFixed(2)}</span>
                    <span className="rank-count">({agg.rankings_count} votes)</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showMetrics && round.metrics && <MetricsDisplay metrics={round.metrics} />}
        </>
      )}
    </div>
  );
}
