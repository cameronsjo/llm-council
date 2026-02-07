/**
 * Custom hook that owns conversation state (via useReducer),
 * an AbortController for cancellation, and the streaming API calls.
 *
 * Side effects (e.g. refreshing the sidebar) are delegated to
 * callbacks passed in via the options object.
 */
import { useCallback, useReducer, useRef } from 'react';
import * as Sentry from '@sentry/browser';
import { api, AuthRedirectError, SSETimeoutError } from '../api';
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
        let receivedTerminal = false;
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
                receivedTerminal = true;
                console.info('[stream] sendMessage complete. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
                onComplete?.();
              }
              if (eventType === 'error') {
                receivedTerminal = true;
                console.error('[stream] sendMessage server error. ConversationId: %s, Event: %o', conversationId, event);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
              }
              if (eventType === 'server_shutdown') {
                receivedTerminal = true;
                console.warn('[stream] Server shutting down mid-stream. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
                onServerShutdown?.(event.message || 'Server is restarting');
              }
            },
            resume,
            priorContext,
            controller.signal,
          );

          // Safety net: stream ended without a terminal event (complete/error/server_shutdown)
          if (!receivedTerminal && !controller.signal.aborted) {
            console.warn('[stream] sendMessage stream ended without terminal event. ConversationId: %s', conversationId);
            dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
            onComplete?.();
          }
        } catch (error) {
          if (error.name === 'AbortError') return;
          if (error instanceof AuthRedirectError) { onAuthExpired?.(); return; }
          if (error instanceof SSETimeoutError) {
            Sentry.captureMessage('SSE stream timed out', { level: 'warning', tags: { operation: 'sendMessage', conversationId } });
            console.warn('[stream] sendMessage timed out. ConversationId: %s', conversationId);
            dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
            onServerShutdown?.('Stream timed out — the server may be unresponsive');
            return;
          }
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
        let receivedTerminal = false;
        try {
          await api.extendDebateStream(
            conversationId,
            (eventType, event) => {
              if (controller.signal.aborted) return;
              Sentry.addBreadcrumb({ category: 'sse', message: eventType, level: 'info' });
              dispatch({ type: eventType, payload: event });

              if (eventType === 'complete') {
                receivedTerminal = true;
                console.info('[stream] extendDebate complete. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
                onComplete?.();
              }
              if (eventType === 'error') {
                receivedTerminal = true;
                console.error('[stream] extendDebate server error. ConversationId: %s, Event: %o', conversationId, event);
                dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
              }
              if (eventType === 'server_shutdown') {
                receivedTerminal = true;
                console.warn('[stream] Server shutting down mid-stream. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
                onServerShutdown?.(event.message || 'Server is restarting');
              }
            },
            controller.signal,
          );

          if (!receivedTerminal && !controller.signal.aborted) {
            console.warn('[stream] extendDebate stream ended without terminal event. ConversationId: %s', conversationId);
            dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
            onComplete?.();
          }
        } catch (error) {
          if (error.name === 'AbortError') return;
          if (error instanceof AuthRedirectError) { onAuthExpired?.(); return; }
          if (error instanceof SSETimeoutError) {
            Sentry.captureMessage('SSE stream timed out', { level: 'warning', tags: { operation: 'extendDebate', conversationId } });
            console.warn('[stream] extendDebate timed out. ConversationId: %s', conversationId);
            dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
            onServerShutdown?.('Stream timed out — the server may be unresponsive');
            return;
          }
          Sentry.captureException(error, { tags: { operation: 'extendDebate', conversationId } });
          console.error('[stream] extendDebate failed. ConversationId: %s, Error: %s', conversationId, error.message, error);
          dispatch({ type: 'SET_EXTENDING', payload: { isExtendingDebate: false } });
        }
      },
    );
  }, [onComplete, onAuthExpired, onServerShutdown]);

  // ── Retry Synthesis ────────────────────────────────────────────────────

  const retrySynthesis = useCallback(async (conversationId) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    console.info('[stream] retrySynthesis. ConversationId: %s', conversationId);
    dispatch({ type: 'SET_LOADING', payload: { isLoading: true } });

    await Sentry.startSpan(
      { name: 'council.retrySynthesis', op: 'ui.action' },
      async () => {
        let receivedTerminal = false;
        try {
          await api.retrySynthesisStream(
            conversationId,
            (eventType, event) => {
              if (controller.signal.aborted) return;
              console.debug('[stream] retrySynthesis event: %s', eventType);
              Sentry.addBreadcrumb({ category: 'sse', message: eventType, level: 'info' });
              dispatch({ type: eventType, payload: event });

              if (eventType === 'complete') {
                receivedTerminal = true;
                console.info('[stream] retrySynthesis complete. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
                onComplete?.();
              }
              if (eventType === 'error') {
                receivedTerminal = true;
                console.error('[stream] retrySynthesis server error. ConversationId: %s, Event: %o', conversationId, event);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
              }
              if (eventType === 'server_shutdown') {
                receivedTerminal = true;
                console.warn('[stream] Server shutting down mid-stream. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
                onServerShutdown?.(event.message || 'Server is restarting');
              }
            },
            controller.signal,
          );

          if (!receivedTerminal && !controller.signal.aborted) {
            console.warn('[stream] retrySynthesis stream ended without terminal event. ConversationId: %s', conversationId);
            dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
            onComplete?.();
          }
        } catch (error) {
          if (error.name === 'AbortError') return;
          if (error instanceof AuthRedirectError) { onAuthExpired?.(); return; }
          if (error instanceof SSETimeoutError) {
            Sentry.captureMessage('SSE stream timed out', { level: 'warning', tags: { operation: 'retrySynthesis', conversationId } });
            console.warn('[stream] retrySynthesis timed out. ConversationId: %s', conversationId);
            dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
            onServerShutdown?.('Stream timed out — the server may be unresponsive');
            return;
          }
          Sentry.captureException(error, { tags: { operation: 'retrySynthesis', conversationId } });
          console.error('[stream] retrySynthesis failed. ConversationId: %s, Error: %s', conversationId, error.message, error);
          dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
        }
      },
    );
  }, [onComplete, onAuthExpired, onServerShutdown]);

  // ── Retry Rankings ────────────────────────────────────────────────────

  const retryRankings = useCallback(async (conversationId) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    console.info('[stream] retryRankings. ConversationId: %s', conversationId);
    dispatch({ type: 'SET_LOADING', payload: { isLoading: true } });

    await Sentry.startSpan(
      { name: 'council.retryRankings', op: 'ui.action' },
      async () => {
        let receivedTerminal = false;
        try {
          await api.retryRankingsStream(
            conversationId,
            (eventType, event) => {
              if (controller.signal.aborted) return;
              console.debug('[stream] retryRankings event: %s', eventType);
              Sentry.addBreadcrumb({ category: 'sse', message: eventType, level: 'info' });
              dispatch({ type: eventType, payload: event });

              if (eventType === 'complete') {
                receivedTerminal = true;
                console.info('[stream] retryRankings complete. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
                onComplete?.();
              }
              if (eventType === 'error') {
                receivedTerminal = true;
                console.error('[stream] retryRankings server error. ConversationId: %s, Event: %o', conversationId, event);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
              }
              if (eventType === 'server_shutdown') {
                receivedTerminal = true;
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
                onServerShutdown?.(event.message || 'Server is restarting');
              }
            },
            controller.signal,
          );

          if (!receivedTerminal && !controller.signal.aborted) {
            dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
            onComplete?.();
          }
        } catch (error) {
          if (error.name === 'AbortError') return;
          if (error instanceof AuthRedirectError) { onAuthExpired?.(); return; }
          if (error instanceof SSETimeoutError) {
            Sentry.captureMessage('SSE stream timed out', { level: 'warning', tags: { operation: 'retryRankings', conversationId } });
            dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
            onServerShutdown?.('Stream timed out — the server may be unresponsive');
            return;
          }
          Sentry.captureException(error, { tags: { operation: 'retryRankings', conversationId } });
          console.error('[stream] retryRankings failed. ConversationId: %s, Error: %s', conversationId, error.message, error);
          dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
        }
      },
    );
  }, [onComplete, onAuthExpired, onServerShutdown]);

  // ── Retry All (full re-run) ───────────────────────────────────────────

  const retryAll = useCallback(async (conversationId) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    console.info('[stream] retryAll. ConversationId: %s', conversationId);
    dispatch({ type: 'SET_LOADING', payload: { isLoading: true } });

    await Sentry.startSpan(
      { name: 'council.retryAll', op: 'ui.action' },
      async () => {
        let receivedTerminal = false;
        try {
          await api.retryAllStream(
            conversationId,
            (eventType, event) => {
              if (controller.signal.aborted) return;
              console.debug('[stream] retryAll event: %s', eventType);
              Sentry.addBreadcrumb({ category: 'sse', message: eventType, level: 'info' });
              dispatch({ type: eventType, payload: event });

              if (eventType === 'complete') {
                receivedTerminal = true;
                console.info('[stream] retryAll complete. ConversationId: %s', conversationId);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
                onComplete?.();
              }
              if (eventType === 'error') {
                receivedTerminal = true;
                console.error('[stream] retryAll server error. ConversationId: %s, Event: %o', conversationId, event);
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
              }
              if (eventType === 'server_shutdown') {
                receivedTerminal = true;
                dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
                onServerShutdown?.(event.message || 'Server is restarting');
              }
            },
            controller.signal,
          );

          if (!receivedTerminal && !controller.signal.aborted) {
            dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
            onComplete?.();
          }
        } catch (error) {
          if (error.name === 'AbortError') return;
          if (error instanceof AuthRedirectError) { onAuthExpired?.(); return; }
          if (error instanceof SSETimeoutError) {
            Sentry.captureMessage('SSE stream timed out', { level: 'warning', tags: { operation: 'retryAll', conversationId } });
            dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
            onServerShutdown?.('Stream timed out — the server may be unresponsive');
            return;
          }
          Sentry.captureException(error, { tags: { operation: 'retryAll', conversationId } });
          console.error('[stream] retryAll failed. ConversationId: %s, Error: %s', conversationId, error.message, error);
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
    retryAll,
    retryRankings,
    retrySynthesis,
    cancelStream,
    updateTitle,
    dispatch, // escape hatch for edge cases
  };
}
