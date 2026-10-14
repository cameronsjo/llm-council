// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatInterface from '../components/ChatInterface';
import { api, AuthRedirectError } from '../api';
import { useUIStore } from '../stores/uiStore';

vi.mock('../hooks/queries', () => ({
  useConfig: () => ({ data: { council_models: [] } }),
}));

let root;
let container;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useUIStore.setState({ mode: 'council', pendingForkContext: null, authExpired: false });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete HTMLElement.prototype.scrollIntoView;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderComposer(view = 'landing') {
  await act(async () =>
    root.render(
      <ChatInterface
        conversation={{
          id: 'a',
          messages: view === 'landing' ? [] : [{ role: 'user', content: 'Earlier question' }],
        }}
        isLoading={false}
        onSendMessage={vi.fn()}
      />
    )
  );
}

async function selectFiles(files) {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

describe.each(['landing', 'follow-up'])('%s upload settlement', (view) => {
  it('routes auth expiry to the store, retains successes, and retries only ordinary failures', async () => {
    const files = ['good.pdf', 'expired.pdf', 'bad.pdf'].map(
      (name) => new File(['pdf'], name, { type: 'application/pdf' })
    );
    let retrySucceeds = false;
    const upload = vi.spyOn(api, 'uploadAttachment').mockImplementation(async (file) => {
      if (file === files[1]) throw new AuthRedirectError('/login');
      if (file === files[2] && !retrySucceeds) throw new Error('Too large');
      return { id: file.name, filename: file.name, file_type: 'pdf' };
    });
    await renderComposer(view);
    await selectFiles(files);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(useUIStore.getState().authExpired).toBe(true);
    expect(container.querySelector('.attachment-chip').textContent).toContain('good.pdf');
    const banner = container.querySelector('.upload-errors');
    expect(banner.textContent).toContain('bad.pdf: Too large');
    expect(banner.textContent).not.toContain('expired.pdf');
    expect(banner.querySelectorAll('.upload-error')).toHaveLength(1);

    retrySucceeds = true;
    const retry = Array.from(banner.querySelectorAll('button')).find(
      (button) => button.textContent === 'Retry'
    );
    await act(async () => retry.click());
    expect(upload).toHaveBeenCalledTimes(4);
    expect(upload.mock.lastCall[0]).toBe(files[2]);
    expect(container.querySelector('.upload-errors')).toBeNull();
    expect(
      Array.from(container.querySelectorAll('.attachment-name'), (node) => node.textContent)
    ).toEqual(['good.pdf', 'bad.pdf']);
    // A successful retry must not clear a session-expired signal.
    expect(useUIStore.getState().authExpired).toBe(true);
  });
});

it('merges against current state when an attachment is removed during another upload', async () => {
  const first = new File(['a'], 'first.pdf');
  const second = new File(['b'], 'second.pdf');
  let finish;
  vi.spyOn(api, 'uploadAttachment').mockImplementation((file) => {
    if (file === first) return Promise.resolve({ id: 'first', filename: first.name });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await renderComposer();
  await selectFiles([first]);
  await selectFiles([second]);
  await act(async () => container.querySelector('[aria-label="Remove first.pdf"]').click());
  await act(async () => finish({ id: 'second', filename: second.name }));
  expect(
    Array.from(container.querySelectorAll('.attachment-name'), (node) => node.textContent)
  ).toEqual(['second.pdf']);
  expect(useUIStore.getState().authExpired).toBe(false);
});
