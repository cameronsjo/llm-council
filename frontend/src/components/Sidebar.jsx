import { useState, useEffect, useRef } from 'react';
import { Moon, Sun, Monitor, X } from 'lucide-react';
import './Sidebar.css';
import { ConversationItem, CouncilDisplay } from './sidebar/index.js';
import ModelSelector from './ModelSelector';
import ModelCuration from './ModelCuration';
import VersionInfo from './VersionInfo';
import { useTheme } from '../hooks';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
  onExportConversation,
  councilModels = [],
  chairmanModel = '',
  onConfigChange,
  userInfo = null,
  isOpen = true,
  onClose,
}) {
  const [showConfigUI, setShowConfigUI] = useState(false);
  const [showCuration, setShowCuration] = useState(false);
  const [pendingCouncil, setPendingCouncil] = useState(councilModels);
  const [pendingChairman, setPendingChairman] = useState(chairmanModel);
  const { theme, cycleTheme } = useTheme();
  const modalRef = useRef(null);

  // Focus trap and keyboard handling for modal
  useEffect(() => {
    if (!showConfigUI || !modalRef.current) return;

    const modal = modalRef.current;
    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Focus first element
    firstElement?.focus();

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleCancelConfig();
        return;
      }
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showConfigUI]);

  const themeIcon = {
    system: <Monitor size={16} />,
    light: <Sun size={16} />,
    dark: <Moon size={16} />,
  }[theme];

  const themeLabel = {
    system: 'System',
    light: 'Light',
    dark: 'Dark',
  }[theme];

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
        <div className="sidebar-title-row">
          <h1>LLM Council</h1>
          {onClose && (
            <button
              className="sidebar-close-btn"
              onClick={onClose}
              aria-label="Close sidebar"
            >
              <X size={20} />
            </button>
          )}
        </div>
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
              onExport={onExportConversation}
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

      <div className="sidebar-footer">
        <button
          className="theme-toggle"
          onClick={cycleTheme}
          title={`Theme: ${themeLabel}`}
        >
          {themeIcon}
          <span>{themeLabel}</span>
        </button>
        <VersionInfo />
      </div>

      {showConfigUI && (
        <div
          className="config-modal-overlay"
          onClick={handleCancelConfig}
          role="presentation"
        >
          <div
            className="config-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="config-modal-title"
            ref={modalRef}
          >
            <div className="config-modal-header">
              <h3 id="config-modal-title">Configure Council</h3>
              <button
                className="modal-close-btn"
                onClick={handleCancelConfig}
                aria-label="Close configuration dialog"
              >
                <X size={20} aria-hidden="true" />
              </button>
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
