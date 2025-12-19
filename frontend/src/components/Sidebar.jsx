import { useState } from 'react';
import './Sidebar.css';
import ModelSelector from './ModelSelector';

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
  onConfigChange,
}) {
  const [showModels, setShowModels] = useState(false);
  const [showConfigUI, setShowConfigUI] = useState(false);
  const [pendingCouncil, setPendingCouncil] = useState(councilModels);
  const [pendingChairman, setPendingChairman] = useState(chairmanModel);

  const handleOpenConfig = () => {
    setPendingCouncil(councilModels);
    setPendingChairman(chairmanModel);
    setShowConfigUI(true);
  };

  const handleSaveConfig = async () => {
    if (onConfigChange) {
      await onConfigChange(pendingCouncil, pendingChairman);
    }
    setShowConfigUI(false);
  };

  const handleCancelConfig = () => {
    setShowConfigUI(false);
  };

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
          <div className="council-header">
            <button
              className="council-toggle"
              onClick={() => setShowModels(!showModels)}
            >
              <span>Council Members</span>
              <span className="toggle-icon">{showModels ? '▼' : '▶'}</span>
            </button>
            <button
              className="configure-btn"
              onClick={handleOpenConfig}
              title="Configure models"
            >
              ⚙️
            </button>
          </div>
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

      {showConfigUI && (
        <div className="config-modal-overlay" onClick={handleCancelConfig}>
          <div className="config-modal" onClick={(e) => e.stopPropagation()}>
            <div className="config-modal-header">
              <h3>Configure Council</h3>
            </div>
            <ModelSelector
              selectedCouncil={pendingCouncil}
              selectedChairman={pendingChairman}
              onCouncilChange={setPendingCouncil}
              onChairmanChange={setPendingChairman}
              onSave={handleSaveConfig}
              onCancel={handleCancelConfig}
            />
          </div>
        </div>
      )}
    </div>
  );
}
