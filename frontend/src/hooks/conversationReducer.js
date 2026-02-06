/**
 * Pure reducer for conversation state.
 *
 * Every action maps an SSE event (or internal action) to an immutable
 * state update on `currentConversation`. No side-effects live here —
 * callbacks like loadConversations() are handled by the hook layer.
 */

// --- Helpers -----------------------------------------------------------------

/** Clone messages array and the last message for immutable update. */
function cloneLastMessage(state) {
  const messages = [...state.messages];
  const lastMsg = { ...messages[messages.length - 1] };
  messages[messages.length - 1] = lastMsg;
  return { messages, lastMsg };
}

// --- Exported helpers --------------------------------------------------------

/** Build the initial skeleton assistant message for a given mode. */
export function buildAssistantMessage(mode) {
  if (mode === 'arena') {
    return {
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
    };
  }

  return {
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
    streaming: {
      models: [],
      responses: [],
      tokens: {},
      progress: null,
    },
  };
}

// --- Reducer -----------------------------------------------------------------

export function conversationReducer(state, action) {
  // Guard: most actions require existing state
  if (!state && action.type !== 'SET_CONVERSATION') return state;

  switch (action.type) {
    // ── Internal actions ─────────────────────────────────────────────────

    case 'SET_CONVERSATION':
      return action.payload;

    case 'ADD_USER_MESSAGE': {
      const { content, attachments } = action.payload;
      const userMsg = { role: 'user', content };
      if (attachments?.length > 0) userMsg.attachments = attachments;
      return { ...state, messages: [...state.messages, userMsg] };
    }

    case 'ADD_ASSISTANT_MESSAGE': {
      const msg = buildAssistantMessage(action.payload.mode);
      return { ...state, messages: [...state.messages, msg] };
    }

    case 'ROLLBACK_OPTIMISTIC':
      return { ...state, messages: state.messages.slice(0, -2) };

    case 'UPDATE_TITLE':
      return { ...state, title: action.payload.title };

    case 'SET_LOADING':
      return { ...state, _isLoading: action.payload.isLoading };

    case 'SET_EXTENDING':
      return { ...state, _isExtendingDebate: action.payload.isExtendingDebate };

    // ── SSE: Shared events ───────────────────────────────────────────────

    case 'web_search_start': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.loading = { ...lastMsg.loading, webSearch: true };
      return { ...state, messages };
    }

    case 'web_search_complete': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.loading = { ...lastMsg.loading, webSearch: false };
      lastMsg.webSearchUsed = action.payload.data?.found || false;
      lastMsg.webSearchError = action.payload.data?.error || null;
      return { ...state, messages };
    }

    // ── SSE: Council Stage 1 ─────────────────────────────────────────────

    case 'stage1_start': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.loading = { ...lastMsg.loading, stage1: true };
      if (action.payload.data?.models) {
        lastMsg.streaming = {
          models: action.payload.data.models,
          responses: [],
          tokens: {},
          progress: {
            completed: 0,
            total: action.payload.data.models.length,
            completed_models: [],
            pending_models: action.payload.data.models,
          },
        };
      }
      return { ...state, messages };
    }

    case 'stage1_token': {
      const { messages, lastMsg } = cloneLastMessage(state);
      const { model, token } = action.payload.data;
      lastMsg.streaming = {
        ...lastMsg.streaming,
        tokens: {
          ...lastMsg.streaming.tokens,
          [model]: (lastMsg.streaming.tokens[model] || '') + token,
        },
      };
      return { ...state, messages };
    }

    case 'stage1_model_response': {
      const { messages, lastMsg } = cloneLastMessage(state);
      const newTokens = { ...lastMsg.streaming.tokens };
      delete newTokens[action.payload.data.model];
      lastMsg.streaming = {
        ...lastMsg.streaming,
        responses: [...lastMsg.streaming.responses, action.payload.data],
        tokens: newTokens,
      };
      return { ...state, messages };
    }

    case 'stage1_progress': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.streaming = { ...lastMsg.streaming, progress: action.payload.data };
      return { ...state, messages };
    }

    case 'stage1_complete': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.stage1 = action.payload.data;
      lastMsg.loading = { ...lastMsg.loading, stage1: false };
      return { ...state, messages };
    }

    // ── SSE: Council Stage 2 ─────────────────────────────────────────────

    case 'stage2_start': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.loading = { ...lastMsg.loading, stage2: true };
      return { ...state, messages };
    }

    case 'stage2_complete': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.stage2 = action.payload.data;
      lastMsg.metadata = action.payload.metadata;
      lastMsg.loading = { ...lastMsg.loading, stage2: false };
      return { ...state, messages };
    }

    // ── SSE: Council Stage 3 ─────────────────────────────────────────────

    case 'stage3_start': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.loading = { ...lastMsg.loading, stage3: true };
      return { ...state, messages };
    }

    case 'stage3_complete': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.stage3 = action.payload.data;
      lastMsg.loading = { ...lastMsg.loading, stage3: false };
      return { ...state, messages };
    }

    // ── SSE: Arena events ────────────────────────────────────────────────

    case 'arena_start': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.arenaInfo = action.payload.data;
      return { ...state, messages };
    }

    case 'round_start': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.loading = {
        ...lastMsg.loading,
        round: true,
        roundNumber: action.payload.data.round_number,
        roundType: action.payload.data.round_type,
      };
      return { ...state, messages };
    }

    case 'round_complete': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.rounds = [...(lastMsg.rounds || []), action.payload.data];
      lastMsg.loading = {
        ...lastMsg.loading,
        round: false,
        roundNumber: null,
        roundType: null,
      };
      return { ...state, messages };
    }

    case 'synthesis_start': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.loading = { ...lastMsg.loading, synthesis: true };
      return { ...state, messages };
    }

    case 'synthesis_complete': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.synthesis = action.payload.data;
      lastMsg.participant_mapping = action.payload.participant_mapping;
      lastMsg.loading = { ...lastMsg.loading, synthesis: false };
      return { ...state, messages };
    }

    // ── SSE: Extend debate ───────────────────────────────────────────────

    case 'extend_start': {
      const { messages, lastMsg } = cloneLastMessage(state);
      if (lastMsg.mode === 'arena') {
        lastMsg.loading = {
          ...lastMsg.loading,
          round: true,
          roundNumber: action.payload.data.new_round_number,
          roundType: 'deliberation',
        };
      }
      return { ...state, messages };
    }

    // ── SSE: Shared completion ───────────────────────────────────────────

    case 'metrics_complete': {
      const { messages, lastMsg } = cloneLastMessage(state);
      lastMsg.metrics = action.payload.data;
      return { ...state, messages };
    }

    // Side-effect-only events — state unchanged, hook handles callbacks
    case 'resume_start':
    case 'prior_context':
    case 'title_complete':
    case 'complete':
    case 'error':
      return state;

    default:
      console.log('Unknown event:', action.type);
      return state;
  }
}
