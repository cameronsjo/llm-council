// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../api';
import { useUIStore } from '../stores/uiStore';

const fixture = vi.hoisted(() => ({
  conversations: {
    a: { id: 'a', title: 'A', messages: [] },
    b: { id: 'b', title: 'B', messages: [] },
  },
  noop: () => {},
}));
vi.mock('../components/Sidebar', () => ({ default: () => null }));
vi.mock('../components/Standings', () => ({ default: () => null }));
vi.mock('../hooks/queries', () => ({
  useConfig: () => ({ data: { council_models: [] } }),
  useConversations: () => ({ data: [] }),
  useConversation: (id) => ({ data: fixture.conversations[id] }),
  usePendingStatus: () => ({ data: { pending: false }, isLoading: false }),
  useCreateConversation: () => ({ mutateAsync: fixture.noop }),
  useClearPending: () => ({ mutateAsync: fixture.noop }),
}));
vi.mock('../hooks/useConversationStream', () => ({
  useConversationStream: () => ({
    conversation: fixture.conversations[useUIStore.getState().currentConversationId],
    isLoading: false,
    isExtendingDebate: false,
    setConversation: fixture.noop,
    sendMessage: fixture.noop,
    extendDebate: fixture.noop,
    retryAll: fixture.noop,
    retryRankings: fixture.noop,
    retrySynthesis: fixture.noop,
    cancelStream: fixture.noop,
  }),
}));

let root;
let container;
const attachment = { id: 'file-1', filename: 'private.pdf', file_type: 'pdf' };

async function selectFile() {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', {
    value: [new File(['document'], 'private.pdf', { type: 'application/pdf' })],
    configurable: true,
  });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

async function switchConversation(id) {
  await act(async () => useUIStore.getState().setCurrentConversationId(id));
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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('conversation drafts', () => {
  it('clears staged attachments and text when navigating A to B and back', async () => {
    vi.spyOn(api, 'uploadAttachment').mockResolvedValue(attachment);
    const textarea = container.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
        textarea,
        'Private draft'
      );
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await selectFile();
    expect(container.querySelector('textarea').value).toBe('Private draft');
    expect(container.querySelector('.attachment-chip').textContent).toContain('private.pdf');
    await switchConversation('b');
    expect(container.querySelector('textarea').value).toBe('');
    expect(container.querySelector('.attachment-chip')).toBeNull();
    await switchConversation('a');
    expect(container.querySelector('textarea').value).toBe('');
    expect(container.querySelector('.attachment-chip')).toBeNull();
  });

  it('ignores an upload that completes after leaving its conversation', async () => {
    let finish;
    vi.spyOn(api, 'uploadAttachment').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await selectFile();
    await switchConversation('b');
    await act(async () => finish(attachment));
    expect(container.querySelector('.attachment-chip')).toBeNull();
    expect(container.textContent).not.toContain('uploading');
  });
});
