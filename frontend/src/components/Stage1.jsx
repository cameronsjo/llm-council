import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';
import './Stage1.css';

export default function Stage1({ responses }) {
  const [activeTab, setActiveTab] = useState(0);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  if (!responses || responses.length === 0) {
    return null;
  }

  const currentResponse = responses[activeTab];
  const hasReasoning = currentResponse.reasoning_details;

  return (
    <div className="stage stage1">
      <h3 className="stage-title">Stage 1: Individual Responses</h3>

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
        <div className="model-name">{currentResponse.model}</div>

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
                <ReactMarkdown>{currentResponse.reasoning_details}</ReactMarkdown>
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
