import { useState } from 'react';
import './Sidebar.css';
import { ConversationItem, CouncilDisplay } from './sidebar/index.js';
import ModelSelector from './ModelSelector';
import ModelCuration from './ModelCuration';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
  councilModels = [],
  chairmanModel = '',
  onConfigChange,
  userInfo = null,
}) {
  const [showConfigUI, setShowConfigUI] = useState(false);
  const [showCuration, setShowCuration] = useState(false);
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
        {userInfo?.authenticated && (
          <div className="user-info">
            <span className="user-avatar">
              {(userInfo.display_name || userInfo.username || '?')[0].toUpperCase()}
            </span>
            <span className="user-name">
              {userInfo.display_name || userInfo.username}
            </span>
          </div>
        )}
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Conversation
        </button>
      </div>

      <div className="conversation-list">
        {conversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={conv.id === currentConversationId}
              onSelect={onSelectConversation}
              onRename={onRenameConversation}
              onDelete={onDeleteConversation}
            />
          ))
        )}
      </div>

      <CouncilDisplay
        councilModels={councilModels}
        chairmanModel={chairmanModel}
        onOpenConfig={handleOpenConfig}
        onOpenCuration={() => setShowCuration(true)}
      />

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

      {showCuration && (
        <ModelCuration
          onClose={() => setShowCuration(false)}
          onSave={() => setShowCuration(false)}
        />
      )}
    </div>
  );
}
