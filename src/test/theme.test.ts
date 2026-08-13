import { describe, expect, it, vi } from 'vitest';
import { applyTheme, editorThemeFor, nextTheme, readCachedTheme, resolveTheme } from '../app/theme';
import { createEmptySnapshot, normalizeSnapshot } from '../lib/data';

describe('界面主题', () => {
  it('首次启动和无效旧设置都回退到深色', () => {
    expect(createEmptySnapshot(100).settings.theme).toBe('dark');
    expect(normalizeSnapshot({ settings: { theme: 'unknown' } }).settings.theme).toBe('dark');
    expect(resolveTheme('system')).toBe('dark');
  });

  it('立即写入根节点主题和浏览器配色方案', () => {
    const root = document.createElement('div');
    const themeColor = document.createElement('meta');
    themeColor.name = 'theme-color';
    document.head.append(themeColor);
    applyTheme('light', root);

    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.themePreference).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    expect(themeColor.content).toBe('#faf9f5');

    applyTheme('dark', root);
    expect(themeColor.content).toBe('#181715');
    themeColor.remove();
  });

  it('跟随系统变化并在卸载时移除监听', () => {
    const root = document.createElement('div');
    let listener: (() => void) | undefined;
    const mediaQuery = {
      matches: false,
      addEventListener: vi.fn((_type: 'change', next: () => void) => { listener = next; }),
      removeEventListener: vi.fn(),
    };

    const cleanup = applyTheme('system', root, mediaQuery);
    expect(root.dataset.theme).toBe('light');

    mediaQuery.matches = true;
    listener?.();
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.themePreference).toBe('system');

    cleanup();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith('change', listener);
  });

  it('顶栏切换始终落到明确的深色或浅色偏好', () => {
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('system', true)).toBe('light');
    expect(nextTheme('system', false)).toBe('dark');
  });

  it('Monaco 使用 Proofline 自定义主题并跟随系统偏好', () => {
    expect(editorThemeFor('light')).toBe('proofline-light');
    expect(editorThemeFor('dark')).toBe('proofline-dark');
    expect(editorThemeFor('system', false)).toBe('proofline-light');
    expect(editorThemeFor('system', true)).toBe('proofline-dark');
  });

  it('启动前从本地快照同步恢复主题偏好', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ settings: { theme: 'light' } })),
    };
    expect(readCachedTheme(storage)).toBe('light');
    expect(readCachedTheme({ getItem: () => '{broken' })).toBeNull();
    expect(readCachedTheme({ getItem: () => JSON.stringify({ settings: { theme: 'unknown' } }) })).toBeNull();
  });
});
