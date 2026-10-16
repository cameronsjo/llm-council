// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatInterface from '../components/ChatInterface';
import { useConversationStream } from '../hooks/useConversationStream';
import { useUIStore } from '../stores/uiStore';
import { buildAssistantMessage, conversationReducer } from '../hooks/conversationReducer';

const fixture = vi.hoisted(() => ({ invalidate: vi.fn(), config: { council_models: [] } }));
vi.mock('@sentry/browser', () => ({
  startSpan: (_options, callback) => callback(),
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('../hooks/queries', () => ({
  useConfig: () => ({ data: fixture.config }),
  useStreamInvalidation: () => fixture.invalidate,
}));
const seed = { id: 'a', title: 'Conversation', messages: [] };
function Harness({ onComplete }) {
  const { conversation, isLoading, sendMessage, setConversation } = useConversationStream({
    onComplete,
  });
  useEffect(() => {
    setConversation(seed);
  }, [setConversation]);
  return (
    <ChatInterface
      conversation={conversation}
      isLoading={isLoading}
      onSendMessage={(content, attachments) =>
        sendMessage('a', content, attachments, { mode: 'council' })
      }
    />
  );
}
let root;
let container;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  delete HTMLElement.prototype.scrollIntoView;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  root = null;
});

describe('stream parse failure', () => {
  it('shows an actionable terminal error through the real reader/hook/UI without completing', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useUIStore.setState({ mode: 'council', pendingForkContext: null });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    fixture.invalidate.mockClear();
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"round_start","data":{"round_type":"responses","models":["m"]}}\n\n' +
              'data: {not json}\n\n' +
              'data: {"type":"complete"}\n\n'
          )
        );
      },
      cancel,
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    );
    const onComplete = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness onComplete={onComplete} />));
    const textarea = container.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
        textarea,
        'Question'
      );
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector('button[type="submit"]').click());
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Stream payload could not be read. Please retry.'
    );
    expect(container.querySelector('.stage-loading')).toBeNull();
    expect(container.textContent).not.toContain('Cancel');
    expect(onComplete).not.toHaveBeenCalled();
    expect(fixture.invalidate).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('preserves completed rounds on error and clears the error when retry starts', () => {
    const round = { round_type: 'responses', responses: [{ content: 'Paid response' }] };
    const message = { ...buildAssistantMessage('council'), rounds: [round] };
    message.loading.round = true;
    const state = { id: 'a', messages: [message] };
    const failed = conversationReducer(state, {
      type: 'error',
      payload: { message: 'Corrupt stream' },
    });
    expect(failed.messages[0].rounds).toEqual([round]);
    expect(failed.messages[0].loading.round).toBe(false);
    expect(failed.messages[0].streamError).toBe('Corrupt stream');
    const retry = conversationReducer(failed, {
      type: 'round_start',
      payload: { data: { round_type: 'rankings' } },
    });
    expect(retry.messages[0].streamError).toBeNull();
    expect(state.messages[0].loading.round).toBe(true);
  });
});
