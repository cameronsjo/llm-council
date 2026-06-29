import { describe, it, expect } from 'vitest';
import { SEAT_COUNT, hashString, seatTokens, rawSeat, assignSeats } from '../lib/seatColors.js';

describe('hashString', () => {
  it('is deterministic', () => {
    expect(hashString('openai/gpt-5.1')).toBe(hashString('openai/gpt-5.1'));
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const id of ['a', 'openai/gpt-4o', 'anthropic/claude-sonnet-4', '']) {
      const h = hashString(id);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('distinguishes different ids', () => {
    expect(hashString('alpha')).not.toBe(hashString('beta'));
  });
});

describe('seatTokens', () => {
  it('builds the CSS var bundle for a seat number', () => {
    expect(seatTokens(3)).toEqual({
      seat: 3,
      color: 'var(--seat-3)',
      soft: 'var(--seat-3-soft)',
    });
  });
});

describe('rawSeat', () => {
  it('is a stable 1..SEAT_COUNT index for an id, independent of any roster', () => {
    const s = rawSeat('meta/llama-3.3-70b');
    expect(s).toBe(rawSeat('meta/llama-3.3-70b'));
    expect(s).toBeGreaterThanOrEqual(1);
    expect(s).toBeLessThanOrEqual(SEAT_COUNT);
  });
});

describe('assignSeats', () => {
  const council = [
    'openai/gpt-4o',
    'anthropic/claude-sonnet-4',
    'google/gemini-2.5-pro',
    'meta/llama-3.3-70b',
    'x-ai/grok-2',
  ];

  it('returns a Map keyed by model id with seat token bundles', () => {
    const map = assignSeats(council);
    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(council.length);
    for (const id of council) {
      const t = map.get(id);
      expect(t.seat).toBeGreaterThanOrEqual(1);
      expect(t.seat).toBeLessThanOrEqual(SEAT_COUNT);
      expect(t.color).toBe(`var(--seat-${t.seat})`);
      expect(t.soft).toBe(`var(--seat-${t.seat}-soft)`);
    }
  });

  it('is deterministic for the same roster', () => {
    expect([...assignSeats(council)]).toEqual([...assignSeats(council)]);
  });

  it('is stable across council reordering (set-based, not order-based)', () => {
    const reversed = [...council].reverse();
    const a = assignSeats(council);
    const b = assignSeats(reversed);
    for (const id of council) {
      expect(b.get(id)).toEqual(a.get(id));
    }
  });

  it('keeps a council of <=5 visually distinct (no shared seats)', () => {
    const map = assignSeats(council);
    const seats = [...map.values()].map((t) => t.seat);
    expect(new Set(seats).size).toBe(council.length);
  });

  it('allows repeats once every seat is in use (>5 models)', () => {
    const big = [...council, 'mistralai/mistral-large', 'cohere/command-r'];
    const map = assignSeats(big);
    expect(map.size).toBe(big.length);
    const seats = [...map.values()].map((t) => t.seat);
    // 7 models into 5 seats -> some seat is necessarily reused.
    expect(new Set(seats).size).toBe(SEAT_COUNT);
    for (const s of seats) {
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(SEAT_COUNT);
    }
  });

  it('dedupes repeated ids and tolerates null/undefined entries', () => {
    const map = assignSeats(['a', 'a', null, undefined, 'b']);
    expect(map.size).toBe(2);
    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(true);
  });

  it('returns an empty map for empty or non-array input', () => {
    expect(assignSeats([]).size).toBe(0);
    expect(assignSeats(undefined).size).toBe(0);
    expect(assignSeats(null).size).toBe(0);
  });
});
