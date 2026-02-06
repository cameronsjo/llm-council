import { describe, it, expect } from 'vitest';
import { conversationReducer } from '../hooks/conversationReducer';
import { convertSynthesis } from '../lib/messageUtils';

/**
 * Simulate a conversation loaded from backend storage where Stage 3 failed.
 * This is what the reducer state looks like when the user sees the retry button.
 */
function makeStoredConversationWithStage3Error() {
  return {
    id: 'conv-1',
    title: 'Test',
    messages: [
      { role: 'user', content: 'What is 2+2?' },
      {
        role: 'assistant',
        stage1: [
          { model: 'openai/gpt-4o', response: '4', reasoning_details: null },
        ],
        stage2: [
          { model: 'openai/gpt-4o', ranking: '1. Response A', parsed_ranking: ['Response A'] },
        ],
        stage3: {
          model: 'google/gemini-2.5-pro',
          response: 'Error: Unable to generate final synthesis.',
        },
        metadata: { label_to_model: { 'Response A': 'openai/gpt-4o' } },
        // NOTE: no `loading` field — this is loaded from storage, not streaming
      },
    ],
  };
}

describe('Retry Stage 3 — reducer flow', () => {
  it('stage3_start sets loading.stage3 on a stored message without loading field', () => {
    const state = makeStoredConversationWithStage3Error();
    const next = conversationReducer(state, { type: 'stage3_start', payload: {} });

    const lastMsg = next.messages[next.messages.length - 1];
    expect(lastMsg.loading.stage3).toBe(true);
    // Old error is cleared immediately so UI stops showing stale result
    expect(lastMsg.stage3).toBeNull();
  });

  it('stage3_complete replaces stage3 data with successful result', () => {
    const state = makeStoredConversationWithStage3Error();

    // Simulate stage3_start then stage3_complete
    const afterStart = conversationReducer(state, { type: 'stage3_start', payload: {} });
    const afterComplete = conversationReducer(afterStart, {
      type: 'stage3_complete',
      payload: {
        data: {
          model: 'google/gemini-2.5-pro',
          response: 'The answer is 4.',
        },
      },
    });

    const lastMsg = afterComplete.messages[afterComplete.messages.length - 1];
    expect(lastMsg.stage3.response).toBe('The answer is 4.');
    expect(lastMsg.loading.stage3).toBe(false);
  });

  it('convertSynthesis reads the updated stage3 after retry', () => {
    const state = makeStoredConversationWithStage3Error();
    const afterComplete = conversationReducer(state, {
      type: 'stage3_complete',
      payload: {
        data: {
          model: 'google/gemini-2.5-pro',
          response: 'The answer is 4.',
        },
      },
    });

    const lastMsg = afterComplete.messages[afterComplete.messages.length - 1];
    const synthesis = convertSynthesis(lastMsg);

    expect(synthesis.content).toBe('The answer is 4.');
    expect(synthesis.model).toBe('google/gemini-2.5-pro');
  });

  it('isSynthesisError becomes false after successful retry', () => {
    const state = makeStoredConversationWithStage3Error();

    // Before retry: error
    const beforeMsg = state.messages[state.messages.length - 1];
    const beforeSynthesis = convertSynthesis(beforeMsg);
    expect(beforeSynthesis.content.startsWith('Error:')).toBe(true);

    // After retry: success
    const afterComplete = conversationReducer(state, {
      type: 'stage3_complete',
      payload: {
        data: {
          model: 'google/gemini-2.5-pro',
          response: 'The answer is 4.',
        },
      },
    });
    const afterMsg = afterComplete.messages[afterComplete.messages.length - 1];
    const afterSynthesis = convertSynthesis(afterMsg);
    expect(afterSynthesis.content.startsWith('Error:')).toBe(false);
  });

  it('metrics_complete updates metrics on stored message', () => {
    const state = makeStoredConversationWithStage3Error();
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
    const state = makeStoredConversationWithStage3Error();

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

  it('stage3 field is preserved through unrelated reducer actions', () => {
    const state = makeStoredConversationWithStage3Error();

    // SET_LOADING shouldn't clobber stage3
    const afterLoading = conversationReducer(state, {
      type: 'SET_LOADING',
      payload: { isLoading: true },
    });
    const msg = afterLoading.messages[afterLoading.messages.length - 1];
    expect(msg.stage3.response).toBe('Error: Unable to generate final synthesis.');
  });
});
