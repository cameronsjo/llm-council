import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronRight, Brain, MessageSquarePlus } from 'lucide-react';
import './Stage3.css';

export default function Stage3({
  finalResponse,
  originalQuestion,
  conversationId,
  onForkConversation,
}) {
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  if (!finalResponse) {
    return null;
  }

  const hasReasoning = finalResponse.reasoning_details;

  const handleContinueDiscussion = () => {
    if (onForkConversation && originalQuestion && finalResponse.response) {
      onForkConversation(originalQuestion, finalResponse.response, conversationId);
    }
  };

  return (
    <div className="stage stage3">
      <h3 className="stage-title">Stage 3: Final Council Answer</h3>
      <div className="final-response">
        <div className="chairman-label">
          Chairman: {finalResponse.model.split('/')[1] || finalResponse.model}
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
                <ReactMarkdown>{finalResponse.reasoning_details}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        <div className="final-text markdown-content">
          <ReactMarkdown>{finalResponse.response}</ReactMarkdown>
        </div>

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
    </div>
  );
}
