import { describe, it, expect } from 'vitest';
import {
  getParticipantMapping,
  getMessageText,
  canRetryMessage,
} from '../lib/messageUtils.js';

describe('getParticipantMapping', () => {
  it('returns null for empty message', () => {
    expect(getParticipantMapping({})).toBeNull();
  });

  it('returns participant_mapping directly', () => {
    const mapping = { 'Participant A': 'gpt-4' };
    expect(getParticipantMapping({ participant_mapping: mapping })).toBe(mapping);
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

  it('prioritizes participant_mapping over rounds metadata', () => {
    const direct = { A: 'model-a' };
    const meta = { B: 'model-b' };
    expect(
      getParticipantMapping({
        participant_mapping: direct,
        rounds: [{ round_type: 'rankings', metadata: { label_to_model: meta } }],
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

  it('returns synthesis content for council messages', () => {
    expect(
      getMessageText({
        role: 'assistant',
        synthesis: { content: 'Council synthesis' },
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

  it('returns false when round is loading', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', loading: { round: true } },
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
