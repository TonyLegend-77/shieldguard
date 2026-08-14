'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'sg_theme';

export function useTheme() {
  const [theme, setThemeState] = useState('light');

  useEffect(() => {
    // The inline script in layout.jsx already applied the class before
    // paint (avoids a flash). This just syncs React state to match it.
    const isDark = document.documentElement.classList.contains('dark');
    setThemeState(isDark ? 'dark' : 'light');
  }, []);

  const setTheme = useCallback((next) => {
    setThemeState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    document.documentElement.classList.toggle('dark', next === 'dark');
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}
