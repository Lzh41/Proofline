import type { AppTheme } from '../types';

export type ResolvedTheme = Exclude<AppTheme, 'system'>;
export const MONACO_THEME_NAMES = {
  light: 'proofline-light',
  dark: 'proofline-dark',
} as const;
export type MonacoTheme = typeof MONACO_THEME_NAMES[keyof typeof MONACO_THEME_NAMES];

interface ThemeRoot {
  dataset: DOMStringMap;
  style: Pick<CSSStyleDeclaration, 'colorScheme'>;
}

interface ThemeMediaQuery {
  matches: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

interface ThemeStorage {
  getItem(key: string): string | null;
}

const SNAPSHOT_STORAGE_KEY = 'xiti.app-data.v1';
const APP_THEMES: readonly AppTheme[] = ['light', 'dark', 'system'];

export function resolveTheme(theme: AppTheme, prefersDark = true): ResolvedTheme {
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}

export function nextTheme(theme: AppTheme, prefersDark = true): ResolvedTheme {
  return resolveTheme(theme, prefersDark) === 'dark' ? 'light' : 'dark';
}

export function editorThemeFor(theme: AppTheme, prefersDark = true): MonacoTheme {
  return MONACO_THEME_NAMES[resolveTheme(theme, prefersDark)];
}

export function readCachedTheme(
  storage: ThemeStorage | null = typeof localStorage === 'undefined' ? null : localStorage,
): AppTheme | null {
  if (!storage) return null;
  try {
    const theme = JSON.parse(storage.getItem(SNAPSHOT_STORAGE_KEY) ?? 'null')?.settings?.theme;
    return APP_THEMES.includes(theme) ? theme : null;
  } catch {
    return null;
  }
}

function systemThemeQuery(): ThemeMediaQuery | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-color-scheme: dark)');
}

export function applyTheme(
  theme: AppTheme,
  root: ThemeRoot | null = typeof document === 'undefined' ? null : document.documentElement,
  mediaQuery: ThemeMediaQuery | null = systemThemeQuery(),
): () => void {
  if (!root) return () => undefined;

  const render = () => {
    const resolved = resolveTheme(theme, mediaQuery?.matches ?? true);
    root.dataset.theme = resolved;
    root.dataset.themePreference = theme;
    root.style.colorScheme = resolved;
    if (typeof document !== 'undefined') {
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#181715' : '#faf9f5');
    }
  };

  render();
  if (theme !== 'system' || !mediaQuery?.addEventListener) return () => undefined;

  mediaQuery.addEventListener('change', render);
  return () => mediaQuery.removeEventListener?.('change', render);
}
