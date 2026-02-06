import { describe, it, expect } from 'vitest';
import { getUserInitial, getUserDisplayName, getThemeLabel } from '../lib/sidebarUtils';

// ---------------------------------------------------------------------------
// getUserInitial
// ---------------------------------------------------------------------------

describe('getUserInitial', () => {
  it('returns first letter of display_name uppercased', () => {
    expect(getUserInitial({ display_name: 'cameron', username: 'cam' })).toBe('C');
  });

  it('falls back to username when no display_name', () => {
    expect(getUserInitial({ username: 'alice' })).toBe('A');
  });

  it('returns ? when no name fields', () => {
    expect(getUserInitial({})).toBe('?');
  });

  it('returns ? for null userInfo', () => {
    expect(getUserInitial(null)).toBe('?');
  });

  it('handles uppercase names', () => {
    expect(getUserInitial({ display_name: 'ADMIN' })).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// getUserDisplayName
// ---------------------------------------------------------------------------

describe('getUserDisplayName', () => {
  it('returns display_name when available', () => {
    expect(getUserDisplayName({ display_name: 'Cameron Sjo', username: 'cam' })).toBe('Cameron Sjo');
  });

  it('falls back to username', () => {
    expect(getUserDisplayName({ username: 'cam' })).toBe('cam');
  });

  it('returns empty string for null', () => {
    expect(getUserDisplayName(null)).toBe('');
  });

  it('returns empty string for empty object', () => {
    expect(getUserDisplayName({})).toBe('');
  });
});

// ---------------------------------------------------------------------------
// getThemeLabel
// ---------------------------------------------------------------------------

describe('getThemeLabel', () => {
  it('returns System for system theme', () => {
    expect(getThemeLabel('system')).toBe('System');
  });

  it('returns Light for light theme', () => {
    expect(getThemeLabel('light')).toBe('Light');
  });

  it('returns Dark for dark theme', () => {
    expect(getThemeLabel('dark')).toBe('Dark');
  });

  it('returns System for unknown theme', () => {
    expect(getThemeLabel('unknown')).toBe('System');
  });
});
