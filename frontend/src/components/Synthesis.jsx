import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ChevronDown,
  ChevronRight,
  Brain,
  Copy,
  Check,
  Crown,
  GitFork,
  RotateCw,
  Plus,
  Coins,
} from 'lucide-react';
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
      {/* Chairman header — ember icon + title + subline */}
      <div className="synthesis-chairman-header">
        <span className="synthesis-chairman-icon">
          <Crown size={14} strokeWidth={2} />
        </span>
        <div className="synthesis-chairman-info">
          <span className="synthesis-chairman-title">
            {isArena ? "Chairman's ruling" : "Chairman's synthesis"}
          </span>
          <span className="synthesis-chairman-sub">
            {isArena ? `de-anonymized · ${modelName}` : 'weighted by peer standings'}
          </span>
        </div>
        {hasReasoning && (
          <Brain size={14} className="synthesis-reasoning-indicator" aria-hidden="true" />
        )}
        {synthesisCost > 0 && (
          <span className="synthesis-cost" title="Synthesis cost">
            <Coins size={11} strokeWidth={2} />
            {formatCost(synthesisCost)}
          </span>
        )}
      </div>

      {/* Chairman reasoning */}
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

      {/* Final answer prose */}
      <div
        className={`synthesis-text markdown-content${isSynthesisError ? ' synthesis-error' : ''}`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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

      {/* Action row */}
      <div className="synthesis-actions">
        {/* Primary: solid ember copy button */}
        <button className="synthesis-copy-btn" onClick={handleCopy} title="Copy synthesis">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          Copy answer
        </button>

        {/* Fork & refine */}
        {onForkConversation && originalQuestion && (
          <button
            className="synthesis-ghost-btn"
            onClick={handleContinueDiscussion}
            title="Start a new conversation with this context"
          >
            <GitFork size={14} />
            Fork &amp; refine
          </button>
        )}

        {/* Re-synthesize — shown when chairman failed */}
        {isSynthesisError && onRetrySynthesis && (
          <button
            className="synthesis-ghost-btn"
            onClick={onRetrySynthesis}
            disabled={isLoading}
            title="Re-run the chairman synthesis using existing Stage 1 and Stage 2 data"
          >
            {isLoading ? <span className="spinner-small" /> : <RotateCw size={14} />}
            {isLoading ? 'Retrying…' : 'Re-synthesize'}
          </button>
        )}

        {/* One more round — Arena mode only */}
        {isArena && onExtendDebate && (
          <button
            className="synthesis-ghost-btn"
            onClick={onExtendDebate}
            disabled={isExtending}
            title="Add one more deliberation round"
          >
            {isExtending ? <span className="spinner-small" /> : <Plus size={14} />}
            {isExtending ? 'Extending…' : 'One More Round'}
          </button>
        )}
      </div>
    </div>
  );
}
