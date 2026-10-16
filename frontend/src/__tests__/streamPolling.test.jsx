// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../api';
import { useUIStore } from '../stores/uiStore';

const fixture = vi.hoisted(() => ({
  queries: {},
  pending: {},
  pendingHook: vi.fn(),
  noop: () => {},
  config: { council_models: [] },
  streams: [],
}));
vi.mock('@sentry/browser', () => ({
  startSpan: (_options, callback) => callback(),
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('../components/Sidebar', () => ({ default: () => null }));
vi.mock('../components/Standings', () => ({ default: () => null }));
vi.mock('../components/ChatInterface', () => ({
  default: ({ conversation, onSendMessage, onCancel }) => (
    <>
      <button id="send" onClick={() => onSendMessage('Question')}>
        Send
      </button>
      <button id="cancel" onClick={onCancel}>
        Cancel
      </button>
      <pre id="state">{JSON.stringify(conversation)}</pre>
    </>
  ),
}));
vi.mock('../hooks/queries', () => ({
  useConfig: () => ({ data: fixture.config }),
  useConversations: () => ({ data: [] }),
  useConversation: (id) => fixture.queries[id],
  usePendingStatus: (...args) => fixture.pendingHook(...args),
  useCreateConversation: () => ({ mutateAsync: fixture.noop }),
  useClearPending: () => ({ mutateAsync: fixture.noop }),
  useStreamInvalidation: () => fixture.noop,
}));

let root;
let container;
const readState = () => JSON.parse(container.querySelector('#state').textContent);
const pollingEnabled = () => fixture.pendingHook.mock.lastCall[1].enabled;
async function rerender() {
  await act(async () => root.render(<App />));
}
async function send() {
  await act(async () => container.querySelector('#send').click());
}
async function emit(type, data, index = fixture.streams.length - 1) {
  await act(async () => fixture.streams[index].onEvent(type, { type, data }));
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useUIStore.setState({
    currentConversationId: 'a',
    currentView: 'chat',
    pendingForkContext: null,
    authExpired: false,
    mode: 'council',
  });
  fixture.queries = {
    a: { data: { id: 'a', title: 'A', messages: [] }, isFetching: false },
    b: { data: { id: 'b', title: 'B', messages: [] }, isFetching: false },
  };
  fixture.pending = { data: { pending: false }, isLoading: false };
  fixture.streams = [];
  fixture.pendingHook.mockReset().mockImplementation(() => fixture.pending);
  vi.spyOn(api, 'sendMessageStream').mockImplementation(
    (_id, _content, _search, _mode, _arena, _files, onEvent, _resume, _context, signal) =>
      new Promise((resolve, reject) => fixture.streams.push({ onEvent, signal, resolve, reject }))
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await rerender();
});
afterEach(async () => {
  await act(async () => {
    container.querySelector('#cancel')?.click();
    fixture.streams.forEach((stream) => stream.resolve());
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('local stream ownership', () => {
  it.each(['cancel', 'SSE error', 'shutdown'])(
    'preserves tokens after a mid-stream refetch and %s until a saved assistant changes',
    async (ending) => {
      const savedHistory = [
        { role: 'user', content: 'Earlier question' },
        { role: 'assistant', rounds: [], synthesis: 'Earlier answer' },
      ];
      fixture.queries.a.data = { id: 'a', title: 'A', messages: savedHistory };
      fixture.queries.a.refetch = vi.fn();
      await rerender();
      await send();
      await emit('round_start', { round_type: 'responses', round_number: 1, models: ['m'] });
      await emit('model_token', { model: 'm', token: 'Keep mid-stream progress' });
      fixture.queries.a.data = {
        id: 'a',
        title: 'Mid-stream snapshot',
        messages: [{ role: 'user', content: 'Question' }],
      };
      await rerender();
      if (ending === 'cancel') {
        await act(async () => container.querySelector('#cancel').click());
      } else {
        await emit(ending === 'shutdown' ? 'server_shutdown' : 'error');
      }
      await act(async () => fixture.streams[0].resolve());
      expect(readState().messages).toHaveLength(4);
      expect(readState().messages.at(-1).streaming.tokens.m).toBe('Keep mid-stream progress');
      expect(pollingEnabled()).toBe(true);
      if (ending === 'shutdown') expect(fixture.queries.a.refetch).toHaveBeenCalledOnce();

      // Cloned saved history and partial assistant checkpoints are not new results.
      for (const messages of [
        JSON.parse(JSON.stringify(savedHistory)),
        [...savedHistory, { role: 'assistant', partial: true, rounds: [] }],
      ]) {
        fixture.queries.a.data = { id: 'a', title: 'Still stale', messages };
        await rerender();
        expect(readState().messages).toHaveLength(4);
        expect(readState().messages.at(-1).streaming.tokens.m).toBe('Keep mid-stream progress');
      }
      const savedResult = { role: 'assistant', rounds: [], synthesis: 'Updated saved answer' };
      fixture.queries.a.data = {
        id: 'a',
        title: 'Saved result',
        messages: [savedHistory[0], savedResult],
      };
      fixture.queries.a.isFetching = true;
      await rerender();
      expect(readState().messages.at(-1).streaming.tokens.m).toBe('Keep mid-stream progress');
      fixture.queries.a.isFetching = false;
      await rerender();
      expect(readState().messages.at(-1)).toEqual(savedResult);
    }
  );

  it('renders cached conversation b while its stale cache is fetching', async () => {
    expect(readState().id).toBe('a');
    fixture.queries.b.isFetching = true;
    await act(async () => useUIStore.getState().setCurrentConversationId('b'));
    expect(readState()).toMatchObject({ id: 'b', title: 'B', messages: [] });
    await send();
    expect(api.sendMessageStream.mock.lastCall[0]).toBe('b');
    expect(readState().id).toBe('b');
    expect(readState().messages[0].content).toBe('Question');
  });

  it('preserves cancelled tokens when the transport rejects after cancellation', async () => {
    await send();
    await emit('round_start', { round_type: 'responses', round_number: 1, models: ['m'] });
    await emit('model_token', { model: 'm', token: 'Cancelled progress' });
    await act(async () => container.querySelector('#cancel').click());
    await act(async () => fixture.streams[0].reject(new Error('Late transport failure')));
    expect(readState().messages).toHaveLength(2);
    expect(readState().messages.at(-1).streaming.tokens.m).toBe('Cancelled progress');
    expect(readState()._isLoading).toBe(false);
    expect(pollingEnabled()).toBe(true);
  });

  it('captures a new baseline when another stream starts on the same conversation before EOF', async () => {
    await send();
    await emit('error');
    fixture.queries.a = {
      data: { id: 'a', title: 'A checkpoint', messages: [] },
      isFetching: false,
    };
    await rerender();
    await send();
    expect(fixture.streams[0].signal.aborted).toBe(true);
    await emit('round_start', { round_type: 'responses', round_number: 1, models: ['m'] });
    await emit('model_token', { model: 'm', token: 'Second stream progress' });
    await act(async () => fixture.streams[0].resolve());
    expect(pollingEnabled()).toBe(false);
    await act(async () => container.querySelector('#cancel').click());
    await act(async () => fixture.streams[1].resolve());
    expect(readState().messages).toHaveLength(4);
    expect(readState().messages.at(-1).streaming.tokens.m).toBe('Second stream progress');
    expect(pollingEnabled()).toBe(true);
  });

  it('adopts a fresh saved result after completion even if it arrived before reader EOF', async () => {
    await send();
    await emit('round_start', { round_type: 'responses', round_number: 1, models: ['m'] });
    await emit('model_token', { model: 'm', token: 'Local progress' });
    await emit('complete');
    fixture.queries.a = {
      data: {
        id: 'a',
        title: 'Fresh before EOF',
        messages: [
          { role: 'user', content: 'Question' },
          {
            role: 'assistant',
            rounds: [
              { round_type: 'responses', responses: [{ model: 'm', content: 'Saved answer' }] },
            ],
          },
        ],
      },
      isFetching: false,
    };
    await rerender();
    expect(readState().messages.at(-1).streaming.tokens.m).toBe('Local progress');
    await act(async () => fixture.streams[0].resolve());
    expect(readState().title).toBe('Fresh before EOF');
    expect(readState().messages.at(-1).rounds[0].responses[0].content).toBe('Saved answer');
  });

  it('protects an immediate SSE error even when React batches start and finish together', async () => {
    api.sendMessageStream.mockImplementation(
      (_id, _content, _search, _mode, _arena, _files, onEvent) => {
        onEvent('round_start', {
          type: 'round_start',
          data: { round_type: 'responses', round_number: 1, models: ['m'] },
        });
        onEvent('model_token', {
          type: 'model_token',
          data: { model: 'm', token: 'Fast progress' },
        });
        onEvent('error', { type: 'error', message: 'Please retry' });
        return Promise.resolve();
      }
    );
    await send();
    expect(readState().messages).toHaveLength(2);
    fixture.pending = { data: { pending: false }, isLoading: false };
    await rerender();
    expect(readState().messages).toHaveLength(2);
    expect(readState().messages.at(-1).streaming.tokens.m).toBe('Fast progress');
    expect(pollingEnabled()).toBe(true);
  });

  it.each(['cancel', 'SSE error'])(
    'preserves streamed messages after %s without a refetch',
    async (ending) => {
      await send();
      await emit('round_start', { round_type: 'responses', round_number: 1, models: ['m'] });
      await emit('model_token', { model: 'm', token: 'Preserve this progress' });
      if (ending === 'cancel') {
        await act(async () => container.querySelector('#cancel').click());
      } else {
        await emit('error');
      }
      await act(async () => fixture.streams[0].resolve());
      expect(pollingEnabled()).toBe(true);
      expect(readState().messages).toHaveLength(2);
      expect(readState().messages.at(-1).streaming.tokens.m).toBe('Preserve this progress');
      expect(readState()._isLoading).toBe(false);
      // Pending-only refreshes must not reapply the unchanged pre-stream conversation.
      for (const data of [
        { pending: false },
        { pending: true, stale: false },
        {
          pending: true,
          stale: true,
          partial_data: { responses: [{ content: 'Old checkpoint' }] },
        },
      ]) {
        fixture.pending = { data, isLoading: false };
        await rerender();
        expect(readState().messages).toHaveLength(2);
        expect(readState().messages.at(-1).streaming.tokens.m).toBe('Preserve this progress');
      }
      fixture.pending = { data: { pending: false }, isLoading: false };
      fixture.queries.a = {
        data: {
          id: 'a',
          title: 'Authoritative saved result',
          messages: [{ role: 'assistant', rounds: [] }],
        },
        isFetching: false,
      };
      await rerender();
      expect(readState().title).toBe('Authoritative saved result');
      expect(readState().messages).toHaveLength(1);
    }
  );

  it('preserves live tokens across late pending snapshots and resumes polling after completion', async () => {
    expect(pollingEnabled()).toBe(true);
    await send();
    await emit('round_start', { round_type: 'responses', round_number: 1, models: ['m'] });
    await emit('model_token', { model: 'm', token: 'Paid-for progress' });
    expect(pollingEnabled()).toBe(false);
    for (const data of [
      { pending: true, stale: false },
      { pending: true, stale: true, partial_data: { responses: [{ content: 'Old checkpoint' }] } },
      { pending: false },
    ]) {
      fixture.pending = { data, isLoading: false };
      await rerender();
      expect(readState().messages).toHaveLength(2);
      expect(readState().messages.at(-1).streaming.tokens.m).toBe('Paid-for progress');
    }
    fixture.queries.a.isFetching = true;
    await emit('complete');
    await act(async () => fixture.streams[0].resolve());
    expect(pollingEnabled()).toBe(true);
    expect(readState().messages.at(-1).streaming.tokens.m).toBe('Paid-for progress');
    fixture.queries.a = {
      data: { id: 'a', title: 'Saved response', messages: [{ role: 'assistant', rounds: [] }] },
      isFetching: false,
    };
    await rerender();
    expect(readState().title).toBe('Saved response');
  });

  it('keeps remote pending polling active and can surface an interrupted response', async () => {
    fixture.pending = { data: { pending: true, stale: false }, isLoading: false };
    await rerender();
    expect(readState()._isLoading).toBe(true);
    expect(pollingEnabled()).toBe(true);
    fixture.pending = { data: { pending: true, stale: true }, isLoading: false };
    await rerender();
    expect(readState().pendingInterrupted).toBe(true);
    expect(pollingEnabled()).toBe(true);
  });

  it('releases polling on cancellation without letting an old stream release a newer one', async () => {
    await send();
    expect(pollingEnabled()).toBe(false);
    await act(async () => useUIStore.getState().setCurrentConversationId('b'));
    expect(fixture.streams[0].signal.aborted).toBe(true);
    expect(pollingEnabled()).toBe(true);
    await send();
    expect(pollingEnabled()).toBe(false);
    await act(async () => fixture.streams[0].resolve());
    expect(pollingEnabled()).toBe(false);
    await act(async () => container.querySelector('#cancel').click());
    expect(pollingEnabled()).toBe(true);
  });

  it('releases polling after a transport failure', async () => {
    await send();
    await act(async () => fixture.streams[0].reject(new Error('Network failed')));
    expect(pollingEnabled()).toBe(true);
    expect(readState()._isLoading).not.toBe(true);
  });
});
