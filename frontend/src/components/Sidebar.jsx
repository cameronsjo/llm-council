import { useState, useEffect, useRef } from 'react';
import { Moon, Sun, Monitor, X, Plus, BarChart3, Settings } from 'lucide-react';
import './Sidebar.css';
import { ConversationItem, CouncilDisplay } from './sidebar/index.js';
import ModelSelector from './ModelSelector';
import ModelCuration from './ModelCuration';
import VersionInfo from './VersionInfo';
import { BrandMark } from './ui';
import { useTheme } from '../hooks';
import { getUserInitial, getUserDisplayName, getThemeLabel } from '../lib/sidebarUtils';
import { useUIStore } from '../stores/uiStore';
import {
  useConfig,
  useUserInfo,
  useConversations,
  useDeleteConversation,
  useRenameConversation,
  useUpdateConfig,
} from '../hooks/queries';
import { api } from '../api';

export default function Sidebar({ onSelectConversation, onNewConversation, isLoading = false }) {
  const { data: conversations = [] } = useConversations();
  const currentConversationId = useUIStore((s) => s.currentConversationId);
  const { data: config } = useConfig();
  const councilModels = config?.council_models || [];
  const chairmanModel = config?.chairman_model || '';
  const { data: userInfo } = useUserInfo();
  const { setSidebarOpen } = useUIStore();
  const currentView = useUIStore((s) => s.currentView);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const mode = useUIStore((s) => s.mode);
  const setMode = useUIStore((s) => s.setMode);

  const deleteConversation = useDeleteConversation();
  const renameConversation = useRenameConversation();
  const updateConfig = useUpdateConfig();
  const [showConfigUI, setShowConfigUI] = useState(false);
  const [showCuration, setShowCuration] = useState(false);
  const [pendingCouncil, setPendingCouncil] = useState(councilModels);
  const [pendingChairman, setPendingChairman] = useState(chairmanModel);
  const filterStateRef = useRef(null);
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

    firstElement?.focus();

    const handleKeyDown = (e) => {
      // Escape-to-close is owned by ModelSelector itself; trap Tab here.
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
    system: <Monitor size={14} />,
    light: <Sun size={14} />,
    dark: <Moon size={14} />,
  }[theme];

  const themeLabel = getThemeLabel(theme);

  const handleOpenConfig = () => {
    setPendingCouncil(councilModels);
    setPendingChairman(chairmanModel);
    setShowConfigUI(true);
  };

  const handleSaveConfig = async () => {
    await updateConfig.mutateAsync({
      councilModels: pendingCouncil,
      chairmanModel: pendingChairman,
    });
    setShowConfigUI(false);
  };

  const handleCancelConfig = () => {
    setShowConfigUI(false);
  };

  const handleExportConversation = async (id, format) => {
    try {
      const blob = format === 'markdown' ? await api.exportMarkdown(id) : await api.exportJson(id);

      const conv = conversations.find((c) => c.id === id);
      const title = (conv?.title || 'conversation').replace(/[^a-zA-Z0-9]/g, '_');
      const extension = format === 'markdown' ? 'md' : 'json';
      const filename = `${title}.${extension}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export conversation:', error);
    }
  };

  return (
    <div className="sidebar">
      {/* Brand lockup: BrandMark + two-tone wordmark */}
      <div className="sidebar-brand">
        <BrandMark size={30} />
        <span className="sidebar-wordmark">
          <span className="sidebar-wordmark-dim">LLM</span>
          {' Council'}
        </span>
        <button
          className="sidebar-close-btn"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        >
          <X size={18} />
        </button>
      </div>

      {/* CTA section */}
      <div className="sidebar-cta-section">
        {userInfo?.authenticated && (
          <div className="user-info">
            <span className="user-avatar">{getUserInitial(userInfo)}</span>
            <span className="user-name">{getUserDisplayName(userInfo)}</span>
          </div>
        )}
        {/* Solid ember CTA — single most prominent action */}
        <button type="button" className="new-deliberation-btn" onClick={onNewConversation}>
          <Plus size={14} aria-hidden="true" />
          New deliberation
        </button>
      </div>

      {/* Mode segmented control — Council / Arena */}
      <div className="sidebar-mode-section">
        <div className="mode-control" role="group" aria-label="Deliberation mode">
          <button
            type="button"
            className={`mode-btn ${mode === 'council' ? 'active' : ''}`}
            onClick={() => setMode('council')}
            aria-pressed={mode === 'council'}
            disabled={isLoading}
          >
            Council
          </button>
          <button
            type="button"
            className={`mode-btn ${mode === 'arena' ? 'active' : ''}`}
            onClick={() => setMode('arena')}
            aria-pressed={mode === 'arena'}
            disabled={isLoading}
          >
            Arena
          </button>
        </div>
      </div>

      {/* Section label */}
      <div className="sidebar-section-label">Today</div>

      {/* Conversation list */}
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
              onRename={(id, title) => renameConversation.mutate({ id, title })}
              onDelete={(id) => deleteConversation.mutate(id)}
              onExport={handleExportConversation}
            />
          ))
        )}
      </div>

      {/* Council display panel */}
      <CouncilDisplay
        councilModels={councilModels}
        chairmanModel={chairmanModel}
        onOpenConfig={handleOpenConfig}
        onOpenCuration={() => setShowCuration(true)}
      />

      {/* Footer: Standings nav · Models nav · status + theme chip */}
      <div className="sidebar-footer">
        <button
          type="button"
          className={`sidebar-nav-row ${currentView === 'standings' ? 'active' : ''}`}
          onClick={() => setCurrentView('standings')}
          aria-pressed={currentView === 'standings'}
        >
          <BarChart3 size={14} aria-hidden="true" />
          <span>Standings</span>
        </button>
        <button
          type="button"
          className="sidebar-nav-row"
          onClick={handleOpenConfig}
          aria-label="Configure council models"
        >
          <Settings size={14} aria-hidden="true" />
          <span>Models</span>
          <span className="sidebar-model-count">{councilModels.length}</span>
        </button>
        <div className="sidebar-status-row">
          <div className="sidebar-sync">
            <span className="sidebar-sync-dot" aria-hidden="true" />
            <span className="sidebar-sync-text">synced</span>
            <VersionInfo />
          </div>
          <button
            type="button"
            className="sidebar-theme-chip"
            onClick={cycleTheme}
            title={`Theme: ${themeLabel}`}
            aria-label={`Theme: ${themeLabel}`}
          >
            {themeIcon}
            <span>{themeLabel.toLowerCase()}</span>
          </button>
        </div>
      </div>

      {/* Config modal — ModelSelector renders its own cc-modal-* chrome
          (backdrop, header, footer, Escape + backdrop-close). The wrapper div
          only holds the ref so the focus trap above can reach the panel. */}
      {showConfigUI && (
        <div ref={modalRef}>
          <ModelSelector
            selectedCouncil={pendingCouncil}
            selectedChairman={pendingChairman}
            onCouncilChange={setPendingCouncil}
            onChairmanChange={setPendingChairman}
            onSave={handleSaveConfig}
            onCancel={handleCancelConfig}
            filterStateRef={filterStateRef}
          />
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
