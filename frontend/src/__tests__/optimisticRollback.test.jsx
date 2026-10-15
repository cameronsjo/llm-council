// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { conversationReducer } from '../hooks/conversationReducer';
import { useConversationStream } from '../hooks/useConversationStream';

const fixture = vi.hoisted(() => ({
  invalidate: vi.fn(),
}));

vi.mock('@sentry/browser', () => ({
  startSpan: (_options, callback) => callback(),
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useStreamInvalidation: () => fixture.invalidate,
}));

function makeConversation() {
  return {
    id: 'conversation-1',
    title: 'Conversation',
    messages: [{ role: 'assistant', content: 'Saved response' }],
  };
}

function addOptimisticPair(state, optimisticId, content) {
  let next = conversationReducer(state, {
    type: 'ADD_USER_MESSAGE',
    payload: { content, optimisticId },
  });
  next = conversationReducer(next, {
    type: 'ADD_ASSISTANT_MESSAGE',
    payload: { mode: 'council', optimisticId },
  });
  return next;
}

describe('optimistic message rollback', () => {
  it('removes only the matching interleaved optimistic pair', () => {
    const firstId = Symbol('first-send');
    const secondId = Symbol('second-send');
    let state = makeConversation();
    state = addOptimisticPair(state, firstId, 'First question');
    state = addOptimisticPair(state, secondId, 'Second question');

    const rolledBack = conversationReducer(state, {
      type: 'ROLLBACK_OPTIMISTIC',
      payload: { optimisticId: firstId },
    });

    expect(rolledBack.messages).toHaveLength(3);
    expect(rolledBack.messages.map((message) => message.content)).toEqual([
      'Saved response',
      'Second question',
      undefined,
    ]);
    expect(rolledBack.messages.map((message) => message._optimisticId)).toEqual([
      undefined,
      secondId,
      secondId,
    ]);
  });

  it('treats repeated rollback as a no-op after the pair is removed', () => {
    const optimisticId = Symbol('send');
    const state = addOptimisticPair(makeConversation(), optimisticId, 'Question');
    const action = { type: 'ROLLBACK_OPTIMISTIC', payload: { optimisticId } };
    const rolledBack = conversationReducer(state, action);

    expect(conversationReducer(rolledBack, action)).toEqual(rolledBack);
  });

  it.each([
    ['missing payload', undefined],
    ['null identity', null],
    ['unknown identity', Symbol('unknown-send')],
  ])('preserves saved and optimistic messages for %s', (_label, optimisticId) => {
    const savedState = addOptimisticPair(makeConversation(), Symbol('known-send'), 'Question');
    const action =
      optimisticId === undefined
        ? { type: 'ROLLBACK_OPTIMISTIC' }
        : { type: 'ROLLBACK_OPTIMISTIC', payload: { optimisticId } };

    expect(conversationReducer(savedState, action)).toEqual(savedState);
  });
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let root;
let container;
let streamApi;

function StreamHarness() {
  const currentStreamApi = useConversationStream();
  const { setConversation } = currentStreamApi;
  useEffect(() => {
    streamApi = currentStreamApi;
  }, [currentStreamApi]);
  useEffect(() => {
    setConversation(makeConversation());
  }, [setConversation]);
  return null;
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  root = null;
  container = null;
  streamApi = null;
  fixture.invalidate.mockReset();
});

describe('useConversationStream optimistic rollback', () => {
  it('rolls back only the failed send after a later optimistic pair starts', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const firstRequest = deferred();
    const secondRequest = deferred();
    vi.spyOn(api, 'sendMessageStream')
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<StreamHarness />));

    let firstSend;
    let secondSend;
    await act(async () => {
      firstSend = streamApi.sendMessage('conversation-1', 'First question', [], {
        mode: 'council',
      });
    });
    await act(async () => {
      secondSend = streamApi.sendMessage('conversation-1', 'Second question', [], {
        mode: 'council',
      });
    });

    await act(async () => {
      firstRequest.reject(new Error('first stream failed'));
      await firstSend;
    });

    expect(streamApi.conversation.messages).toHaveLength(3);
    expect(streamApi.conversation.messages.map((message) => message.content)).toEqual([
      'Saved response',
      'Second question',
      undefined,
    ]);

    await act(async () => {
      secondRequest.resolve();
      await secondSend;
    });
  });
});
