import { useState, useEffect } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import { api, AuthRedirectError } from './api';
import { useConversationStream } from './hooks/useConversationStream';
import './App.css';

/**
 * Check if an error is an auth redirect and set the expired flag.
 * Returns true if it was an auth error (caller should stop processing).
 */
function isAuthError(error, setAuthExpired) {
  if (error instanceof AuthRedirectError) {
    setAuthExpired(true);
    return true;
  }
  return false;
}

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [webSearchAvailable, setWebSearchAvailable] = useState(false);
  const [searchProvider, setSearchProvider] = useState('');
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [councilModels, setCouncilModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');
  const [userInfo, setUserInfo] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);
  const [authExpired, setAuthExpired] = useState(false);

  // Arena mode state
  const [mode, setMode] = useState('council'); // 'council' or 'arena'
  const [arenaRoundCount, setArenaRoundCount] = useState(3);
  const [arenaConfig, setArenaConfig] = useState({
    default_rounds: 3,
    min_rounds: 2,
    max_rounds: 10,
  });

  // Fork conversation state - context to include when starting a new conversation
  const [pendingForkContext, setPendingForkContext] = useState(null);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      if (!isAuthError(error, setAuthExpired)) {
        console.error('Failed to load conversations:', error);
      }
    }
  };

  // Conversation state + streaming via reducer hook
  const {
    conversation: currentConversation,
    isLoading,
    isExtendingDebate,
    setConversation: setCurrentConversation,
    sendMessage,
    extendDebate,
    retryAll,
    retryRankings,
    retrySynthesis,
    cancelStream,
    updateTitle,
  } = useConversationStream({
    onComplete: loadConversations,
    onTitleComplete: loadConversations,
    onAuthExpired: () => setAuthExpired(true),
    onServerShutdown: (msg) => {
      console.warn('[app] Server shutdown during stream: %s', msg);
      // Reload conversation to pick up any partial data that was saved
      if (currentConversationId) {
        loadConversation(currentConversationId);
      }
    },
  });

  // Load conversations, config, and user info on mount
  useEffect(() => {
    loadConversations();
    loadConfig();
    loadUserInfo();
  }, []);

  // Handle window resize for responsive sidebar
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loadConfig = async () => {
    try {
      const config = await api.getConfig();
      setWebSearchAvailable(config.web_search_available);
      setSearchProvider(config.search_provider || '');
      setCouncilModels(config.council_models || []);
      setChairmanModel(config.chairman_model || '');
      if (config.arena) {
        setArenaConfig(config.arena);
        setArenaRoundCount(config.arena.default_rounds);
      }
    } catch (error) {
      if (!isAuthError(error, setAuthExpired)) {
        console.error('Failed to load config:', error);
      }
    }
  };

  const loadUserInfo = async () => {
    try {
      const info = await api.getUserInfo();
      setUserInfo(info);
    } catch (error) {
      if (!isAuthError(error, setAuthExpired)) {
        console.error('Failed to load user info:', error);
      }
    }
  };

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);

      // Check for pending/interrupted responses
      const pendingStatus = await api.getPendingStatus(id);

      if (pendingStatus.pending) {
        if (pendingStatus.stale || pendingStatus.has_error) {
          // Show interrupted state with partial data
          const partialData = pendingStatus.partial_data || {};
          const hasPartialResults =
            partialData.responses?.length > 0 ||
            partialData.stage1?.length > 0 ||
            partialData.rounds?.length > 0;

          // If we have partial results, inject a synthetic assistant message to display them
          let messagesWithPartial = conv.messages;
          if (hasPartialResults) {
            const partialMessage = {
              role: 'assistant',
              partial: true, // Mark as partial for UI styling
              mode: pendingStatus.mode,
              rounds: partialData.rounds || null,
              synthesis: partialData.synthesis || null,
              participant_mapping: partialData.participant_mapping || null,
            };
            messagesWithPartial = [...conv.messages, partialMessage];
          }

          setCurrentConversation({
            ...conv,
            messages: messagesWithPartial,
            pendingInterrupted: true,
            pendingInfo: pendingStatus,
          });
        } else {
          // Still in progress - show loading
          setCurrentConversation({ ...conv, _isLoading: true });
        }
      } else {
        setCurrentConversation(conv);
      }
    } catch (error) {
      if (!isAuthError(error, setAuthExpired)) {
        console.error('Failed to load conversation:', error);
      }
    }
  };

  const handleNewConversation = async () => {
    try {
      // Pass current council config to new conversation
      const newConv = await api.createConversation(councilModels, chairmanModel);
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, title: newConv.title, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      if (!isAuthError(error, setAuthExpired)) {
        console.error('Failed to create conversation:', error);
      }
    }
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+N - New conversation
      if (isMod && e.key === 'n') {
        e.preventDefault();
        handleNewConversation();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [councilModels, chairmanModel, conversations]);

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  const handleConfigChange = async (newCouncilModels, newChairmanModel) => {
    try {
      await api.updateConfig(newCouncilModels, newChairmanModel);
      setCouncilModels(newCouncilModels);
      setChairmanModel(newChairmanModel);
    } catch (error) {
      if (isAuthError(error, setAuthExpired)) return;
      console.error('Failed to update config:', error);
      throw error;
    }
  };

  const handleDeleteConversation = async (id) => {
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
      }
    } catch (error) {
      if (!isAuthError(error, setAuthExpired)) {
        console.error('Failed to delete conversation:', error);
      }
    }
  };

  const handleRenameConversation = async (id, newTitle) => {
    try {
      await api.renameConversation(id, newTitle);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c))
      );
      if (currentConversation?.id === id) {
        updateTitle(newTitle);
      }
    } catch (error) {
      if (!isAuthError(error, setAuthExpired)) {
        console.error('Failed to rename conversation:', error);
      }
    }
  };

  const handleExportConversation = async (id, format) => {
    try {
      const blob = format === 'markdown'
        ? await api.exportMarkdown(id)
        : await api.exportJson(id);

      // Find conversation title for filename
      const conv = conversations.find((c) => c.id === id);
      const title = (conv?.title || 'conversation').replace(/[^a-zA-Z0-9]/g, '_');
      const extension = format === 'markdown' ? 'md' : 'json';
      const filename = `${title}.${extension}`;

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      if (!isAuthError(error, setAuthExpired)) {
        console.error('Failed to export conversation:', error);
      }
    }
  };

  const handleRetry = async (content) => {
    if (!currentConversationId || !currentConversation) return;

    // Remove the last two messages (user + assistant) from UI
    // Reload clean state from backend then re-send
    const conv = await api.getConversation(currentConversationId);
    setCurrentConversation(conv);

    // Re-send the message
    await handleSendMessage(content);
  };

  const handleRetryInterrupted = async (shouldResume = false) => {
    if (!currentConversationId || !currentConversation?.pendingInfo) return;

    const userContent = currentConversation.pendingInfo.user_content;
    const pendingMode = currentConversation.pendingInfo.mode || 'council';
    const hasStage1 =
      (currentConversation.pendingInfo.partial_data?.responses?.length > 0) ||
      (currentConversation.pendingInfo.partial_data?.stage1?.length > 0);

    // If resuming with Stage 1 data, don't clear pending - the backend will use it
    if (shouldResume && hasStage1) {
      setMode(pendingMode);
      await handleSendMessage(userContent, [], true); // resume=true
    } else {
      // Full retry: clear pending on backend, fall back to local-only if unreachable
      try {
        await api.clearPending(currentConversationId);
        const conv = await api.getConversation(currentConversationId);
        setCurrentConversation(conv);
      } catch (error) {
        if (isAuthError(error, setAuthExpired)) return;
        console.warn('Failed to clear pending on server, retrying with local state:', error.message);
        // Strip the interrupted banner and partial message locally
        const cleanMessages = (currentConversation.messages || []).filter((m) => !m.partial);
        setCurrentConversation({ ...currentConversation, pendingInterrupted: false, pendingInfo: null, messages: cleanMessages });
      }

      setMode(pendingMode);
      await handleSendMessage(userContent);
    }
  };

  const handleDismissInterrupted = async () => {
    if (!currentConversationId) return;

    // Clear UI immediately — user shouldn't be trapped if server is down
    const cleanMessages = (currentConversation?.messages || []).filter((m) => !m.partial);
    setCurrentConversation({ ...currentConversation, pendingInterrupted: false, pendingInfo: null, messages: cleanMessages });

    // Fire-and-forget server cleanup
    try {
      await api.clearPending(currentConversationId);
    } catch (error) {
      if (isAuthError(error, setAuthExpired)) return;
      console.warn('Failed to clear pending on server (will be cleaned up on next load):', error.message);
    }
  };

  const handleForkConversation = async (originalQuestion, synthesis, sourceConversationId) => {
    // Create a new conversation with the fork context
    try {
      const newConv = await api.createConversation(councilModels, chairmanModel);
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, title: 'Follow-up Discussion', message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);

      // Store the fork context to be used with the first message
      setPendingForkContext({
        original_question: originalQuestion,
        synthesis: synthesis,
        source_conversation_id: sourceConversationId,
      });
    } catch (error) {
      if (!isAuthError(error, setAuthExpired)) {
        console.error('Failed to fork conversation:', error);
      }
    }
  };

  const handleExtendDebate = async () => {
    if (!currentConversationId || isExtendingDebate) return;
    await extendDebate(currentConversationId);
  };

  const handleRetrySynthesis = async () => {
    if (!currentConversationId || isLoading) return;
    await retrySynthesis(currentConversationId);
  };

  const handleRetryRankings = async () => {
    if (!currentConversationId || isLoading) return;
    await retryRankings(currentConversationId);
  };

  const handleRetryAll = async () => {
    if (!currentConversationId || isLoading) return;
    await retryAll(currentConversationId);
  };

  const handleSendMessage = async (content, attachments = [], resume = false) => {
    if (!currentConversationId) return;
    const priorContext = pendingForkContext;
    if (pendingForkContext) setPendingForkContext(null);
    await sendMessage(currentConversationId, content, attachments, {
      mode, useWebSearch, arenaRoundCount, resume, priorContext,
    });
  };

  // Close sidebar on mobile when selecting a conversation
  const handleSelectConversationMobile = (id) => {
    handleSelectConversation(id);
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  };

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      {/* Auth expired banner */}
      {authExpired && (
        <div className="auth-expired-banner" role="alert">
          <span>Session expired — please re-authenticate to continue.</span>
          <button onClick={() => window.location.reload()}>
            Re-authenticate
          </button>
        </div>
      )}

      {/* Mobile menu toggle */}
      <button
        className="mobile-menu-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={sidebarOpen}
      >
        <Menu size={24} />
      </button>

      {/* Backdrop for mobile */}
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversationMobile}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        onExportConversation={handleExportConversation}
        councilModels={councilModels}
        chairmanModel={chairmanModel}
        onConfigChange={handleConfigChange}
        userInfo={userInfo}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        onRetry={handleRetry}
        onRetryInterrupted={handleRetryInterrupted}
        onDismissInterrupted={handleDismissInterrupted}
        onForkConversation={handleForkConversation}
        onExtendDebate={handleExtendDebate}
        onRetrySynthesis={handleRetrySynthesis}
        onRetryRankings={handleRetryRankings}
        onRetryAll={handleRetryAll}
        onCancel={cancelStream}
        isLoading={isLoading}
        isExtendingDebate={isExtendingDebate}
        webSearchAvailable={webSearchAvailable}
        searchProvider={searchProvider}
        useWebSearch={useWebSearch}
        onToggleWebSearch={() => setUseWebSearch(!useWebSearch)}
        mode={mode}
        onModeChange={setMode}
        arenaRoundCount={arenaRoundCount}
        onArenaRoundCountChange={setArenaRoundCount}
        arenaConfig={arenaConfig}
        hasPendingForkContext={!!pendingForkContext}
      />
    </div>
  );
}

export default App;
