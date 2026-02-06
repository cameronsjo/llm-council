import { describe, it, expect } from 'vitest';
import {
  MAJOR_PROVIDERS,
  formatPrice,
  getDisplayName,
  groupModelsByProvider,
  sortProviders,
  isMajorProvider,
  formatContextLength,
} from '../lib/models.js';

describe('formatPrice', () => {
  it('returns "Free" for 0', () => {
    expect(formatPrice(0)).toBe('Free');
  });

  it('returns "Free" for null', () => {
    expect(formatPrice(null)).toBe('Free');
  });

  it('returns "Free" for undefined', () => {
    expect(formatPrice(undefined)).toBe('Free');
  });

  it('returns "<$0.01/M" for very small prices', () => {
    // price * 1_000_000 < 0.01 => price < 1e-8
    expect(formatPrice(1e-9)).toBe('<$0.01/M');
    expect(formatPrice(5e-9)).toBe('<$0.01/M');
  });

  it('returns "$X.XX/M" for normal prices', () => {
    // price = 0.000001 => perMillion = 1.00
    expect(formatPrice(0.000001)).toBe('$1.00/M');
    // price = 0.000015 => perMillion = 15.00
    expect(formatPrice(0.000015)).toBe('$15.00/M');
    // price = 0.00000312 => perMillion = 3.12
    expect(formatPrice(0.00000312)).toBe('$3.12/M');
  });

  it('handles the boundary where perMillion equals exactly 0.01', () => {
    // price = 1e-8 => perMillion = 0.01
    expect(formatPrice(1e-8)).toBe('$0.01/M');
  });
});

describe('getDisplayName', () => {
  it('returns model.name if available', () => {
    expect(getDisplayName({ id: 'openai/gpt-4', name: 'GPT-4' })).toBe(
      'GPT-4'
    );
  });

  it('falls back to last segment of model.id (after /)', () => {
    expect(getDisplayName({ id: 'openai/gpt-4' })).toBe('gpt-4');
  });

  it('falls back to model.id if no /', () => {
    expect(getDisplayName({ id: 'gpt-4' })).toBe('gpt-4');
  });

  it('returns "Unknown" for empty object', () => {
    expect(getDisplayName({})).toBe('Unknown');
  });

  it('prefers name over id', () => {
    expect(
      getDisplayName({ id: 'anthropic/claude-3', name: 'Claude 3 Opus' })
    ).toBe('Claude 3 Opus');
  });

  it('handles model with empty string name (falsy)', () => {
    expect(getDisplayName({ id: 'openai/gpt-4', name: '' })).toBe('gpt-4');
  });
});

describe('groupModelsByProvider', () => {
  it('groups models by provider field', () => {
    const models = [
      { id: 'a', provider: 'openai' },
      { id: 'b', provider: 'anthropic' },
      { id: 'c', provider: 'openai' },
    ];
    const grouped = groupModelsByProvider(models);
    expect(grouped).toEqual({
      openai: [
        { id: 'a', provider: 'openai' },
        { id: 'c', provider: 'openai' },
      ],
      anthropic: [{ id: 'b', provider: 'anthropic' }],
    });
  });

  it('uses "Other" for models without provider', () => {
    const models = [{ id: 'x' }, { id: 'y', provider: 'google' }];
    const grouped = groupModelsByProvider(models);
    expect(grouped).toEqual({
      Other: [{ id: 'x' }],
      google: [{ id: 'y', provider: 'google' }],
    });
  });

  it('returns empty object for empty array', () => {
    expect(groupModelsByProvider([])).toEqual({});
  });
});

