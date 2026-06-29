import { useEffect, useCallback } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import Standings from './components/Standings';
import { api, AuthRedirectError } from './api';
import { useConversationStream } from './hooks/useConversationStream';
import { useUIStore } from './stores/uiStore';
import {
  useConfig,
  useUserInfo,
  useConversations,
  useConversation,
  usePendingStatus,
  useCreateConversation,
  useClearPending,
} from './hooks/queries';
import './App.css';

function App() {
  // ── Zustand store ─────────────────────────────────────────────────────
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const authExpired = useUIStore((s) => s.authExpired);
  const setAuthExpired = useUIStore((s) => s.setAuthExpired);
  const currentConversationId = useUIStore((s) => s.currentConversationId);
  const setCurrentConversationId = useUIStore((s) => s.setCurrentConversationId);
  const currentView = useUIStore((s) => s.currentView);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const mode = useUIStore((s) => s.mode);
  const setMode = useUIStore((s) => s.setMode);
  const arenaRoundCount = useUIStore((s) => s.arenaRoundCount);
  const useWebSearch = useUIStore((s) => s.useWebSearch);
  const pendingForkContext = useUIStore((s) => s.pendingForkContext);
  const setPendingForkContext = useUIStore((s) => s.setPendingForkContext);

  // ── TanStack Query ────────────────────────────────────────────────────
  const configQuery = useConfig();
  const conversationsQuery = useConversations();
  const conversationQuery = useConversation(currentConversationId);
  const pendingStatusQuery = usePendingStatus(currentConversationId, {
    enabled: !!currentConversationId,
  });

  // Derive config values
  const councilModels = configQuery.data?.council_models ?? [];
  const chairmanModel = configQuery.data?.chairman_model ?? '';

  // ── Mutations ─────────────────────────────────────────────────────────
  const createConversation = useCreateConversation();
  const clearPending = useClearPending();

  // ── Streaming ─────────────────────────────────────────────────────────
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
    onAuthExpired: () => setAuthExpired(true),
    onServerShutdown: (msg) => {
      console.warn('[app] Server shutdown during stream: %s', msg);
      if (currentConversationId) {
        conversationQuery.refetch();
      }
    },
  });

  // ── Sync fetched conversation into stream reducer ─────────────────────
  // When the TanStack query loads/reloads a conversation, push it into
  // the useReducer so the stream hook has the latest server state.
  useEffect(() => {
    if (!conversationQuery.data || !currentConversationId) return;

    const conv = conversationQuery.data;
    const pending = pendingStatusQuery.data;

    // No pending data or query still loading -- use conversation as-is
    if (!pending || pendingStatusQuery.isLoading) {
      setCurrentConversation(conv);
      return;
    }

    if (pending.pending) {
      if (pending.stale || pending.has_error) {
        // Interrupted: inject partial data into conversation
        const partialData = pending.partial_data || {};
        const hasPartialResults =
          partialData.responses?.length > 0 ||
          partialData.stage1?.length > 0 ||
          partialData.rounds?.length > 0;

        let messagesWithPartial = conv.messages;
        if (hasPartialResults) {
          const partialMessage = {
            role: 'assistant',
            partial: true,
            mode: pending.mode,
            rounds:
              partialData.rounds ||
              (partialData.responses
                ? [
                    {
                      round_type: 'responses',
                      responses: partialData.responses,
                    },
                  ]
                : null),
            synthesis: partialData.synthesis || null,
            participant_mapping: partialData.participant_mapping || null,
          };
          messagesWithPartial = [...conv.messages, partialMessage];
        }

        setCurrentConversation({
          ...conv,
          messages: messagesWithPartial,
          pendingInterrupted: true,
          pendingInfo: pending,
        });
      } else {
        // Still in progress -- TanStack polling handles the refresh cycle
        setCurrentConversation({ ...conv, _isLoading: true });
      }
    } else {
      setCurrentConversation(conv);
    }
  }, [
    conversationQuery.data,
    pendingStatusQuery.data,
    pendingStatusQuery.isLoading,
    currentConversationId,
    setCurrentConversation,
  ]);

  // Cancel stream when switching conversations
  useEffect(() => {
    cancelStream();
  }, [currentConversationId, cancelStream]);

  // Initialize arena round count from config when it loads
  useEffect(() => {
    if (configQuery.data?.arena) {
      useUIStore.getState().setArenaRoundCount(configQuery.data.arena.default_rounds);
    }
  }, [configQuery.data?.arena]);

  // Handle window resize for responsive sidebar
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setSidebarOpen]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleNewConversation = useCallback(async () => {
    try {
      const newConv = await createConversation.mutateAsync({ councilModels, chairmanModel });
      setCurrentConversationId(newConv.id);
      setCurrentView('chat');
    } catch (error) {
      if (error instanceof AuthRedirectError) {
        setAuthExpired(true);
        return;
      }
      console.error('Failed to create conversation:', error);
    }
  }, [
    createConversation,
    councilModels,
    chairmanModel,
    setCurrentConversationId,
    setCurrentView,
    setAuthExpired,
  ]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === 'n') {
        e.preventDefault();
        handleNewConversation();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNewConversation]);

  const handleSelectConversationMobile = useCallback(
    (id) => {
      setCurrentConversationId(id);
      setCurrentView('chat');
      if (window.innerWidth <= 768) {
        setSidebarOpen(false);
      }
    },
    [setCurrentConversationId, setCurrentView, setSidebarOpen]
  );

  const handleSendMessage = useCallback(
    async (content, attachments = [], resume = false) => {
      if (!currentConversationId) return;
      const priorContext = useUIStore.getState().pendingForkContext;
      if (priorContext) setPendingForkContext(null);
      await sendMessage(currentConversationId, content, attachments, {
        mode,
        useWebSearch,
        arenaRoundCount,
        resume,
        priorContext,
      });
    },
    [currentConversationId, sendMessage, mode, useWebSearch, arenaRoundCount, setPendingForkContext]
  );

  const handleRetry = useCallback(
    async (content) => {
      if (!currentConversationId || !currentConversation) return;
      const conv = await api.getConversation(currentConversationId);
      setCurrentConversation(conv);
      await handleSendMessage(content);
    },
    [currentConversationId, currentConversation, setCurrentConversation, handleSendMessage]
  );

  const handleRetryInterrupted = useCallback(
    async (shouldResume = false) => {
      if (!currentConversationId || !currentConversation?.pendingInfo) return;

      const userContent = currentConversation.pendingInfo.user_content;
      const pendingMode = currentConversation.pendingInfo.mode || 'council';
      const hasStage1 =
        currentConversation.pendingInfo.partial_data?.responses?.length > 0 ||
        currentConversation.pendingInfo.partial_data?.stage1?.length > 0;

      if (shouldResume && hasStage1) {
        setMode(pendingMode);
        await handleSendMessage(userContent, [], true);
      } else {
        try {
          await clearPending.mutateAsync(currentConversationId);
          const conv = await api.getConversation(currentConversationId);
          setCurrentConversation(conv);
        } catch (error) {
          if (error instanceof AuthRedirectError) {
            setAuthExpired(true);
            return;
          }
          console.warn(
            'Failed to clear pending on server, retrying with local state:',
            error.message
          );
          const cleanMessages = (currentConversation.messages || []).filter((m) => !m.partial);
          setCurrentConversation({
            ...currentConversation,
            pendingInterrupted: false,
            pendingInfo: null,
            messages: cleanMessages,
          });
        }

        setMode(pendingMode);
        await handleSendMessage(userContent);
      }
    },
    [
      currentConversationId,
      currentConversation,
      clearPending,
      setCurrentConversation,
      setMode,
      setAuthExpired,
      handleSendMessage,
    ]
  );

  const handleDismissInterrupted = useCallback(async () => {
    if (!currentConversationId) return;

    // Clear UI immediately
    const cleanMessages = (currentConversation?.messages || []).filter((m) => !m.partial);
    setCurrentConversation({
      ...currentConversation,
      pendingInterrupted: false,
      pendingInfo: null,
      messages: cleanMessages,
    });

    // Fire-and-forget server cleanup
    try {
      await clearPending.mutateAsync(currentConversationId);
    } catch (error) {
      if (error instanceof AuthRedirectError) {
        setAuthExpired(true);
        return;
      }
      console.warn(
        'Failed to clear pending on server (will be cleaned up on next load):',
        error.message
      );
    }
  }, [
    currentConversationId,
    currentConversation,
    clearPending,
    setCurrentConversation,
    setAuthExpired,
  ]);

  const handleForkConversation = useCallback(
    async (originalQuestion, synthesis, sourceConversationId) => {
      try {
        const newConv = await createConversation.mutateAsync({ councilModels, chairmanModel });
        setCurrentConversationId(newConv.id);
        setPendingForkContext({
          original_question: originalQuestion,
          synthesis: synthesis,
          source_conversation_id: sourceConversationId,
        });
      } catch (error) {
        if (error instanceof AuthRedirectError) {
          setAuthExpired(true);
          return;
        }
        console.error('Failed to fork conversation:', error);
      }
    },
    [
      createConversation,
      councilModels,
      chairmanModel,
      setCurrentConversationId,
      setPendingForkContext,
      setAuthExpired,
    ]
  );

  const handleExtendDebate = useCallback(async () => {
    if (!currentConversationId || isExtendingDebate) return;
    await extendDebate(currentConversationId);
  }, [currentConversationId, isExtendingDebate, extendDebate]);

  const handleRetrySynthesis = useCallback(async () => {
    if (!currentConversationId || isLoading) return;
    await retrySynthesis(currentConversationId);
  }, [currentConversationId, isLoading, retrySynthesis]);

  const handleRetryRankings = useCallback(async () => {
    if (!currentConversationId || isLoading) return;
    await retryRankings(currentConversationId);
  }, [currentConversationId, isLoading, retryRankings]);

  const handleRetryAll = useCallback(async () => {
    if (!currentConversationId || isLoading) return;
    await retryAll(currentConversationId);
  }, [currentConversationId, isLoading, retryAll]);

  const handleExportConversation = useCallback(
    async (id, format) => {
      try {
        const blob =
          format === 'markdown' ? await api.exportMarkdown(id) : await api.exportJson(id);

        const conversations = conversationsQuery.data ?? [];
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
        if (error instanceof AuthRedirectError) {
          setAuthExpired(true);
          return;
        }
        console.error('Failed to export conversation:', error);
      }
    },
    [conversationsQuery.data, setAuthExpired]
  );

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      {/* Auth expired banner */}
      {authExpired && (
        <div className="auth-expired-banner" role="alert">
          <span>Session expired — re-authenticate to continue.</span>
          <button onClick={() => window.location.reload()}>Re-authenticate</button>
        </div>
      )}

      {/* Mobile menu toggle */}
      <button
        className="mobile-menu-toggle"
        onClick={toggleSidebar}
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
        onSelectConversation={handleSelectConversationMobile}
        onNewConversation={handleNewConversation}
      />
      {currentView === 'standings' ? (
        <Standings />
      ) : (
        <ChatInterface
          conversation={currentConversation}
          isLoading={isLoading}
          isExtendingDebate={isExtendingDebate}
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
        />
      )}
    </div>
  );
}

export default App;
