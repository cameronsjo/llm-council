import { useState, useRef, useEffect } from 'react';
import { Star, Settings, ChevronDown, Crown, Users } from 'lucide-react';
import './CouncilDisplay.css';

/**
 * Extract short model name from full identifier.
 * e.g., "openai/gpt-4" -> "Gpt-4"
 */
function getShortModelName(model) {
  const name = model.split('/').pop();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Get provider from model identifier for visual grouping.
 */
function getProvider(model) {
  const provider = model.split('/')[0];
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/**
 * Council members display - Distinguished roster panel.
 */
export function CouncilDisplay({
  councilModels,
  chairmanModel,
  onOpenConfig,
  onOpenCuration,
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const contentRef = useRef(null);

  // Handle expand/collapse animation
  useEffect(() => {
    if (contentRef.current) {
      if (isExpanded) {
        contentRef.current.style.maxHeight = `${contentRef.current.scrollHeight}px`;
      } else {
        contentRef.current.style.maxHeight = '0px';
      }
    }
  }, [isExpanded, councilModels]);

  const handleToggle = () => {
    setIsAnimating(true);
    setIsExpanded(!isExpanded);
    setTimeout(() => setIsAnimating(false), 300);
  };

  if (councilModels.length === 0) {
    return null;
  }

  // Separate chairman from regular members
  const regularMembers = councilModels.filter((m) => m !== chairmanModel);
  const chairmanInCouncil = councilModels.includes(chairmanModel);

  return (
    <div className="council-panel">
      {/* Decorative top border */}
      <div className="council-panel-accent" />

      {/* Header */}
      <div className="council-panel-header">
        <button
          className="council-panel-toggle"
          onClick={handleToggle}
          aria-expanded={isExpanded}
        >
          <div className="council-panel-title">
            <Users size={14} className="council-icon" />
            <span>The Council</span>
            <span className="council-count">{councilModels.length}</span>
          </div>
          <ChevronDown
            size={16}
            className={`council-chevron ${isExpanded ? 'expanded' : ''}`}
          />
        </button>

        <div className="council-panel-actions">
          <button
            className="council-action-btn curate"
            onClick={onOpenCuration}
            title="Curate favorites"
          >
            <Star size={14} />
          </button>
          <button
            className="council-action-btn configure"
            onClick={onOpenConfig}
            title="Configure council"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Members List */}
      <div
        ref={contentRef}
        className={`council-panel-content ${isAnimating ? 'animating' : ''}`}
      >
        {/* Chairman Section */}
        {chairmanModel && (
          <div className="council-chairman-section">
            <div className="council-section-label">
              <Crown size={12} />
              <span>Chairman</span>
            </div>
            <div className="council-member chairman" title={chairmanModel}>
              <div className="member-indicator chairman" />
              <span className="member-name">{getShortModelName(chairmanModel)}</span>
              <span className="member-provider">{getProvider(chairmanModel)}</span>
            </div>
          </div>
        )}

        {/* Regular Members Section */}
        {regularMembers.length > 0 && (
          <div className="council-members-section">
            <div className="council-section-label">
              <Users size={12} />
              <span>Members</span>
            </div>
            <div className="council-members-list">
              {regularMembers.map((model, idx) => (
                <div
                  key={model}
                  className="council-member"
                  title={model}
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  <div className="member-indicator" />
                  <span className="member-name">{getShortModelName(model)}</span>
                  <span className="member-provider">{getProvider(model)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chairman also as member indicator */}
        {chairmanInCouncil && regularMembers.length > 0 && (
          <div className="council-footnote">
            Chairman also participates as council member
          </div>
        )}
      </div>
    </div>
  );
}
