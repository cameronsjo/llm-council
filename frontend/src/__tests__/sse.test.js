import { describe, it, expect, vi } from 'vitest';
import { readSSEStream } from '../api.js';

/**
 * Create a mock ReadableStreamDefaultReader from an array of string chunks.
 * Simulates how fetch().body.getReader() delivers data in arbitrary chunks.
 */
function mockReader(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    read: vi.fn(async () => {
      if (i >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: encoder.encode(chunks[i++]) };
    }),
  };
}

describe('readSSEStream', () => {
  it('parses a single complete SSE event', async () => {
    const events = [];
    const reader = mockReader([
      'data: {"type":"stage1_start","data":{}}\n\n',
    ]);

    await readSSEStream(reader, (type, event) => events.push({ type, event }));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stage1_start');
  });

  it('parses multiple events in one chunk', async () => {
    const events = [];
    const reader = mockReader([
      'data: {"type":"stage1_start"}\n\ndata: {"type":"stage1_complete"}\n\n',
    ]);

    await readSSEStream(reader, (type, event) => events.push({ type, event }));

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('stage1_start');
    expect(events[1].type).toBe('stage1_complete');
  });

  it('handles event split across two chunks', async () => {
    const events = [];
    // JSON split mid-object between two reader.read() calls
    const reader = mockReader([
      'data: {"type":"stage1_st',
      'art","data":{"models":["a"]}}\n\n',
    ]);

    await readSSEStream(reader, (type, event) => events.push({ type, event }));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stage1_start');
    expect(events[0].event.data.models).toEqual(['a']);
  });

  it('handles chunk boundary splitting \\n\\n delimiter', async () => {
    const events = [];
    // First chunk ends with first \n of the \n\n delimiter
    const reader = mockReader([
      'data: {"type":"a"}\n',
      '\ndata: {"type":"b"}\n\n',
    ]);

    await readSSEStream(reader, (type, event) => events.push({ type, event }));

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('a');
    expect(events[1].type).toBe('b');
  });

  it('ignores non-data SSE lines (comments, event, id)', async () => {
    const events = [];
    const reader = mockReader([
      ': this is a comment\nevent: message\ndata: {"type":"ok"}\n\n',
    ]);

    await readSSEStream(reader, (type, event) => events.push({ type, event }));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ok');
  });

  it('handles malformed JSON gracefully without crashing', async () => {
    const events = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const reader = mockReader([
      'data: {not json}\n\ndata: {"type":"valid"}\n\n',
    ]);

    await readSSEStream(reader, (type, event) => events.push({ type, event }));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('valid');
    expect(consoleError).toHaveBeenCalledOnce();

    consoleError.mockRestore();
  });

  it('respects abort signal', async () => {
    const events = [];
    const controller = new AbortController();

    const reader = mockReader([
      'data: {"type":"first"}\n\n',
      'data: {"type":"second"}\n\n',
    ]);

    // Abort after first read
    const originalRead = reader.read;
    let readCount = 0;
    reader.read = async () => {
      const result = await originalRead();
      readCount++;
      if (readCount === 1) controller.abort();
      return result;
    };

    await readSSEStream(reader, (type, event) => events.push({ type, event }), controller.signal);

    // Should have parsed the first event but stopped before second read
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('first');
  });

  it('flushes trailing buffered event without \\n\\n terminator', async () => {
    const events = [];
    const reader = mockReader([
      'data: {"type":"a"}\n\ndata: {"type":"trailing"}',
    ]);

    await readSSEStream(reader, (type, event) => events.push({ type, event }));

    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('trailing');
  });

  it('handles many small chunks splitting a single event', async () => {
    const events = [];
    const json = '{"type":"fragmented","data":{"key":"value"}}';
    // Split into individual characters
    const chunks = [];
    chunks.push('data: ');
    for (const char of json) chunks.push(char);
    chunks.push('\n\n');

    const reader = mockReader(chunks);
    await readSSEStream(reader, (type, event) => events.push({ type, event }));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('fragmented');
    expect(events[0].event.data.key).toBe('value');
  });

  it('handles empty chunks between events', async () => {
    const events = [];
    const reader = mockReader([
      'data: {"type":"a"}\n\n',
      '',
      '',
      'data: {"type":"b"}\n\n',
    ]);

    await readSSEStream(reader, (type, event) => events.push({ type, event }));

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('a');
    expect(events[1].type).toBe('b');
  });
});
