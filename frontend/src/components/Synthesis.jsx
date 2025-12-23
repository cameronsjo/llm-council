import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronRight, Brain, MessageSquarePlus, Copy, Check } from 'lucide-react';
import './Synthesis.css';

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

export default function Synthesis({
  synthesis,
  participantMapping,
  originalQuestion,
  conversationId,
  onForkConversation,
  mode = 'council',
}) {
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!synthesis) {
    return null;
  }

  // Handle both unified format (content) and legacy format (response)
  const content = synthesis.content || synthesis.response || '';
  const modelName = synthesis.model?.split('/')[1] || synthesis.model || 'Chairman';
  const reasoningText = getReasoningText(synthesis.reasoning_details);
  const hasReasoning = !!reasoningText;
  const isArena = mode === 'arena';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleContinueDiscussion = () => {
    if (onForkConversation && originalQuestion && content) {
      onForkConversation(originalQuestion, content, conversationId);
    }
  };

  return (
    <div className={`synthesis synthesis-${mode}`}>
      <div className="synthesis-header">
        <h3 className="synthesis-title">{isArena ? 'Final Synthesis' : 'Final Council Answer'}</h3>
        <button className="copy-btn" onClick={handleCopy} title="Copy synthesis">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>

      <div className="synthesis-content">
        <div className="chairman-info">
          <span className="chairman-label">{isArena ? 'Synthesized by:' : 'Chairman:'}</span>
          <span className="chairman-model">{modelName}</span>
          {hasReasoning && <Brain size={14} className="reasoning-indicator" />}
        </div>

        {hasReasoning && (
          <div className="reasoning-section">
            <button
              className="reasoning-toggle"
              onClick={() => setReasoningExpanded(!reasoningExpanded)}
            >
              {reasoningExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Brain size={14} />
              <span>Chairman's Reasoning Process</span>
            </button>
            {reasoningExpanded && (
              <div className="reasoning-content">
                <ReactMarkdown>{reasoningText}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        <div className="synthesis-text markdown-content">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </div>

      {/* Participant identity reveal for Arena mode */}
      {isArena && participantMapping && Object.keys(participantMapping).length > 0 && (
        <div className="identity-reveal">
          <h4 className="reveal-title">Participant Identities</h4>
          <div className="participant-list">
            {Object.entries(participantMapping).map(([label, model]) => (
              <div key={label} className="participant-identity">
                <span className="identity-label">{label}</span>
                <span className="identity-arrow">→</span>
                <span className="identity-model">{model.split('/')[1] || model}</span>
                <span className="identity-full-model">({model})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Continue discussion button */}
      {onForkConversation && originalQuestion && (
        <div className="continue-discussion">
          <button
            className="continue-btn"
            onClick={handleContinueDiscussion}
            title="Start a new conversation with this context"
          >
            <MessageSquarePlus size={16} />
            Continue Discussion
          </button>
        </div>
      )}
    </div>
  );
}
