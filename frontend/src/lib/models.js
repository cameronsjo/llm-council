/**
 * Model-related constants and utilities.
 * Shared across ModelSelector, ModelCuration, and related components.
 */

/** Major providers to prioritize in listings */
export const MAJOR_PROVIDERS = new Set([
  'anthropic',
  'openai',
  'google',
  'meta-llama',
  'mistralai',
  'cohere',
  'deepseek',
  'x-ai',
  'amazon',
  'microsoft',
]);

/**
 * Format model pricing for display.
 * @param {number|undefined} price - Price per token
 * @returns {string} Formatted price string
 */
export function formatPrice(price) {
  if (!price || price === 0) return 'Free';
  const perMillion = price * 1000000;
  if (perMillion < 0.01) return '<$0.01/M';
  return `$${perMillion.toFixed(2)}/M`;
}

/**
 * Get display name from model object.
 * @param {Object} model - Model object with id and optional name
 * @returns {string} Human-readable display name
 */
export function getDisplayName(model) {
  return model.name || model.id?.split('/').pop() || model.id || 'Unknown';
}

/**
 * Group models by provider.
 * @param {Array} models - Array of model objects
 * @returns {Object} Models grouped by provider name
 */
export function groupModelsByProvider(models) {
  return models.reduce((acc, model) => {
    const provider = model.provider || 'Other';
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(model);
    return acc;
  }, {});
}

/**
 * Sort providers with major providers first, then alphabetically.
 * @param {Array<string>} providers - Array of provider names
 * @returns {Array<string>} Sorted provider names
 */
export function sortProviders(providers) {
  return [...providers].sort((a, b) => {
    const aMajor = MAJOR_PROVIDERS.has(a.toLowerCase());
    const bMajor = MAJOR_PROVIDERS.has(b.toLowerCase());
    if (aMajor && !bMajor) return -1;
    if (!aMajor && bMajor) return 1;
    return a.localeCompare(b);
  });
}

/**
 * Check if a provider is considered a major provider.
 * @param {string} provider - Provider name
 * @returns {boolean} True if major provider
 */
export function isMajorProvider(provider) {
  return MAJOR_PROVIDERS.has(provider?.toLowerCase());
}

/**
 * Format context length for display.
 * @param {number|undefined} contextLength - Context length in tokens
 * @returns {string} Formatted context string (e.g., "128K")
 */
export function formatContextLength(contextLength) {
  if (!contextLength) return '';
  return `${Math.round(contextLength / 1000)}K`;
}
