import { describe, it, expect } from 'vitest';
import {
  convertCouncilToRounds,
  convertSynthesis,
  getParticipantMapping,
  getMessageText,
  canRetryMessage,
} from '../lib/messageUtils.js';

describe('convertCouncilToRounds', () => {
  it('returns empty array for message with no stages', () => {
    expect(convertCouncilToRounds({})).toEqual([]);
  });

  it('converts stage1 to responses round', () => {
    const msg = {
      stage1: [
        { model: 'openai/gpt-4', response: 'Hello', reasoning_details: null },
        { model: 'anthropic/claude', response: 'World', reasoning_details: 'thought' },
      ],
    };
    const rounds = convertCouncilToRounds(msg);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].round_type).toBe('responses');
    expect(rounds[0].round_number).toBe(1);
    expect(rounds[0].responses).toHaveLength(2);
    expect(rounds[0].responses[0].content).toBe('Hello');
    expect(rounds[0].responses[1].reasoning_details).toBe('thought');
  });

  it('converts both stage1 and stage2', () => {
    const msg = {
      stage1: [{ model: 'a', response: 'r', reasoning_details: null }],
      stage2: [
        {
          model: 'b',
          ranking: 'rank text',
          reasoning_details: null,
          parsed_ranking: ['Response A'],
        },
      ],
      metadata: {
        label_to_model: { 'Response A': 'a' },
        aggregate_rankings: [{ model: 'a', avg: 1 }],
      },
    };
    const rounds = convertCouncilToRounds(msg);
    expect(rounds).toHaveLength(2);
    expect(rounds[1].round_type).toBe('rankings');
    expect(rounds[1].responses[0].content).toBe('rank text');
    expect(rounds[1].metadata.label_to_model).toEqual({ 'Response A': 'a' });
  });
});

describe('convertSynthesis', () => {
  it('returns undefined for message with no synthesis', () => {
    expect(convertSynthesis({})).toBeUndefined();
  });

  it('converts stage3 format', () => {
    const msg = {
      stage3: { model: 'gpt-4', response: 'Final answer', reasoning_details: 'logic' },
    };
    const result = convertSynthesis(msg);
    expect(result.model).toBe('gpt-4');
    expect(result.content).toBe('Final answer');
    expect(result.reasoning_details).toBe('logic');
  });

  it('passes through unified synthesis format', () => {
    const synthesis = { model: 'claude', content: 'Answer' };
    const msg = { synthesis };
    expect(convertSynthesis(msg)).toBe(synthesis);
  });

  it('prefers stage3 over synthesis field', () => {
    const msg = {
      stage3: { model: 'gpt-4', response: 'From stage3', reasoning_details: null },
      synthesis: { model: 'claude', content: 'From synthesis' },
    };
    expect(convertSynthesis(msg).content).toBe('From stage3');
  });
});

describe('getParticipantMapping', () => {
  it('returns null for empty message', () => {
    expect(getParticipantMapping({})).toBeNull();
  });

  it('returns participant_mapping directly', () => {
    const mapping = { 'Participant A': 'gpt-4' };
    expect(getParticipantMapping({ participant_mapping: mapping })).toBe(mapping);
  });

  it('falls back to metadata.label_to_model', () => {
    const mapping = { 'Response A': 'gpt-4' };
    expect(getParticipantMapping({ metadata: { label_to_model: mapping } })).toBe(mapping);
  });

  it('searches rounds for metadata', () => {
    const mapping = { 'Response A': 'claude' };
    const msg = {
      rounds: [
        { round_type: 'responses', responses: [] },
        { round_type: 'rankings', metadata: { label_to_model: mapping } },
      ],
    };
    expect(getParticipantMapping(msg)).toBe(mapping);
  });

  it('prioritizes participant_mapping over metadata', () => {
    const direct = { A: 'model-a' };
    const meta = { B: 'model-b' };
    expect(
      getParticipantMapping({
        participant_mapping: direct,
        metadata: { label_to_model: meta },
      })
    ).toBe(direct);
  });
});

describe('getMessageText', () => {
  it('returns content for user messages', () => {
    expect(getMessageText({ role: 'user', content: 'Hello' })).toBe('Hello');
  });

  it('returns synthesis answer for arena messages', () => {
    expect(
      getMessageText({
        role: 'assistant',
        mode: 'arena',
        synthesis: { answer: 'Debate result' },
      })
    ).toBe('Debate result');
  });

  it('returns stage3 response for council messages', () => {
    expect(
      getMessageText({
        role: 'assistant',
        stage3: { response: 'Council synthesis' },
      })
    ).toBe('Council synthesis');
  });

  it('returns empty string for assistant without synthesis', () => {
    expect(getMessageText({ role: 'assistant' })).toBe('');
  });

  it('returns empty string when synthesis.answer is missing', () => {
    expect(
      getMessageText({ role: 'assistant', mode: 'arena', synthesis: {} })
    ).toBe('');
  });
});

describe('canRetryMessage', () => {
  it('returns false when messages is null', () => {
    expect(canRetryMessage(null, 0, false)).toBe(false);
  });

  it('returns false when loading', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant' },
    ];
    expect(canRetryMessage(messages, 1, true)).toBe(false);
  });

  it('returns false for non-last message', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant' },
      { role: 'user', content: 'followup' },
      { role: 'assistant' },
    ];
    expect(canRetryMessage(messages, 1, false)).toBe(false);
  });

  it('returns false for user messages', () => {
    const messages = [{ role: 'user', content: 'hi' }];
    expect(canRetryMessage(messages, 0, false)).toBe(false);
  });

  it('returns true for last assistant message when idle', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant' },
    ];
    expect(canRetryMessage(messages, 1, false)).toBe(true);
  });

  it('returns false when stage1 is loading', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', loading: { stage1: true } },
    ];
    expect(canRetryMessage(messages, 1, false)).toBe(false);
  });

  it('returns false when synthesis is loading', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', loading: { synthesis: true } },
    ];
    expect(canRetryMessage(messages, 1, false)).toBe(false);
  });
});
