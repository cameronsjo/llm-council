import { useState, useEffect, useCallback } from 'react';

const THEME_KEY = 'llm-council-theme';

/**
 * Theme options: 'system', 'light', 'dark'
 */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    // Check localStorage first
    const stored = localStorage.getItem(THEME_KEY);
    if (stored && ['system', 'light', 'dark'].includes(stored)) {
      return stored;
    }
    return 'system';
  });

  const [resolvedTheme, setResolvedTheme] = useState('light');

  // Resolve the actual theme (light or dark) based on preference
  const resolveTheme = useCallback(() => {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    return theme;
  }, [theme]);

  // Apply theme to document
  useEffect(() => {
    const resolved = resolveTheme();
    setResolvedTheme(resolved);

    // Set data-theme attribute for manual override
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }

    // Store preference
    localStorage.setItem(THEME_KEY, theme);
  }, [theme, resolveTheme]);

  // Listen for system preference changes
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      setResolvedTheme(mediaQuery.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  // Cycle through themes: system -> light -> dark -> system
  const cycleTheme = useCallback(() => {
    setTheme((current) => {
      switch (current) {
        case 'system':
          return 'light';
        case 'light':
          return 'dark';
        case 'dark':
          return 'system';
        default:
          return 'system';
      }
    });
  }, []);

  return {
    theme,
    setTheme,
    resolvedTheme,
    cycleTheme,
    isDark: resolvedTheme === 'dark',
  };
}
