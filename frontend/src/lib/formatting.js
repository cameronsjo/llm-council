/**
 * Shared formatting utilities.
 * Extracted from Round.jsx, Synthesis.jsx, MetricsDisplay.jsx to eliminate duplication.
 */

/**
 * Format a dollar cost for display.
 * @param {number|null|undefined} cost - Cost in dollars
 * @returns {string|null} Formatted cost string, or null for zero/missing
 */
export function formatCost(cost) {
  if (!cost || cost === 0) return null;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Format a dollar cost for display (always returns a string, for metrics).
 * @param {number} cost - Cost in dollars
 * @returns {string} Formatted cost string
 */
export function formatCostAlways(cost) {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Format latency in milliseconds for display.
 * @param {number} ms - Latency in milliseconds
 * @returns {string} Formatted latency string
 */
export function formatLatency(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format token count for display.
 * @param {number} tokens - Token count
 * @returns {string} Formatted token string
 */
export function formatTokens(tokens) {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toString();
}

/**
 * Extract reasoning text from various API response formats.
 * @param {string|Array|Object|null} reasoningDetails - Reasoning data in various formats
 * @returns {string|null} Extracted reasoning text
 */
export function getReasoningText(reasoningDetails) {
  if (!reasoningDetails) return null;
  if (typeof reasoningDetails === 'string') return reasoningDetails;

  if (Array.isArray(reasoningDetails)) {
    return reasoningDetails
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item.summary) return item.summary;
        if (item.content) return item.content;
        return null;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  if (reasoningDetails.summary) return reasoningDetails.summary;
  if (reasoningDetails.content) return reasoningDetails.content;
  return null;
}
