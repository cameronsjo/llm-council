import { useState, useEffect } from 'react';
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
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [councilModels, setCouncilModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');
  const [userInfo, setUserInfo] = useState(null);

  // Arena mode state
  const [mode, setMode] = useState('council'); // 'council' or 'arena'
  const [arenaRoundCount, setArenaRoundCount] = useState(3);
  const [arenaConfig, setArenaConfig] = useState({
    default_rounds: 3,
    min_rounds: 2,
    max_rounds: 10,
  });

  // Load conversations, config, and user info on mount
  useEffect(() => {
    loadConversations();
    loadConfig();
    loadUserInfo();
  }, []);

  const loadConfig = async () => {
    try {
      const config = await api.getConfig();
      setWebSearchAvailable(config.web_search_available);
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
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleNewConversation = async () => {
    try {
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

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

  const handleSendMessage = async (content) => {
    if (!currentConversationId) return;

    setIsLoading(true);
    try {
      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
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

      // Send message with streaming
      await api.sendMessageStream(
        currentConversationId,
        content,
        useWebSearch,
        mode,
        arenaConfigParam,
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
        }
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

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        councilModels={councilModels}
        chairmanModel={chairmanModel}
        onConfigChange={handleConfigChange}
        userInfo={userInfo}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        webSearchAvailable={webSearchAvailable}
        useWebSearch={useWebSearch}
        onToggleWebSearch={() => setUseWebSearch(!useWebSearch)}
        mode={mode}
        onModeChange={setMode}
        arenaRoundCount={arenaRoundCount}
        onArenaRoundCountChange={setArenaRoundCount}
        arenaConfig={arenaConfig}
      />
    </div>
  );
}

export default App;
