import { useState, useEffect, useCallback, useRef } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import { api } from './api';
import './App.css';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [webSearchAvailable, setWebSearchAvailable] = useState(false);
  const [searchProvider, setSearchProvider] = useState('');
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [councilModels, setCouncilModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');
  const [userInfo, setUserInfo] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);

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

  // Extend debate state
  const [isExtendingDebate, setIsExtendingDebate] = useState(false);

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
      console.error('Failed to load config:', error);
    }
  };

  const loadUserInfo = async () => {
    try {
      const info = await api.getUserInfo();
      setUserInfo(info);
    } catch (error) {
      console.error('Failed to load user info:', error);
    }
  };

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);

      // Check for pending/interrupted responses
      const pendingStatus = await api.getPendingStatus(id);

      if (pendingStatus.pending) {
        if (pendingStatus.stale || pendingStatus.has_error) {
          // Show interrupted state with partial data
          const partialData = pendingStatus.partial_data || {};
          const hasPartialResults = partialData.stage1?.length > 0 || partialData.rounds?.length > 0;

          // If we have partial results, inject a synthetic assistant message to display them
          let messagesWithPartial = conv.messages;
          if (hasPartialResults) {
            const partialMessage = {
              role: 'assistant',
              partial: true, // Mark as partial for UI styling
              mode: pendingStatus.mode,
              // Council mode partial data
              stage1: partialData.stage1 || null,
              stage2: partialData.stage2 || null,
              stage3: partialData.stage3 || null,
              // Arena mode partial data
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
          setIsLoading(true);
          setCurrentConversation(conv);
        }
      } else {
        setCurrentConversation(conv);
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
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
      console.error('Failed to create conversation:', error);
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
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleRenameConversation = async (id, newTitle) => {
    try {
      await api.renameConversation(id, newTitle);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c))
      );
      if (currentConversation?.id === id) {
        setCurrentConversation((prev) => ({ ...prev, title: newTitle }));
      }
    } catch (error) {
      console.error('Failed to rename conversation:', error);
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
      console.error('Failed to export conversation:', error);
    }
  };

  const handleRetry = async (content) => {
    if (!currentConversationId || !currentConversation) return;

    // Remove the last two messages (user + assistant) from UI
    setCurrentConversation((prev) => ({
      ...prev,
      messages: prev.messages.slice(0, -2),
    }));

    // Re-send the message
    await handleSendMessage(content);
  };

  const handleRetryInterrupted = async (shouldResume = false) => {
    if (!currentConversationId || !currentConversation?.pendingInfo) return;

    const userContent = currentConversation.pendingInfo.user_content;
    const pendingMode = currentConversation.pendingInfo.mode || 'council';
    const hasStage1 = currentConversation.pendingInfo.partial_data?.stage1?.length > 0;

    // If resuming with Stage 1 data, don't clear pending - the backend will use it
    if (shouldResume && hasStage1) {
      setMode(pendingMode);
      await handleSendMessage(userContent, [], true); // resume=true
    } else {
      // Full retry: Clear pending state and orphaned message on backend
      await api.clearPending(currentConversationId);

      // Reload conversation to get clean state
      const conv = await api.getConversation(currentConversationId);
      setCurrentConversation(conv);

      // Set mode to match the interrupted request
      setMode(pendingMode);

      // Re-send the message
      await handleSendMessage(userContent);
    }
  };

  const handleDismissInterrupted = async () => {
    if (!currentConversationId) return;

    // Clear pending state and orphaned message on backend
    await api.clearPending(currentConversationId);

    // Reload conversation
    const conv = await api.getConversation(currentConversationId);
    setCurrentConversation(conv);
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
      console.error('Failed to fork conversation:', error);
    }
  };

  const handleExtendDebate = async () => {
    if (!currentConversationId || isExtendingDebate) return;

    setIsExtendingDebate(true);
    try {
      await api.extendDebateStream(currentConversationId, (eventType, event) => {
        switch (eventType) {
          case 'extend_start':
            // Starting to extend
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg.mode === 'arena') {
                lastMsg.loading = {
                  ...lastMsg.loading,
                  round: true,
                  roundNumber: event.data.new_round_number,
                  roundType: 'deliberation',
                };
              }
              return { ...prev, messages };
            });
            break;

          case 'round_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg.mode === 'arena') {
                lastMsg.loading = {
                  ...lastMsg.loading,
                  round: true,
                  roundNumber: event.data.round_number,
                  roundType: event.data.round_type,
                };
              }
              return { ...prev, messages };
            });
            break;

          case 'round_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg.mode === 'arena') {
                lastMsg.rounds = [...(lastMsg.rounds || []), event.data];
                lastMsg.loading = {
                  ...lastMsg.loading,
                  round: false,
                  roundNumber: null,
                  roundType: null,
                };
              }
              return { ...prev, messages };
            });
            break;

          case 'synthesis_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg.mode === 'arena') {
                lastMsg.loading = {
                  ...lastMsg.loading,
                  synthesis: true,
                };
              }
              return { ...prev, messages };
            });
            break;

          case 'synthesis_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg.mode === 'arena') {
                lastMsg.synthesis = event.data;
                lastMsg.participant_mapping = event.participant_mapping;
                lastMsg.loading = {
                  ...lastMsg.loading,
                  synthesis: false,
                };
              }
              return { ...prev, messages };
            });
            break;

          case 'metrics_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (lastMsg.mode === 'arena') {
                lastMsg.metrics = event.data;
              }
              return { ...prev, messages };
            });
            break;

          case 'complete':
            setIsExtendingDebate(false);
            break;

          case 'error':
            console.error('Extend debate error:', event.message);
            setIsExtendingDebate(false);
            break;
        }
      });
    } catch (error) {
      console.error('Failed to extend debate:', error);
      setIsExtendingDebate(false);
    }
  };

  const handleSendMessage = async (content, attachments = [], resume = false) => {
    if (!currentConversationId) return;

    setIsLoading(true);
    try {
      // Optimistically add user message to UI
      const userMessage = { role: 'user', content, attachments };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      // Create a partial assistant message based on mode
      const assistantMessage =
        mode === 'arena'
          ? {
              role: 'assistant',
              mode: 'arena',
              rounds: [],
              synthesis: null,
              participant_mapping: null,
              webSearchUsed: false,
              loading: {
                webSearch: false,
                round: false,
                roundNumber: null,
                roundType: null,
                synthesis: false,
              },
            }
          : {
              role: 'assistant',
              stage1: null,
              stage2: null,
              stage3: null,
              metadata: null,
              webSearchUsed: false,
              loading: {
                webSearch: false,
                stage1: false,
                stage2: false,
                stage3: false,
              },
            };

      // Add the partial assistant message
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      // Prepare arena config if in arena mode
      const arenaConfigParam =
        mode === 'arena' ? { round_count: arenaRoundCount } : null;

      // Check for fork context (used for first message in forked conversation)
      const priorContext = pendingForkContext;
      if (pendingForkContext) {
        setPendingForkContext(null); // Clear after use
      }

      // Send message with streaming
      await api.sendMessageStream(
        currentConversationId,
        content,
        useWebSearch,
        mode,
        arenaConfigParam,
        attachments,
        (eventType, event) => {
          switch (eventType) {
            // Shared events
            case 'web_search_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.webSearch = true;
                return { ...prev, messages };
              });
              break;

            case 'web_search_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.webSearch = false;
                lastMsg.webSearchUsed = event.data?.found || false;
                lastMsg.webSearchError = event.data?.error || null;
                return { ...prev, messages };
              });
              break;

            // Council mode events
            case 'stage1_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.stage1 = true;
                return { ...prev, messages };
              });
              break;

            case 'stage1_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.stage1 = event.data;
                lastMsg.loading.stage1 = false;
                return { ...prev, messages };
              });
              break;

            case 'stage2_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.stage2 = true;
                return { ...prev, messages };
              });
              break;

            case 'stage2_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.stage2 = event.data;
                lastMsg.metadata = event.metadata;
                lastMsg.loading.stage2 = false;
                return { ...prev, messages };
              });
              break;

            case 'stage3_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.stage3 = true;
                return { ...prev, messages };
              });
              break;

            case 'stage3_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.stage3 = event.data;
                lastMsg.loading.stage3 = false;
                return { ...prev, messages };
              });
              break;

            // Arena mode events
            case 'arena_start':
              // Arena started - info about participants and round count
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.arenaInfo = event.data;
                return { ...prev, messages };
              });
              break;

            case 'round_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.round = true;
                lastMsg.loading.roundNumber = event.data.round_number;
                lastMsg.loading.roundType = event.data.round_type;
                return { ...prev, messages };
              });
              break;

            case 'round_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.rounds = [...(lastMsg.rounds || []), event.data];
                lastMsg.loading.round = false;
                lastMsg.loading.roundNumber = null;
                lastMsg.loading.roundType = null;
                return { ...prev, messages };
              });
              break;

            case 'synthesis_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.synthesis = true;
                return { ...prev, messages };
              });
              break;

            case 'synthesis_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.synthesis = event.data;
                lastMsg.participant_mapping = event.participant_mapping;
                lastMsg.loading.synthesis = false;
                return { ...prev, messages };
              });
              break;

            // Shared completion events
            case 'metrics_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.metrics = event.data;
                return { ...prev, messages };
              });
              break;

            case 'title_complete':
              // Reload conversations to get updated title
              loadConversations();
              break;

            case 'complete':
              // Stream complete, reload conversations list
              loadConversations();
              setIsLoading(false);
              break;

            case 'error':
              console.error('Stream error:', event.message);
              setIsLoading(false);
              break;

            default:
              console.log('Unknown event type:', eventType);
          }
        },
        resume,
        priorContext
      );
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setIsLoading(false);
    }
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
