import { describe, it, expect } from 'vitest';
import {
  formatCost,
  formatCostAlways,
  formatLatency,
  formatTokens,
  getReasoningText,
} from '../lib/formatting.js';

describe('formatCost', () => {
  it('returns null for null', () => {
    expect(formatCost(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(formatCost(undefined)).toBeNull();
  });

  it('returns null for 0 (falsy)', () => {
    expect(formatCost(0)).toBeNull();
  });

  it('returns 4 decimal places for costs < 0.01', () => {
    expect(formatCost(0.005)).toBe('$0.0050');
    expect(formatCost(0.001234)).toBe('$0.0012');
    expect(formatCost(0.0099)).toBe('$0.0099');
  });

  it('returns 2 decimal places for costs >= 0.01', () => {
    expect(formatCost(0.01)).toBe('$0.01');
    expect(formatCost(0.5)).toBe('$0.50');
    expect(formatCost(1.234)).toBe('$1.23');
    expect(formatCost(99.999)).toBe('$100.00');
  });
});

describe('formatCostAlways', () => {
  it('returns "$0.00" for exactly 0', () => {
    expect(formatCostAlways(0)).toBe('$0.00');
  });

  it('returns 4 decimal places for costs < 0.01 (but not 0)', () => {
    expect(formatCostAlways(0.005)).toBe('$0.0050');
    expect(formatCostAlways(0.001234)).toBe('$0.0012');
  });

  it('returns 2 decimal places for costs >= 0.01', () => {
    expect(formatCostAlways(0.01)).toBe('$0.01');
    expect(formatCostAlways(0.5)).toBe('$0.50');
    expect(formatCostAlways(1.234)).toBe('$1.23');
  });

  it('always returns a string, never null', () => {
    expect(typeof formatCostAlways(0)).toBe('string');
    expect(typeof formatCostAlways(0.001)).toBe('string');
    expect(typeof formatCostAlways(1.5)).toBe('string');
  });
});

describe('formatLatency', () => {
  it('returns milliseconds for values < 1000', () => {
    expect(formatLatency(0)).toBe('0ms');
    expect(formatLatency(1)).toBe('1ms');
    expect(formatLatency(500)).toBe('500ms');
    expect(formatLatency(999)).toBe('999ms');
  });

  it('returns seconds with one decimal for values >= 1000', () => {
    expect(formatLatency(1500)).toBe('1.5s');
    expect(formatLatency(2000)).toBe('2.0s');
    expect(formatLatency(12345)).toBe('12.3s');
  });

  it('returns "1.0s" for exactly 1000', () => {
    expect(formatLatency(1000)).toBe('1.0s');
  });
});

describe('formatTokens', () => {
  it('returns "X.Xk" for values >= 1000', () => {
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(2000)).toBe('2.0k');
    expect(formatTokens(12345)).toBe('12.3k');
  });

  it('returns "1.0k" for exactly 1000', () => {
    expect(formatTokens(1000)).toBe('1.0k');
  });

  it('returns plain number string for values < 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1)).toBe('1');
    expect(formatTokens(999)).toBe('999');
  });
});

describe('getReasoningText', () => {
  it('returns null for null', () => {
    expect(getReasoningText(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(getReasoningText(undefined)).toBeNull();
  });

  it('returns null for empty string (falsy)', () => {
    expect(getReasoningText('')).toBeNull();
  });

  it('returns null for 0 (falsy)', () => {
    expect(getReasoningText(0)).toBeNull();
  });

  it('returns the string directly for string input', () => {
    expect(getReasoningText('some reasoning')).toBe('some reasoning');
  });

  it('handles array of strings (joins with double newline)', () => {
    expect(getReasoningText(['first', 'second', 'third'])).toBe(
      'first\n\nsecond\n\nthird'
    );
  });

  it('returns empty string for empty array', () => {
    expect(getReasoningText([])).toBe('');
  });

  it('handles array of objects with .summary field', () => {
    const input = [{ summary: 'summary A' }, { summary: 'summary B' }];
    expect(getReasoningText(input)).toBe('summary A\n\nsummary B');
  });

  it('handles array of objects with .content field', () => {
    const input = [{ content: 'content A' }, { content: 'content B' }];
    expect(getReasoningText(input)).toBe('content A\n\ncontent B');
  });

  it('prefers .summary over .content in array items', () => {
    const input = [{ summary: 'the summary', content: 'the content' }];
    expect(getReasoningText(input)).toBe('the summary');
  });

  it('handles mixed array (strings + objects)', () => {
    const input = ['raw text', { summary: 'summarized' }, { content: 'body' }];
    expect(getReasoningText(input)).toBe('raw text\n\nsummarized\n\nbody');
  });

  it('filters out null items from array (objects without summary or content)', () => {
    const input = ['valid', { other: 'field' }, { summary: 'ok' }];
    expect(getReasoningText(input)).toBe('valid\n\nok');
  });

  it('handles single object with .summary', () => {
    expect(getReasoningText({ summary: 'the summary' })).toBe('the summary');
  });

  it('handles single object with .content', () => {
    expect(getReasoningText({ content: 'the content' })).toBe('the content');
  });

  it('prefers .summary over .content for single object', () => {
    expect(
      getReasoningText({ summary: 'the summary', content: 'the content' })
    ).toBe('the summary');
  });

  it('returns null for object without summary or content', () => {
    expect(getReasoningText({ other: 'value' })).toBeNull();
  });
});
