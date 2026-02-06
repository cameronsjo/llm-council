/**
 * Custom hook that owns conversation state (via useReducer),
 * an AbortController for cancellation, and the streaming API calls.
 *
 * Side effects (e.g. refreshing the sidebar) are delegated to
 * callbacks passed in via the options object.
 */
import { useCallback, useReducer, useRef } from 'react';
import { api, AuthRedirectError } from '../api';
import { conversationReducer, buildAssistantMessage } from './conversationReducer';

/**
 * @param {Object} options
 * @param {() => void} [options.onComplete]      Called when a stream finishes successfully.
 * @param {() => void} [options.onTitleComplete]  Called when backend generates a title.
 * @param {() => void} [options.onAuthExpired]    Called when an auth redirect is detected.
 */
export function useConversationStream({ onComplete, onTitleComplete, onAuthExpired } = {}) {
  const [conversation, dispatch] = useReducer(conversationReducer, null);
  const abortRef = useRef(null);

  // ── Derived state ──────────────────────────────────────────────────────
  const isLoading = conversation?._isLoading ?? false;
  const isExtendingDebate = conversation?._isExtendingDebate ?? false;

  // ── Low-level setters ──────────────────────────────────────────────────

  const setConversation = useCallback((conv) => {
    dispatch({ type: 'SET_CONVERSATION', payload: conv });
  }, []);

  const updateTitle = useCallback((title) => {
    dispatch({ type: 'UPDATE_TITLE', payload: { title } });
  }, []);

  // ── Cancel ─────────────────────────────────────────────────────────────

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
    dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
  }, []);

  // ── Send message ───────────────────────────────────────────────────────

  const sendMessage = useCallback(async (
    conversationId,
    content,
    attachments,
    { mode, useWebSearch, arenaRoundCount, resume, priorContext }
  ) => {
    // Cancel any in-flight stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    dispatch({ type: 'SET_LOADING', payload: { isLoading: true } });
    dispatch({ type: 'ADD_USER_MESSAGE', payload: { content, attachments } });
    dispatch({ type: 'ADD_ASSISTANT_MESSAGE', payload: { mode } });

    const arenaConfig = mode === 'arena' ? { round_count: arenaRoundCount } : null;

    try {
      await api.sendMessageStream(
        conversationId,
        content,
        useWebSearch,
        mode,
        arenaConfig,
        attachments,
        (eventType, event) => {
          if (controller.signal.aborted) return;
          dispatch({ type: eventType, payload: event });

          if (eventType === 'title_complete') onTitleComplete?.();
          if (eventType === 'complete') {
            dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
            onComplete?.();
          }
          if (eventType === 'error') {
            dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
          }
        },
        resume,
        priorContext,
        controller.signal,
      );
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (error instanceof AuthRedirectError) { onAuthExpired?.(); return; }
      console.error('Failed to send message:', error);
      dispatch({ type: 'ROLLBACK_OPTIMISTIC' });
      dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
    }
  }, [onComplete, onTitleComplete, onAuthExpired]);

  // ── Extend debate ──────────────────────────────────────────────────────

  const extendDebate = useCallback(async (conversationId) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: true } });

    try {
      await api.extendDebateStream(
        conversationId,
        (eventType, event) => {
          if (controller.signal.aborted) return;
          dispatch({ type: eventType, payload: event });

          if (eventType === 'complete') {
            dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
            onComplete?.();
          }
          if (eventType === 'error') {
            dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
          }
        },
        controller.signal,
      );
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (error instanceof AuthRedirectError) { onAuthExpired?.(); return; }
      console.error('Failed to extend debate:', error);
      dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
    }
  }, [onComplete, onAuthExpired]);

  // ── Retry Stage 3 ──────────────────────────────────────────────────────

  const retryStage3 = useCallback(async (conversationId) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    dispatch({ type: 'SET_LOADING', payload: { isLoading: true } });

    try {
      await api.retryStage3Stream(
        conversationId,
        (eventType, event) => {
          if (controller.signal.aborted) return;
          dispatch({ type: eventType, payload: event });

          if (eventType === 'complete') {
            dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
            onComplete?.();
          }
          if (eventType === 'error') {
            dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
          }
        },
        controller.signal,
      );
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (error instanceof AuthRedirectError) { onAuthExpired?.(); return; }
      console.error('Failed to retry Stage 3:', error);
      dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
    }
  }, [onComplete, onAuthExpired]);

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    conversation,
    isLoading,
    isExtendingDebate,
    setConversation,
    sendMessage,
    extendDebate,
    retryStage3,
    cancelStream,
    updateTitle,
    dispatch, // escape hatch for edge cases
  };
}
