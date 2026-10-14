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
