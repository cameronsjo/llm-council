/**
 * Pure utility functions for Round component logic.
 * Extracted from Round.jsx for testability.
 */

/**
 * De-anonymize text by replacing anonymous labels with bolded model names.
 * @param {string} text - Text containing anonymous labels (e.g., "Response A")
 * @param {Object|null} participantMapping - Map of label to model name
 * @returns {string} Text with labels replaced by **modelShortName**
 */
export function deAnonymizeText(text, participantMapping) {
  if (!participantMapping) return text;

  let result = text;
  Object.entries(participantMapping).forEach(([label, model]) => {
    const modelShortName = model.split('/')[1] || model;
    result = result.replace(new RegExp(label, 'g'), `**${modelShortName}**`);
  });
  return result;
}

/**
 * Extract display content from a response object (handles unified and legacy formats).
 * @param {Object} resp - Response object
 * @returns {string} Content string
 */
export function getResponseContent(resp) {
  return resp.content || resp.response || resp.ranking || '';
}

/**
 * Get the tab label for a response (participant for arena, model short name for council).
 * @param {Object} resp - Response object with model and/or participant
 * @param {boolean} isArenaRound - Whether this is an arena round
 * @returns {string} Display label for the tab
 */
export function getTabLabel(resp, isArenaRound) {
  if (isArenaRound) {
    return resp.participant;
  }
  return resp.model?.split('/')[1] || resp.model || resp.participant;
}

/**
 * Get the full model display name for a response, resolving participant mapping.
 * @param {Object} resp - Response object
 * @param {Object|null} participantMapping - Participant label to model mapping
 * @returns {string} Model display name
 */
export function getModelDisplayName(resp, participantMapping) {
  if (participantMapping && resp.participant) {
    return participantMapping[resp.participant] || resp.model;
  }
  return resp.model;
}

/**
 * Calculate total cost for a round from metrics or individual responses.
 * @param {Object} round - Round object with optional metrics and responses
 * @returns {number} Total cost
 */
export function getRoundCost(round) {
  if (round.metrics?.cost) return round.metrics.cost;
  if (round.metrics?.total_cost) return round.metrics.total_cost;
  let total = 0;
  for (const resp of round.responses || []) {
    total += resp.metrics?.cost || 0;
  }
  return total;
}
