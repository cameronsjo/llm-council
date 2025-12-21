import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronRight, Brain, Copy, Check } from 'lucide-react';
import './Stage1.css';

// Extract reasoning text from various formats
function getReasoningText(reasoningDetails) {
  if (!reasoningDetails) return null;

  // If it's already a string, return it
  if (typeof reasoningDetails === 'string') {
    return reasoningDetails;
  }

  // If it's an array (OpenAI format), extract summaries
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

  // If it's an object with summary or content
  if (reasoningDetails.summary) return reasoningDetails.summary;
  if (reasoningDetails.content) return reasoningDetails.content;

  return null;
}

export default function Stage1({ responses }) {
  const [activeTab, setActiveTab] = useState(0);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!responses || responses.length === 0) {
    return null;
  }

  const currentResponse = responses[activeTab];
  const reasoningText = getReasoningText(currentResponse.reasoning_details);
  const hasReasoning = !!reasoningText;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentResponse.response);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="stage stage1">
      <div className="stage-header">
        <h3 className="stage-title">Stage 1: Individual Responses</h3>
      </div>

      <div className="tabs">
        {responses.map((resp, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            {resp.model.split('/')[1] || resp.model}
            {resp.reasoning_details && <Brain size={12} className="reasoning-indicator" />}
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className="tab-content-header">
          <div className="model-name">{currentResponse.model}</div>
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

        <div className="response-text markdown-content">
          <ReactMarkdown>{currentResponse.response}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