describe('sortProviders', () => {
  it('puts major providers before non-major providers', () => {
    const result = sortProviders(['zebra', 'openai', 'acme', 'anthropic']);
    // Major providers (anthropic, openai) come first, sorted alphabetically
    // Then non-major (acme, zebra) sorted alphabetically
    expect(result).toEqual(['anthropic', 'openai', 'acme', 'zebra']);
  });

  it('sorts major providers alphabetically among themselves', () => {
    const result = sortProviders(['openai', 'anthropic', 'google', 'deepseek']);
    expect(result).toEqual(['anthropic', 'deepseek', 'google', 'openai']);
  });

  it('sorts non-major providers alphabetically among themselves', () => {
    const result = sortProviders(['zebra', 'alpha', 'middle']);
    expect(result).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('handles case-insensitive comparison for major providers', () => {
    const result = sortProviders(['OpenAI', 'indie-corp']);
    // "OpenAI".toLowerCase() = "openai" which is in MAJOR_PROVIDERS
    expect(result).toEqual(['OpenAI', 'indie-corp']);
  });

  it('does not mutate the original array', () => {
    const original = ['openai', 'zebra', 'anthropic'];
    const copy = [...original];
    sortProviders(original);
    expect(original).toEqual(copy);
  });

  it('handles empty array', () => {
    expect(sortProviders([])).toEqual([]);
  });
});

describe('isMajorProvider', () => {
  it('returns true for major providers (lowercase)', () => {
    expect(isMajorProvider('anthropic')).toBe(true);
    expect(isMajorProvider('openai')).toBe(true);
    expect(isMajorProvider('google')).toBe(true);
    expect(isMajorProvider('meta-llama')).toBe(true);
    expect(isMajorProvider('mistralai')).toBe(true);
    expect(isMajorProvider('cohere')).toBe(true);
    expect(isMajorProvider('deepseek')).toBe(true);
    expect(isMajorProvider('x-ai')).toBe(true);
    expect(isMajorProvider('amazon')).toBe(true);
    expect(isMajorProvider('microsoft')).toBe(true);
  });

  it('returns true case-insensitively', () => {
    expect(isMajorProvider('Anthropic')).toBe(true);
    expect(isMajorProvider('OPENAI')).toBe(true);
    expect(isMajorProvider('Google')).toBe(true);
  });

  it('returns false for non-major providers', () => {
    expect(isMajorProvider('indie-llm')).toBe(false);
    expect(isMajorProvider('unknown')).toBe(false);
  });

  it('handles null gracefully', () => {
    expect(isMajorProvider(null)).toBe(false);
  });

  it('handles undefined gracefully', () => {
    expect(isMajorProvider(undefined)).toBe(false);
  });
});

describe('formatContextLength', () => {
  it('returns empty string for 0', () => {
    expect(formatContextLength(0)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(formatContextLength(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatContextLength(undefined)).toBe('');
  });

  it('returns "XK" format for standard values', () => {
    expect(formatContextLength(128000)).toBe('128K');
    expect(formatContextLength(32000)).toBe('32K');
    expect(formatContextLength(4096)).toBe('4K');
    expect(formatContextLength(200000)).toBe('200K');
  });

  it('rounds to nearest integer K', () => {
    // 4096 / 1000 = 4.096, Math.round => 4
    expect(formatContextLength(4096)).toBe('4K');
    // 8192 / 1000 = 8.192, Math.round => 8
    expect(formatContextLength(8192)).toBe('8K');
    // 16500 / 1000 = 16.5, Math.round => 17
    expect(formatContextLength(16500)).toBe('17K');
  });

  it('handles small values', () => {
    // 500 / 1000 = 0.5, Math.round => 1
    expect(formatContextLength(500)).toBe('1K');
    // 100 / 1000 = 0.1, Math.round => 0
    expect(formatContextLength(100)).toBe('0K');
  });
});

describe('MAJOR_PROVIDERS', () => {
  it('contains all expected providers', () => {
    const expected = [
      'anthropic',
      'openai',
      'google',
      'meta-llama',
      'mistralai',
      'cohere',
      'deepseek',
      'x-ai',
      'amazon',
      'microsoft',
    ];
    for (const provider of expected) {
      expect(MAJOR_PROVIDERS.has(provider)).toBe(true);
    }
    expect(MAJOR_PROVIDERS.size).toBe(expected.length);
  });
});
