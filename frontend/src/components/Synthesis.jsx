import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight, Brain, MessageSquarePlus, Copy, Check, DollarSign, Plus, RefreshCw } from 'lucide-react';
import { formatCost, getReasoningText } from '../lib/formatting';
import './Synthesis.css';

export default function Synthesis({
  synthesis,
  participantMapping,
  originalQuestion,
  conversationId,
  onForkConversation,
  onExtendDebate,
  onRetrySynthesis,
  isExtending = false,
  isLoading = false,
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
  const synthesisCost = synthesis.metrics?.cost || 0;
  const isSynthesisError = content.startsWith('Error:');

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
        <div className="synthesis-header-actions">
          {synthesisCost > 0 && (
            <span className="synthesis-cost" title="Synthesis cost">
              <DollarSign size={12} />
              {formatCost(synthesisCost)}
            </span>
          )}
          <button className="copy-btn" onClick={handleCopy} title="Copy synthesis">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{reasoningText}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        <div className={`synthesis-text markdown-content${isSynthesisError ? ' synthesis-error' : ''}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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

      {/* Action buttons */}
      <div className="synthesis-actions">
        {/* Retry synthesis button when chairman failed */}
        {isSynthesisError && onRetrySynthesis && (
          <button
            className="retry-synthesis-btn"
            onClick={onRetrySynthesis}
            disabled={isLoading}
            title="Re-run the chairman synthesis using existing Stage 1 and Stage 2 data"
          >
            {isLoading ? (
              <>
                <span className="spinner-small"></span>
                Retrying...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                Retry Synthesis
              </>
            )}
          </button>
        )}

        {/* One more round button for Arena mode */}
        {isArena && onExtendDebate && (
          <button
            className="extend-debate-btn"
            onClick={onExtendDebate}
            disabled={isExtending}
            title="Add one more deliberation round"
          >
            {isExtending ? (
              <>
                <span className="spinner-small"></span>
                Extending...
              </>
            ) : (
              <>
                <Plus size={16} />
                One More Round
              </>
            )}
          </button>
        )}

        {/* Continue discussion button */}
        {onForkConversation && originalQuestion && (
          <button
            className="continue-btn"
            onClick={handleContinueDiscussion}
            title="Start a new conversation with this context"
          >
            <MessageSquarePlus size={16} />
            Continue Discussion
          </button>
        )}
      </div>
    </div>
  );
}
