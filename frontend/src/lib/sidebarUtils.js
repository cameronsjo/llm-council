/**
 * Pure utility functions for Sidebar component logic.
 * Extracted from Sidebar.jsx for testability.
 */

/**
 * Get the display initial for a user avatar.
 * @param {Object|null} userInfo - User info object
 * @returns {string} Single uppercase character for the avatar
 */
export function getUserInitial(userInfo) {
  const name = userInfo?.display_name || userInfo?.username || '?';
  return name[0].toUpperCase();
}

/**
 * Get the display name for a user.
 * @param {Object|null} userInfo - User info object
 * @returns {string} Display name or username
 */
export function getUserDisplayName(userInfo) {
  return userInfo?.display_name || userInfo?.username || '';
}

/**
 * Get the label text for the current theme.
 * @param {string} theme - Current theme ('system', 'light', 'dark')
 * @returns {string} Human-readable theme label
 */
export function getThemeLabel(theme) {
  const labels = { system: 'System', light: 'Light', dark: 'Dark' };
  return labels[theme] || 'System';
}
