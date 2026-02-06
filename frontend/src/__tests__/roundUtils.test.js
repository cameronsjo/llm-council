import { describe, it, expect } from 'vitest';
import {
  deAnonymizeText,
  getResponseContent,
  getTabLabel,
  getModelDisplayName,
  getRoundCost,
} from '../lib/roundUtils';

// ---------------------------------------------------------------------------
// deAnonymizeText
// ---------------------------------------------------------------------------

describe('deAnonymizeText', () => {
  it('replaces labels with bolded model short names', () => {
    const mapping = {
      'Response A': 'openai/gpt-4',
      'Response B': 'anthropic/claude-3',
    };
    const text = 'Response A is better than Response B.';
    expect(deAnonymizeText(text, mapping)).toBe(
      '**gpt-4** is better than **claude-3**.'
    );
  });

  it('returns text unchanged when mapping is null', () => {
    expect(deAnonymizeText('Response A is great', null)).toBe('Response A is great');
  });

  it('returns text unchanged when mapping is empty', () => {
    expect(deAnonymizeText('Response A is great', {})).toBe('Response A is great');
  });

  it('handles model names without provider prefix', () => {
    const mapping = { 'Response A': 'local-model' };
    expect(deAnonymizeText('Response A rocks', mapping)).toBe('**local-model** rocks');
  });

  it('replaces all occurrences of the same label', () => {
    const mapping = { 'Response A': 'openai/gpt-4' };
    expect(deAnonymizeText('Response A beats Response A', mapping)).toBe(
      '**gpt-4** beats **gpt-4**'
    );
  });
});

// ---------------------------------------------------------------------------
// getResponseContent
// ---------------------------------------------------------------------------

describe('getResponseContent', () => {
  it('returns content from unified format', () => {
    expect(getResponseContent({ content: 'Hello' })).toBe('Hello');
  });

  it('returns response from legacy format', () => {
    expect(getResponseContent({ response: 'Legacy' })).toBe('Legacy');
  });

  it('returns ranking from ranking format', () => {
    expect(getResponseContent({ ranking: 'Rank text' })).toBe('Rank text');
  });

  it('prefers content over response', () => {
    expect(getResponseContent({ content: 'A', response: 'B' })).toBe('A');
  });

  it('returns empty string when no content fields', () => {
    expect(getResponseContent({ model: 'test' })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// getTabLabel
// ---------------------------------------------------------------------------

describe('getTabLabel', () => {
  it('returns participant for arena rounds', () => {
    const resp = { participant: 'Participant A', model: 'openai/gpt-4' };
    expect(getTabLabel(resp, true)).toBe('Participant A');
  });

  it('returns model short name for council rounds', () => {
    const resp = { model: 'openai/gpt-4' };
    expect(getTabLabel(resp, false)).toBe('gpt-4');
  });

  it('returns full model name when no slash', () => {
    const resp = { model: 'local-model' };
    expect(getTabLabel(resp, false)).toBe('local-model');
  });

  it('falls back to participant when model is undefined', () => {
    const resp = { participant: 'Participant B' };
    expect(getTabLabel(resp, false)).toBe('Participant B');
  });
});

// ---------------------------------------------------------------------------
// getModelDisplayName
// ---------------------------------------------------------------------------

describe('getModelDisplayName', () => {
  it('resolves participant mapping to full model name', () => {
    const resp = { participant: 'Response A', model: 'fallback' };
    const mapping = { 'Response A': 'openai/gpt-4' };
    expect(getModelDisplayName(resp, mapping)).toBe('openai/gpt-4');
  });

  it('falls back to resp.model when participant not in mapping', () => {
    const resp = { participant: 'Response Z', model: 'openai/gpt-4' };
    const mapping = { 'Response A': 'other/model' };
    expect(getModelDisplayName(resp, mapping)).toBe('openai/gpt-4');
  });

  it('returns resp.model when no mapping', () => {
    const resp = { model: 'openai/gpt-4' };
    expect(getModelDisplayName(resp, null)).toBe('openai/gpt-4');
  });

  it('returns resp.model when resp has no participant', () => {
    const resp = { model: 'openai/gpt-4' };
    const mapping = { 'Response A': 'other/model' };
    expect(getModelDisplayName(resp, mapping)).toBe('openai/gpt-4');
  });
});

// ---------------------------------------------------------------------------
// getRoundCost
// ---------------------------------------------------------------------------

describe('getRoundCost', () => {
  it('returns metrics.cost when available', () => {
    expect(getRoundCost({ metrics: { cost: 0.05 }, responses: [] })).toBe(0.05);
  });

  it('returns metrics.total_cost when cost is missing', () => {
    expect(getRoundCost({ metrics: { total_cost: 0.1 }, responses: [] })).toBe(0.1);
  });

  it('sums individual response costs when no round-level metrics', () => {
    const round = {
      responses: [
        { metrics: { cost: 0.01 } },
        { metrics: { cost: 0.02 } },
        { metrics: { cost: 0.03 } },
      ],
    };
    expect(getRoundCost(round)).toBeCloseTo(0.06);
  });

  it('returns 0 when no metrics anywhere', () => {
    const round = { responses: [{ model: 'test' }, { model: 'test2' }] };
    expect(getRoundCost(round)).toBe(0);
  });

  it('handles missing responses array', () => {
    expect(getRoundCost({ metrics: {} })).toBe(0);
  });
});
