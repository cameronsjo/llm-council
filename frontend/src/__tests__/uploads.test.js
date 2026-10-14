import { describe, expect, it, vi } from 'vitest';
import { uploadFiles } from '../lib/uploads';
import { AuthRedirectError } from '../api';

describe('uploadFiles', () => {
  it('preserves auth failures for the session-expired handler without losing successes', async () => {
    const files = [{ name: 'ok.pdf' }, { name: 'expired.pdf' }];
    const cause = new AuthRedirectError('/login');
    const result = await uploadFiles(files, async (file) => {
      if (file === files[1]) throw cause;
      return { id: 'ok' };
    });
    expect(result.attachments).toEqual([{ id: 'ok' }]);
    expect(result.errors[0].cause).toBe(cause);
  });
  it('retains successful uploads after a failure and retries only failed files', async () => {
    const files = [{ name: 'first.pdf' }, { name: 'bad.pdf' }, { name: 'last.pdf' }];
    const upload = vi.fn(async (file) => {
      if (file === files[1]) throw new Error('Too large');
      return { id: file.name };
    });
    const result = await uploadFiles(files, upload);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(result.attachments).toEqual([{ id: 'first.pdf' }, { id: 'last.pdf' }]);
    expect(result.errors).toEqual([
      {
        file: files[1],
        message: 'Too large',
        cause: expect.any(Error),
      },
    ]);
    const retry = vi.fn(async (file) => ({ id: file.name }));
    expect(
      await uploadFiles(
        result.errors.map((error) => error.file),
        retry
      )
    ).toEqual({ attachments: [{ id: 'bad.pdf' }], errors: [] });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('reports every failure with a fallback message', async () => {
    const file = { name: 'document.pdf' };
    expect(
      await uploadFiles([file], async () => {
        throw null;
      })
    ).toEqual({ attachments: [], errors: [{ file, message: 'Upload failed', cause: null }] });
  });
});
