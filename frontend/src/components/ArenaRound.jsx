import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './ArenaRound.css';

export default function ArenaRound({ round, participantMapping, isCollapsed, onToggleCollapse }) {
  const [activeTab, setActiveTab] = useState(0);

  if (!round || !round.responses || round.responses.length === 0) {
    return null;
  }

  const roundTypeLabel = round.round_type === 'initial' ? 'Initial Positions' : 'Deliberation';
  const roundTypeClass = round.round_type === 'initial' ? 'initial' : 'deliberation';

  return (
    <div className={`arena-round ${roundTypeClass} ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="round-header" onClick={onToggleCollapse}>
        <h4 className="round-title">
          <span className="round-number">Round {round.round_number}</span>
          <span className="round-type-badge">{roundTypeLabel}</span>
        </h4>
        <button className="collapse-toggle">
          {isCollapsed ? '▶' : '▼'}
        </button>
      </div>

      {!isCollapsed && (
        <>
          <div className="participant-tabs">
            {round.responses.map((resp, index) => (
              <button
                key={index}
                className={`participant-tab ${activeTab === index ? 'active' : ''}`}
                onClick={() => setActiveTab(index)}
              >
                {resp.participant}
              </button>
            ))}
          </div>

          <div className="participant-content">
            <div className="participant-info">
              <span className="participant-label">{round.responses[activeTab].participant}</span>
              {participantMapping && (
                <span className="participant-model">
                  ({participantMapping[round.responses[activeTab].participant]?.split('/')[1] ||
                    participantMapping[round.responses[activeTab].participant] ||
                    'Unknown'})
                </span>
              )}
            </div>
            <div className="participant-response markdown-content">
              <ReactMarkdown>{round.responses[activeTab].response}</ReactMarkdown>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
