import { describe, it, expect } from 'vitest';
import { conversationReducer, buildAssistantMessage } from '../hooks/conversationReducer';

function makeConversationWithAssistant() {
  return {
    id: 'conv-1',
    title: 'Test',
    messages: [
      { role: 'user', content: 'Hello' },
      buildAssistantMessage('council'),
    ],
  };
}

describe('Model errors — reducer', () => {
  it('buildAssistantMessage includes empty errors array', () => {
    const msg = buildAssistantMessage('council');
    expect(msg.errors).toEqual([]);
  });

  it('model_error appends error to lastMsg.errors', () => {
    const state = makeConversationWithAssistant();
    const error = { model: 'openai/gpt-4o', status_code: 402, category: 'billing', message: 'Insufficient credits' };

    const next = conversationReducer(state, {
      type: 'model_error',
      payload: { data: error },
    });

    const lastMsg = next.messages[next.messages.length - 1];
    expect(lastMsg.errors).toHaveLength(1);
    expect(lastMsg.errors[0].category).toBe('billing');
  });

  it('model_error works on stored message without errors field', () => {
    const state = {
      id: 'conv-1',
      title: 'Test',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', rounds: [], synthesis: null },
      ],
    };
    const error = { model: 'm', status_code: 429, category: 'rate_limit', message: 'slow' };

    const next = conversationReducer(state, {
      type: 'model_error',
      payload: { data: error },
    });

    const lastMsg = next.messages[next.messages.length - 1];
    expect(lastMsg.errors).toHaveLength(1);
    expect(lastMsg.errors[0].category).toBe('rate_limit');
  });

  it('round_complete merges errors from responses round payload', () => {
    const state = makeConversationWithAssistant();
    const errors = [
      { model: 'model-a', status_code: 402, category: 'billing', message: 'No credits' },
      { model: 'model-b', status_code: 503, category: 'transient', message: 'Service unavailable' },
    ];

    const next = conversationReducer(state, {
      type: 'round_complete',
      payload: {
        data: {
          round_type: 'responses',
          responses: [{ model: 'model-c', response: 'ok' }],
          errors,
        },
      },
    });

    const lastMsg = next.messages[next.messages.length - 1];
    expect(lastMsg.errors).toHaveLength(2);
    expect(lastMsg.rounds).toHaveLength(1);
  });

  it('round_complete without errors does not add to errors array', () => {
    const state = makeConversationWithAssistant();
    const next = conversationReducer(state, {
      type: 'round_complete',
      payload: {
        data: {
          round_type: 'responses',
          responses: [{ model: 'model-a', response: 'ok' }],
        },
      },
    });

    const lastMsg = next.messages[next.messages.length - 1];
    expect(lastMsg.errors).toEqual([]);
  });

  it('round_complete merges errors from rankings round payload', () => {
    const state = makeConversationWithAssistant();
    const rankingsErrors = [
      { model: 'model-a', status_code: 429, category: 'rate_limit', message: 'Rate limited' },
    ];

    const next = conversationReducer(state, {
      type: 'round_complete',
      payload: {
        data: {
          round_type: 'rankings',
          responses: [],
          metadata: { label_to_model: {} },
          errors: rankingsErrors,
        },
      },
    });

    const lastMsg = next.messages[next.messages.length - 1];
    expect(lastMsg.errors).toHaveLength(1);
    expect(lastMsg.errors[0].category).toBe('rate_limit');
  });

  it('errors accumulate across model_error and round_complete', () => {
    let state = makeConversationWithAssistant();

    // First: individual error during streaming
    state = conversationReducer(state, {
      type: 'model_error',
      payload: { data: { model: 'a', status_code: 402, category: 'billing', message: 'x' } },
    });

    // Then: round_complete with additional errors
    state = conversationReducer(state, {
      type: 'round_complete',
      payload: {
        data: {
          round_type: 'responses',
          responses: [{ model: 'c', response: 'ok' }],
          errors: [{ model: 'b', status_code: 503, category: 'transient', message: 'y' }],
        },
      },
    });

    const lastMsg = state.messages[state.messages.length - 1];
    expect(lastMsg.errors).toHaveLength(2);
    expect(lastMsg.errors[0].model).toBe('a');
    expect(lastMsg.errors[1].model).toBe('b');
  });
});
