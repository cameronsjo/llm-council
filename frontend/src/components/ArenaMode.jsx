import { useState } from 'react';
import ArenaRound from './ArenaRound';
import ArenaSynthesis from './ArenaSynthesis';
import './ArenaMode.css';

export default function ArenaMode({ rounds, synthesis, participantMapping, loading }) {
  // Track which rounds are collapsed (default: none collapsed)
  const [collapsedRounds, setCollapsedRounds] = useState(new Set());

  const toggleRoundCollapse = (roundNumber) => {
    setCollapsedRounds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(roundNumber)) {
        newSet.delete(roundNumber);
      } else {
        newSet.add(roundNumber);
      }
      return newSet;
    });
  };

  const collapseAll = () => {
    if (rounds) {
      setCollapsedRounds(new Set(rounds.map((r) => r.round_number)));
    }
  };

  const expandAll = () => {
    setCollapsedRounds(new Set());
  };

  const hasRounds = rounds && rounds.length > 0;
  const hasSynthesis = synthesis && synthesis.content;

  return (
    <div className="arena-mode">
      <div className="arena-header">
        <h3 className="arena-title">Arena Debate</h3>
        {hasRounds && rounds.length > 1 && (
          <div className="arena-controls">
            <button className="control-btn" onClick={expandAll}>
              Expand All
            </button>
            <button className="control-btn" onClick={collapseAll}>
              Collapse All
            </button>
          </div>
        )}
      </div>

      <div className="arena-rounds">
        {hasRounds &&
          rounds.map((round) => (
            <ArenaRound
              key={round.round_number}
              round={round}
              participantMapping={participantMapping}
              isCollapsed={collapsedRounds.has(round.round_number)}
              onToggleCollapse={() => toggleRoundCollapse(round.round_number)}
            />
          ))}

        {loading?.round && (
          <div className="round-loading">
            <div className="loading-spinner"></div>
            <span>
              {loading.roundType === 'initial'
                ? 'Collecting initial positions...'
                : `Round ${loading.roundNumber}: Deliberating...`}
            </span>
          </div>
        )}
      </div>

      {loading?.synthesis && (
        <div className="synthesis-loading">
          <div className="loading-spinner"></div>
          <span>Synthesizing debate outcomes...</span>
        </div>
      )}

      {hasSynthesis && (
        <ArenaSynthesis synthesis={synthesis} participantMapping={participantMapping} />
      )}
    </div>
  );
}
