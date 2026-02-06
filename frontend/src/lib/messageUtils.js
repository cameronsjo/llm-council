/**
 * Pure utility functions for message data transformation and validation.
 * Extracted from ChatInterface for testability.
 */

/**
 * Convert legacy Council stage data to unified rounds format.
 * @param {object} msg - Assistant message with stage1/stage2 fields
 * @returns {Array} Array of round objects
 */
export function convertCouncilToRounds(msg) {
  const rounds = [];

  if (msg.stage1) {
    rounds.push({
      round_number: 1,
      round_type: 'responses',
      responses: msg.stage1.map((r) => ({
        model: r.model,
        content: r.response,
        reasoning_details: r.reasoning_details,
      })),
    });
  }

  if (msg.stage2) {
    rounds.push({
      round_number: 2,
      round_type: 'rankings',
      responses: msg.stage2.map((r) => ({
        model: r.model,
        content: r.ranking,
        reasoning_details: r.reasoning_details,
        parsed_ranking: r.parsed_ranking,
      })),
      metadata: {
        label_to_model: msg.metadata?.label_to_model,
        aggregate_rankings: msg.metadata?.aggregate_rankings,
      },
    });
  }

  return rounds;
}

/**
 * Convert legacy synthesis format to unified format.
 * @param {object} msg - Assistant message with stage3 or synthesis field
 * @returns {object|undefined} Synthesis object or undefined
 */
export function convertSynthesis(msg) {
  if (msg.stage3) {
    return {
      model: msg.stage3.model,
      content: msg.stage3.response,
      reasoning_details: msg.stage3.reasoning_details,
    };
  }
  return msg.synthesis;
}

/**
 * Get participant mapping for de-anonymization from any message format.
 * @param {object} msg - Assistant message
 * @returns {object|null} Label-to-model mapping or null
 */
export function getParticipantMapping(msg) {
  if (msg.participant_mapping) {
    return msg.participant_mapping;
  }
  if (msg.metadata?.label_to_model) {
    return msg.metadata.label_to_model;
  }
  if (msg.rounds) {
    for (const round of msg.rounds) {
      if (round.metadata?.label_to_model) {
        return round.metadata.label_to_model;
      }
    }
  }
  return null;
}

/**
 * Extract copyable text from a message.
 * For user messages returns content, for assistant messages returns the final synthesis.
 * @param {object} msg - Message object
 * @returns {string} Copyable text
 */
export function getMessageText(msg) {
  if (msg.role === 'user') {
    return msg.content;
  }
  if (msg.mode === 'arena' && msg.synthesis) {
    return msg.synthesis.answer || '';
  }
  if (msg.stage3) {
    return msg.stage3.response || '';
  }
  return '';
}

/**
 * Check if a message at a given index can be retried.
 * @param {Array} messages - Conversation messages array
 * @param {number} index - Message index
 * @param {boolean} isLoading - Whether a request is in progress
 * @returns {boolean}
 */
export function canRetryMessage(messages, index, isLoading) {
  if (!messages || isLoading) return false;
  const msg = messages[index];
  return (
    index === messages.length - 1 &&
    msg.role === 'assistant' &&
    !msg.loading?.stage1 &&
    !msg.loading?.stage2 &&
    !msg.loading?.stage3 &&
    !msg.loading?.round &&
    !msg.loading?.synthesis
  );
}
