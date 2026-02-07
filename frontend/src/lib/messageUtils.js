/**
 * Pure utility functions for message data transformation and validation.
 * Extracted from ChatInterface for testability.
 */

/**
 * Get participant mapping for de-anonymization from any message format.
 * @param {object} msg - Assistant message
 * @returns {object|null} Label-to-model mapping or null
 */
export function getParticipantMapping(msg) {
  if (msg.participant_mapping) {
    return msg.participant_mapping;
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
  if (msg.synthesis) {
    // Arena uses .answer, council uses .response or .content
    return msg.synthesis.answer || msg.synthesis.response || msg.synthesis.content || '';
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
    !msg.loading?.round &&
    !msg.loading?.synthesis
  );
}
