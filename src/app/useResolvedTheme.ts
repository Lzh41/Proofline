import { useEffect, useState } from 'react';
import type { AppTheme } from '../types';
import { resolveTheme, type ResolvedTheme } from './theme';

function currentSystemPreference(): boolean {
  return typeof window === 'undefined'
    || typeof window.matchMedia !== 'function'
    || window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useResolvedTheme(theme: AppTheme): ResolvedTheme {
  const [systemPrefersDark, setSystemPrefersDark] = useState(currentSystemPreference);

  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return undefined;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystemPrefersDark(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener('change', sync);
    return () => mediaQuery.removeEventListener('change', sync);
  }, [theme]);

  const prefersDark = theme === 'system' ? currentSystemPreference() : systemPrefersDark;
  return resolveTheme(theme, prefersDark);
}
