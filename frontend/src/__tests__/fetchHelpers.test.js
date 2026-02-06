import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchJSON, fetchWithAuth, AuthRedirectError, ApiError } from '../api.js';

/**
 * Create a mock Response object matching the fetch() Response interface.
 */
function mockResponse({
  ok = true,
  status = 200,
  redirected = false,
  url = 'http://localhost/api/test',
  contentType = 'application/json',
  body = {},
} = {}) {
  return {
    ok,
    status,
    redirected,
    url,
    headers: {
      get: vi.fn((name) => {
        if (name === 'content-type') return contentType;
        return null;
      }),
    },
    json: vi.fn(async () => body),
    blob: vi.fn(async () => new Blob()),
    body: { getReader: vi.fn() },
  };
}

describe('AuthRedirectError', () => {
  it('has correct name and message', () => {
    const err = new AuthRedirectError('https://auth.example.com/login');
    expect(err.name).toBe('AuthRedirectError');
    expect(err.message).toBe('Session expired — authentication required');
    expect(err.redirectUrl).toBe('https://auth.example.com/login');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ApiError', () => {
  it('has correct name, message, and status', () => {
    const err = new ApiError('Not found', 404);
    expect(err.name).toBe('ApiError');
    expect(err.message).toBe('Not found');
    expect(err.status).toBe(404);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('fetchWithAuth', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns response on success', async () => {
    const resp = mockResponse();
    globalThis.fetch.mockResolvedValue(resp);

    const result = await fetchWithAuth('/api/test');
    expect(result).toBe(resp);
  });

  it('throws AuthRedirectError when response.redirected is true', async () => {
    const resp = mockResponse({
      redirected: true,
      url: 'https://auth.example.com/login',
    });
    globalThis.fetch.mockResolvedValue(resp);

    await expect(fetchWithAuth('/api/test')).rejects.toThrow(AuthRedirectError);
  });

  it('throws ApiError on non-ok response', async () => {
    const resp = mockResponse({ ok: false, status: 500 });
    globalThis.fetch.mockResolvedValue(resp);

    await expect(fetchWithAuth('/api/test', {}, 'Server error'))
      .rejects.toThrow(ApiError);
  });

  it('includes custom error message in ApiError', async () => {
    const resp = mockResponse({ ok: false, status: 403 });
    globalThis.fetch.mockResolvedValue(resp);

    try {
      await fetchWithAuth('/api/test', {}, 'Access denied');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.message).toBe('Access denied');
      expect(err.status).toBe(403);
    }
  });

  it('passes options through to fetch', async () => {
    const resp = mockResponse();
    globalThis.fetch.mockResolvedValue(resp);

    await fetchWithAuth('/api/test', { method: 'POST', headers: { 'X-Custom': '1' } });

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/test', {
      method: 'POST',
      headers: { 'X-Custom': '1' },
    });
  });
});

describe('fetchJSON', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns parsed JSON on success', async () => {
    const resp = mockResponse({ body: { result: 42 } });
    globalThis.fetch.mockResolvedValue(resp);

    const data = await fetchJSON('/api/test');
    expect(data).toEqual({ result: 42 });
  });

  it('throws AuthRedirectError on redirect', async () => {
    const resp = mockResponse({ redirected: true, url: 'https://login.example.com' });
    globalThis.fetch.mockResolvedValue(resp);

    await expect(fetchJSON('/api/test')).rejects.toThrow(AuthRedirectError);
  });

  it('throws ApiError on non-ok response', async () => {
    const resp = mockResponse({ ok: false, status: 404 });
    globalThis.fetch.mockResolvedValue(resp);

    await expect(fetchJSON('/api/test', {}, 'Not found')).rejects.toThrow(ApiError);
  });

  it('throws AuthRedirectError when content-type is text/html', async () => {
    const resp = mockResponse({ contentType: 'text/html; charset=utf-8' });
    globalThis.fetch.mockResolvedValue(resp);

    await expect(fetchJSON('/api/test')).rejects.toThrow(AuthRedirectError);
  });

  it('throws ApiError when content-type is unexpected (not JSON or HTML)', async () => {
    const resp = mockResponse({ contentType: 'text/plain' });
    globalThis.fetch.mockResolvedValue(resp);

    try {
      await fetchJSON('/api/test');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.message).toContain('text/plain');
    }
  });

  it('throws ApiError when content-type header is missing', async () => {
    const resp = mockResponse({ contentType: null });
    // Override the get method to return null
    resp.headers.get = vi.fn(() => null);
    globalThis.fetch.mockResolvedValue(resp);

    try {
      await fetchJSON('/api/test');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.message).toContain('unknown content type');
    }
  });

  it('accepts application/json with charset', async () => {
    const resp = mockResponse({
      contentType: 'application/json; charset=utf-8',
      body: { ok: true },
    });
    globalThis.fetch.mockResolvedValue(resp);

    const data = await fetchJSON('/api/test');
    expect(data).toEqual({ ok: true });
  });

  it('redirect check takes priority over content-type check', async () => {
    // A redirected response should throw AuthRedirectError even before checking content-type
    const resp = mockResponse({
      redirected: true,
      url: 'https://auth.example.com',
      contentType: 'text/html',
    });
    globalThis.fetch.mockResolvedValue(resp);

    try {
      await fetchJSON('/api/test');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthRedirectError);
      expect(err.redirectUrl).toBe('https://auth.example.com');
    }
  });
});
