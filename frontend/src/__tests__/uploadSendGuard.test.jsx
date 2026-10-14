// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatInterface from '../components/ChatInterface';
import { api } from '../api';
import { useUIStore } from '../stores/uiStore';

vi.mock('../hooks/queries', () => ({
  useConfig: () => ({ data: { council_models: [] } }),
}));

let root;
let container;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useUIStore.setState({ mode: 'council', pendingForkContext: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // jsdom has no layout or scrolling; this is unrelated to composer behavior.
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete HTMLElement.prototype.scrollIntoView;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(['landing', 'follow-up'])('%s composer uploads', (view) => {
  it('blocks submit until upload completes, then sends the uploaded attachment once', async () => {
    const onSendMessage = vi.fn();
    const attachment = { id: 'file-1', filename: 'document.pdf', file_type: 'pdf' };
    let finish;
    vi.spyOn(api, 'uploadAttachment').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await act(async () =>
      root.render(
        <ChatInterface
          conversation={{
            id: 'a',
            title: 'Conversation',
            messages: view === 'landing' ? [] : [{ role: 'user', content: 'Earlier question' }],
          }}
          isLoading={false}
          onSendMessage={onSendMessage}
        />
      )
    );
    const textarea = container.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
        textarea,
        'Read the attached document'
      );
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', {
      value: [new File(['document'], 'document.pdf', { type: 'application/pdf' })],
    });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const send = container.querySelector('button[type="submit"]');
    expect(send.disabled).toBe(true);
    expect(send.textContent).toContain('Uploading');
    expect(textarea.disabled).toBe(true);
    await act(async () => {
      send.click();
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      // Exercise the submit guard even when bypassing the disabled controls.
      container
        .querySelector('form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(textarea.value).toBe('Read the attached document');
    await act(async () => finish(attachment));
    expect(textarea.disabled).toBe(false);
    expect(send.disabled).toBe(false);
    await act(async () => send.click());
    expect(onSendMessage).toHaveBeenCalledExactlyOnceWith('Read the attached document', [
      attachment,
    ]);
    expect(container.querySelector('.attachment-chip')).toBeNull();
    expect(textarea.value).toBe('');
  });
});
