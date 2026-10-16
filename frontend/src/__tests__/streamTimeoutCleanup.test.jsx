// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, SSETimeoutError } from '../api';
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

const savedMessages = [
  { role: 'user', content: 'Saved question' },
  { role: 'assistant', content: 'Saved response' },
];

function makeConversation() {
  return {
    id: 'conversation-1',
    title: 'Conversation',
    messages: savedMessages,
  };
}

let root;
let container;
let streamApi;

function StreamHarness({ onComplete, onServerShutdown }) {
  const currentStreamApi = useConversationStream({ onComplete, onServerShutdown });
  const { setConversation } = currentStreamApi;

  useEffect(() => {
    streamApi = currentStreamApi;
  }, [currentStreamApi]);

  useEffect(() => {
    setConversation(makeConversation());
  }, [setConversation]);

  return null;
}

async function mountStream(onComplete = vi.fn(), onServerShutdown = vi.fn()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(<StreamHarness onComplete={onComplete} onServerShutdown={onServerShutdown} />)
  );
  return { onComplete, onServerShutdown };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.invalidate.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  root = null;
  container = null;
  streamApi = null;
});

describe('SSE timeout cleanup', () => {
  it('rolls back the optimistic pair, keeps saved history, and reports recovery', async () => {
    vi.spyOn(api, 'sendMessageStream').mockRejectedValue(new SSETimeoutError(25));
    const { onComplete, onServerShutdown } = await mountStream();

    let sendMessage;
    await act(async () => {
      sendMessage = streamApi.sendMessage('conversation-1', 'New question', [], {
        mode: 'council',
      });
    });
    await act(async () => {
      await sendMessage;
    });

    expect(streamApi.conversation.messages).toEqual(savedMessages);
    expect(streamApi.isLoading).toBe(false);
    expect(onServerShutdown).toHaveBeenCalledTimes(1);
    expect(onServerShutdown).toHaveBeenCalledWith(
      'Stream timed out — the server may be unresponsive'
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(fixture.invalidate).not.toHaveBeenCalled();
  });

  it.each([
    ['retryAll', 'retryAllStream', 'isLoading'],
    ['extendDebate', 'extendDebateStream', 'isExtendingDebate'],
  ])(
    'preserves saved messages when %s times out without optimistic setup actions',
    async (operation, apiMethod, loadingFlag) => {
      vi.spyOn(api, apiMethod).mockRejectedValue(new SSETimeoutError(25));
      const { onServerShutdown } = await mountStream();

      let operationPromise;
      await act(async () => {
        operationPromise = streamApi[operation]('conversation-1');
      });
      await act(async () => {
        await operationPromise;
      });

      expect(streamApi.conversation.messages).toEqual(savedMessages);
      expect(streamApi[loadingFlag]).toBe(false);
      expect(onServerShutdown).toHaveBeenCalledOnce();
    }
  );
});
