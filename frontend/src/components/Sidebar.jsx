import { useState } from 'react';
import './Sidebar.css';

// Extract short model name from full identifier (e.g., "openai/gpt-5.1" -> "GPT-5.1")
function getShortModelName(model) {
  const name = model.split('/').pop();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  councilModels = [],
  chairmanModel = '',
}) {
  const [showModels, setShowModels] = useState(false);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>LLM Council</h1>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Conversation
        </button>
      </div>

      <div className="conversation-list">
        {conversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${
                conv.id === currentConversationId ? 'active' : ''
              }`}
              onClick={() => onSelectConversation(conv.id)}
            >
              <div className="conversation-title">
                {conv.title || 'New Conversation'}
              </div>
              <div className="conversation-meta">
                {conv.message_count} messages
              </div>
            </div>
          ))
        )}
      </div>

      {councilModels.length > 0 && (
        <div className="council-config">
          <button
            className="council-toggle"
            onClick={() => setShowModels(!showModels)}
          >
            <span>Council Members</span>
            <span className="toggle-icon">{showModels ? '▼' : '▶'}</span>
          </button>
          {showModels && (
            <div className="council-models">
              {councilModels.map((model, idx) => (
                <div key={idx} className="model-item">
                  <span className="model-badge">
                    {model === chairmanModel ? '👑' : ''}
                  </span>
                  <span className="model-name" title={model}>
                    {getShortModelName(model)}
                  </span>
                </div>
              ))}
              {chairmanModel && !councilModels.includes(chairmanModel) && (
                <div className="model-item chairman">
                  <span className="model-badge">👑</span>
                  <span className="model-name" title={chairmanModel}>
                    {getShortModelName(chairmanModel)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
