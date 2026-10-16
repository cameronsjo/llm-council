import { describe, expect, it, vi } from 'vitest';
import { uploadFiles, mergeUploadState } from '../lib/uploads';
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

describe('mergeUploadState', () => {
  it('retains unrelated failures, replaces retries, and separates auth from retryable errors', () => {
    const retry = { name: 'retry.pdf' };
    const expired = { name: 'expired.pdf' };
    const other = { name: 'other.pdf' };
    const oldOther = { file: other, message: 'Keep this failure' };
    const oldRetry = { file: retry, message: 'Old failure' };
    const newRetry = { file: retry, message: 'Still too large', cause: new Error('Too large') };
    const authError = { file: expired, cause: new AuthRedirectError('/login') };
    const previous = Object.freeze({
      attachments: Object.freeze([{ id: 'already-attached' }]),
      errors: Object.freeze([oldOther, oldRetry]),
    });
    const result = Object.freeze({
      attachments: Object.freeze([{ id: 'new-success' }]),
      errors: Object.freeze([newRetry, authError]),
    });
    expect(mergeUploadState(previous, [retry, expired], result)).toEqual({
      attachments: [{ id: 'already-attached' }, { id: 'new-success' }],
      errors: [oldOther, newRetry],
      authExpired: true,
    });
    expect(previous.errors).toEqual([oldOther, oldRetry]);
    expect(result.errors).toEqual([newRetry, authError]);
  });

  it('clears a successful retry without dropping a distinct file with the same name', () => {
    const file = { name: 'same.pdf' };
    const otherFile = { name: 'same.pdf' };
    const unrelated = { file: otherFile, message: 'Keep me' };
    expect(
      mergeUploadState(
        { attachments: [], errors: [{ file, message: 'Old failure' }, unrelated] },
        [file],
        { attachments: [{ id: 'retry-success' }], errors: [] }
      )
    ).toEqual({
      attachments: [{ id: 'retry-success' }],
      errors: [unrelated],
      authExpired: false,
    });
  });

  it('keeps ordinary errors retryable without expiring the session', () => {
    const file = { name: 'bad.pdf' };
    const error = { file, message: 'Too large', cause: new Error('Too large') };
    expect(
      mergeUploadState({ attachments: [], errors: [] }, [file], {
        attachments: [],
        errors: [error],
      })
    ).toEqual({ attachments: [], errors: [error], authExpired: false });
  });
});
