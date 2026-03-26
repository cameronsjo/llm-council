/**
 * Custom hook that owns conversation state (via useReducer),
 * an AbortController for cancellation, and the streaming API calls.
 *
 * Query invalidation is handled internally via useStreamInvalidation.
 * The optional onComplete callback is called after invalidation for
 * any additional side effects the caller needs.
 */
import { useCallback, useReducer, useRef } from 'react';
import * as Sentry from '@sentry/browser';
import { api, AuthRedirectError, SSETimeoutError } from '../api';
import { conversationReducer } from './conversationReducer';
import { useStreamInvalidation } from './queries';

/**
 * @param {Object} options
 * @param {() => void} [options.onComplete]        Called after stream completes and queries are invalidated.
 * @param {() => void} [options.onAuthExpired]      Called when an auth redirect is detected.
 * @param {(msg: string) => void} [options.onServerShutdown]  Called when server is restarting mid-stream.
 */
export function useConversationStream({ onComplete, onAuthExpired, onServerShutdown } = {}) {
  const [conversation, dispatch] = useReducer(conversationReducer, null);
  const abortRef = useRef(null);
  const invalidateStream = useStreamInvalidation();

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

  // ── Stream executor (shared by all handlers) ──────────────────────────

  /**
   * Encapsulates the common stream lifecycle: abort management, loading
   * state, Sentry span, terminal-event handling, safety net, and error
   * catch with typed branches (AbortError, AuthRedirect, SSETimeout).
   *
   * @param {string} operationName   Identifier for logs and Sentry spans.
   * @param {string} conversationId  Target conversation.
   * @param {(onEvent: Function, signal: AbortSignal) => Promise<void>} apiFn
   *   The streaming API call. Receives an event callback and abort signal.
   * @param {Object} [opts]
   * @param {'isLoading'|'isExtendingDebate'} [opts.loadingKey='isLoading']
   *   Which loading flag to toggle.
   * @param {Array<{type: string, payload: unknown}>} [opts.setupActions=[]]
   *   Extra dispatch actions to fire before streaming begins (e.g.
   *   ADD_USER_MESSAGE). When present, a ROLLBACK_OPTIMISTIC dispatch is
   *   issued on non-terminal errors.
   */
  const _executeStream = useCallback(async (
    operationName,
    conversationId,
    apiFn,
    {
      loadingKey = 'isLoading',
      setupActions = [],
    } = {},
  ) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    console.info('[stream] %s. ConversationId: %s', operationName, conversationId);

    const loadingAction = loadingKey === 'isExtendingDebate' ? 'SET_EXTENDING' : 'SET_LOADING';
    const buildLoadingPayload = (active) =>
      loadingKey === 'isExtendingDebate'
        ? { isExtendingDebate: active }
        : { isLoading: active };

    dispatch({ type: loadingAction, payload: buildLoadingPayload(true) });
    for (const action of setupActions) dispatch(action);

    await Sentry.startSpan(
      { name: `council.${operationName}`, op: 'ui.action', attributes: { 'council.conversationId': conversationId } },
      async () => {
        let receivedTerminal = false;
        const resetLoading = () => {
          dispatch({ type: loadingAction, payload: buildLoadingPayload(false) });
        };

        try {
          await apiFn(
            (eventType, event) => {
              if (controller.signal.aborted) return;
              Sentry.addBreadcrumb({ category: 'sse', message: eventType, level: 'info' });
              dispatch({ type: eventType, payload: event });

              if (eventType === 'complete') {
                receivedTerminal = true;
                console.info('[stream] %s complete. ConversationId: %s', operationName, conversationId);
                resetLoading();
                invalidateStream(conversationId);
                onComplete?.();
              }
              if (eventType === 'error') {
                receivedTerminal = true;
                console.error('[stream] %s server error. ConversationId: %s, Event: %o', operationName, conversationId, event);
                resetLoading();
              }
              if (eventType === 'server_shutdown') {
                receivedTerminal = true;
                console.warn('[stream] Server shutting down mid-stream. ConversationId: %s', conversationId);
                resetLoading();
                onServerShutdown?.(event.message || 'Server is restarting');
              }
            },
            controller.signal,
          );

          // Safety net: stream ended without a terminal event (complete/error/server_shutdown)
          if (!receivedTerminal && !controller.signal.aborted) {
            console.warn('[stream] %s stream ended without terminal event. ConversationId: %s', operationName, conversationId);
            resetLoading();
            invalidateStream(conversationId);
            onComplete?.();
          }
        } catch (error) {
          if (error.name === 'AbortError') return;
          if (error instanceof AuthRedirectError) { onAuthExpired?.(); return; }
          if (error instanceof SSETimeoutError) {
            Sentry.captureMessage('SSE stream timed out', { level: 'warning', tags: { operation: operationName, conversationId } });
            console.warn('[stream] %s timed out. ConversationId: %s', operationName, conversationId);
            resetLoading();
            onServerShutdown?.('Stream timed out — the server may be unresponsive');
            return;
          }
          Sentry.captureException(error, { tags: { operation: operationName, conversationId } });
          console.error('[stream] %s failed. ConversationId: %s, Error: %s', operationName, conversationId, error.message, error);
          if (setupActions.length > 0) dispatch({ type: 'ROLLBACK_OPTIMISTIC' });
          resetLoading();
        }
      },
    );
  }, [onComplete, onAuthExpired, onServerShutdown, invalidateStream]);

  // ── Send message ───────────────────────────────────────────────────────

  const sendMessage = useCallback(async (
    conversationId,
    content,
    attachments,
    { mode, useWebSearch, arenaRoundCount, resume, priorContext },
  ) => {
    const arenaConfig = mode === 'arena' ? { round_count: arenaRoundCount } : null;
    await _executeStream('sendMessage', conversationId,
      (onEvent, signal) => api.sendMessageStream(conversationId, content, useWebSearch, mode, arenaConfig, attachments, onEvent, resume, priorContext, signal),
      {
        setupActions: [
          { type: 'ADD_USER_MESSAGE', payload: { content, attachments } },
          { type: 'ADD_ASSISTANT_MESSAGE', payload: { mode } },
        ],
      },
    );
  }, [_executeStream]);

  // ── Extend debate ──────────────────────────────────────────────────────

  const extendDebate = useCallback(async (conversationId) => {
    await _executeStream('extendDebate', conversationId,
      (onEvent, signal) => api.extendDebateStream(conversationId, onEvent, signal),
      { loadingKey: 'isExtendingDebate' },
    );
  }, [_executeStream]);

  // ── Retry Synthesis ────────────────────────────────────────────────────

  const retrySynthesis = useCallback(async (conversationId) => {
    await _executeStream('retrySynthesis', conversationId,
      (onEvent, signal) => api.retrySynthesisStream(conversationId, onEvent, signal),
    );
  }, [_executeStream]);

  // ── Retry Rankings ─────────────────────────────────────────────────────

  const retryRankings = useCallback(async (conversationId) => {
    await _executeStream('retryRankings', conversationId,
      (onEvent, signal) => api.retryRankingsStream(conversationId, onEvent, signal),
    );
  }, [_executeStream]);

  // ── Retry All (full re-run) ───────────────────────────────────────────

  const retryAll = useCallback(async (conversationId) => {
    await _executeStream('retryAll', conversationId,
      (onEvent, signal) => api.retryAllStream(conversationId, onEvent, signal),
    );
  }, [_executeStream]);

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
