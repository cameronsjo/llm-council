import { describe, it, expect } from 'vitest';
import { conversationReducer } from '../hooks/conversationReducer';

/**
 * Simulate a conversation loaded from backend storage where synthesis failed.
 * Uses unified rounds/synthesis format (what the reducer now produces).
 */
function makeStoredConversationWithSynthesisError() {
  return {
    id: 'conv-1',
    title: 'Test',
    messages: [
      { role: 'user', content: 'What is 2+2?' },
      {
        role: 'assistant',
        rounds: [
          {
            round_type: 'responses',
            round_number: 1,
            responses: [
              { participant: 'Response A', model: 'openai/gpt-4o', content: '4', reasoning_details: null },
            ],
          },
          {
            round_type: 'rankings',
            round_number: 2,
            responses: [
              { participant: 'openai/gpt-4o', model: 'openai/gpt-4o', content: '1. Response A', parsed_ranking: ['Response A'] },
            ],
            metadata: { label_to_model: { 'Response A': 'openai/gpt-4o' } },
          },
        ],
        synthesis: {
          model: 'google/gemini-2.5-pro',
          content: 'Error: Unable to generate final synthesis.',
        },
        participant_mapping: { 'Response A': 'openai/gpt-4o' },
        // NOTE: no `loading` field — this is loaded from storage, not streaming
      },
    ],
  };
}

describe('Retry Synthesis — reducer flow', () => {
  it('synthesis_start sets loading.synthesis on a stored message without loading field', () => {
    const state = makeStoredConversationWithSynthesisError();
    const next = conversationReducer(state, { type: 'synthesis_start', payload: {} });

    const lastMsg = next.messages[next.messages.length - 1];
    expect(lastMsg.loading.synthesis).toBe(true);
    // Old error is cleared immediately so UI stops showing stale result
    expect(lastMsg.synthesis).toBeNull();
  });

  it('synthesis_complete replaces synthesis data with successful result', () => {
    const state = makeStoredConversationWithSynthesisError();

    // Simulate synthesis_start then synthesis_complete
    const afterStart = conversationReducer(state, { type: 'synthesis_start', payload: {} });
    const afterComplete = conversationReducer(afterStart, {
      type: 'synthesis_complete',
      payload: {
        data: {
          model: 'google/gemini-2.5-pro',
          content: 'The answer is 4.',
        },
      },
    });

    const lastMsg = afterComplete.messages[afterComplete.messages.length - 1];
    expect(lastMsg.synthesis.content).toBe('The answer is 4.');
    expect(lastMsg.loading.synthesis).toBe(false);
  });

  it('synthesis content is accessible after retry', () => {
    const state = makeStoredConversationWithSynthesisError();
    const afterComplete = conversationReducer(state, {
      type: 'synthesis_complete',
      payload: {
        data: {
          model: 'google/gemini-2.5-pro',
          content: 'The answer is 4.',
        },
      },
    });

    const lastMsg = afterComplete.messages[afterComplete.messages.length - 1];
    expect(lastMsg.synthesis.content).toBe('The answer is 4.');
    expect(lastMsg.synthesis.model).toBe('google/gemini-2.5-pro');
  });

  it('synthesis error becomes false after successful retry', () => {
    const state = makeStoredConversationWithSynthesisError();

    // Before retry: error
    const beforeMsg = state.messages[state.messages.length - 1];
    expect(beforeMsg.synthesis.content.startsWith('Error:')).toBe(true);

    // After retry: success
    const afterComplete = conversationReducer(state, {
      type: 'synthesis_complete',
      payload: {
        data: {
          model: 'google/gemini-2.5-pro',
          content: 'The answer is 4.',
        },
      },
    });
    const afterMsg = afterComplete.messages[afterComplete.messages.length - 1];
    expect(afterMsg.synthesis.content.startsWith('Error:')).toBe(false);
  });

  it('metrics_complete updates metrics on stored message', () => {
    const state = makeStoredConversationWithSynthesisError();
    const afterMetrics = conversationReducer(state, {
      type: 'metrics_complete',
      payload: {
        data: { total_tokens: 500, total_cost: 0.01 },
      },
    });

    const lastMsg = afterMetrics.messages[afterMetrics.messages.length - 1];
    expect(lastMsg.metrics.total_cost).toBe(0.01);
  });

  it('SET_LOADING sets _isLoading on conversation state', () => {
    const state = makeStoredConversationWithSynthesisError();

    const loading = conversationReducer(state, {
      type: 'SET_LOADING',
      payload: { isLoading: true },
    });
    expect(loading._isLoading).toBe(true);

    const notLoading = conversationReducer(loading, {
      type: 'SET_LOADING',
      payload: { isLoading: false },
    });
    expect(notLoading._isLoading).toBe(false);
  });

  it('synthesis field is preserved through unrelated reducer actions', () => {
    const state = makeStoredConversationWithSynthesisError();

    // SET_LOADING shouldn't clobber synthesis
    const afterLoading = conversationReducer(state, {
      type: 'SET_LOADING',
      payload: { isLoading: true },
    });
    const msg = afterLoading.messages[afterLoading.messages.length - 1];
    expect(msg.synthesis.content).toBe('Error: Unable to generate final synthesis.');
  });
});
