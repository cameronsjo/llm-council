/**
 * Custom hook that owns conversation state (via useReducer),
 * an AbortController for cancellation, and the streaming API calls.
 *
 * Side effects (e.g. refreshing the sidebar) are delegated to
 * callbacks passed in via the options object.
 */
import { useCallback, useReducer, useRef } from 'react';
import * as Sentry from '@sentry/browser';
import { api, AuthRedirectError } from '../api';
import { conversationReducer, buildAssistantMessage } from './conversationReducer';

/**
 * @param {Object} options
 * @param {() => void} [options.onComplete]        Called when a stream finishes successfully.
 * @param {() => void} [options.onTitleComplete]    Called when backend generates a title.
 * @param {() => void} [options.onAuthExpired]      Called when an auth redirect is detected.
 * @param {(msg: string) => void} [options.onServerShutdown]  Called when server is restarting mid-stream.
 */
export function useConversationStream({ onComplete, onTitleComplete, onAuthExpired, onServerShutdown } = {}) {
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
    console.info('[stream] Cancel requested');
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

    console.info('[stream] sendMessage. ConversationId: %s, Mode: %s, Resume: %s', conversationId, mode, resume);
    dispatch({ type: 'SET_LOADING', payload: { isLoading: true } });
    dispatch({ type: 'ADD_USER_MESSAGE', payload: { content, attachments } });
    dispatch({ type: 'ADD_ASSISTANT_MESSAGE', payload: { mode } });

    const arenaConfig = mode === 'arena' ? { round_count: arenaRoundCount } : null;

    await Sentry.startSpan(
      { name: 'council.sendMessage', op: 'ui.action', attributes: { 'council.mode': mode, 'council.resume': resume } },
      async () => {
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
              Sentry.addBreadcrumb({ category: 'sse', message: eventType, level: 'info' });
              dispatch({ type: eventType, payload: event });

              if (eventType === 'title_complete') onTitleComplete?.();
              if (eventType === 'complete') {
                console.info('[stream] sendMessage complete. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
                onComplete?.();
              }
              if (eventType === 'error') {
                console.error('[stream] sendMessage server error. ConversationId: %s, Event: %o', conversationId, event);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
              }
              if (eventType === 'server_shutdown') {
                console.warn('[stream] Server shutting down mid-stream. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
                onServerShutdown?.(event.message || 'Server is restarting');
              }
            },
            resume,
            priorContext,
            controller.signal,
          );
        } catch (error) {
          if (error.name === 'AbortError') return;
          if (error instanceof AuthRedirectError) { onAuthExpired?.(); return; }
          Sentry.captureException(error, { tags: { operation: 'sendMessage', conversationId } });
          console.error('[stream] sendMessage failed. ConversationId: %s, Error: %s', conversationId, error.message, error);
          dispatch({ type: 'ROLLBACK_OPTIMISTIC' });
          dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
        }
      },
    );
  }, [onComplete, onTitleComplete, onAuthExpired, onServerShutdown]);

  // ── Extend debate ──────────────────────────────────────────────────────

  const extendDebate = useCallback(async (conversationId) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    console.info('[stream] extendDebate. ConversationId: %s', conversationId);
    dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: true } });

    await Sentry.startSpan(
      { name: 'council.extendDebate', op: 'ui.action' },
      async () => {
        try {
          await api.extendDebateStream(
            conversationId,
            (eventType, event) => {
              if (controller.signal.aborted) return;
              Sentry.addBreadcrumb({ category: 'sse', message: eventType, level: 'info' });
              dispatch({ type: eventType, payload: event });

              if (eventType === 'complete') {
                console.info('[stream] extendDebate complete. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
                onComplete?.();
              }
              if (eventType === 'error') {
                console.error('[stream] extendDebate server error. ConversationId: %s, Event: %o', conversationId, event);
                dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
              }
              if (eventType === 'server_shutdown') {
                console.warn('[stream] Server shutting down mid-stream. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
                onServerShutdown?.(event.message || 'Server is restarting');
              }
            },
            controller.signal,
          );
        } catch (error) {
          if (error.name === 'AbortError') return;
          if (error instanceof AuthRedirectError) { onAuthExpired?.(); return; }
          Sentry.captureException(error, { tags: { operation: 'extendDebate', conversationId } });
          console.error('[stream] extendDebate failed. ConversationId: %s, Error: %s', conversationId, error.message, error);
          dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
        }
      },
    );
  }, [onComplete, onAuthExpired, onServerShutdown]);

  // ── Retry Stage 3 ──────────────────────────────────────────────────────

  const retryStage3 = useCallback(async (conversationId) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    console.info('[stream] retryStage3. ConversationId: %s', conversationId);
    dispatch({ type: 'SET_LOADING', payload: { isLoading: true } });

    await Sentry.startSpan(
      { name: 'council.retryStage3', op: 'ui.action' },
      async () => {
        try {
          await api.retryStage3Stream(
            conversationId,
            (eventType, event) => {
              if (controller.signal.aborted) return;
              console.debug('[stream] retryStage3 event: %s', eventType);
              Sentry.addBreadcrumb({ category: 'sse', message: eventType, level: 'info' });
              dispatch({ type: eventType, payload: event });

              if (eventType === 'complete') {
                console.info('[stream] retryStage3 complete. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
                onComplete?.();
              }
              if (eventType === 'error') {
                console.error('[stream] retryStage3 server error. ConversationId: %s, Event: %o', conversationId, event);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
              }
              if (eventType === 'server_shutdown') {
                console.warn('[stream] Server shutting down mid-stream. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
                onServerShutdown?.(event.message || 'Server is restarting');
              }
            },
            controller.signal,
          );
        } catch (error) {
          if (error.name === 'AbortError') return;
          if (error instanceof AuthRedirectError) { onAuthExpired?.(); return; }
          Sentry.captureException(error, { tags: { operation: 'retryStage3', conversationId } });
          console.error('[stream] retryStage3 failed. ConversationId: %s, Error: %s', conversationId, error.message, error);
          dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
        }
      },
    );
  }, [onComplete, onAuthExpired, onServerShutdown]);

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
