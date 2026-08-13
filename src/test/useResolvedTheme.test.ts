import { act, render, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useResolvedTheme } from '../app/useResolvedTheme';

describe('响应式主题', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('跟随系统偏好变化并在卸载时清理监听', () => {
    let listener: (() => void) | undefined;
    const mediaQuery = {
      matches: false,
      addEventListener: vi.fn((_type: 'change', next: () => void) => { listener = next; }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));

    const { result, unmount } = renderHook(() => useResolvedTheme('system'));
    expect(result.current).toBe('light');

    act(() => {
      mediaQuery.matches = true;
      listener?.();
    });
    expect(result.current).toBe('dark');

    unmount();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith('change', listener);
  });

  it('明确主题不订阅系统变化', () => {
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));

    const { result } = renderHook(() => useResolvedTheme('light'));
    expect(result.current).toBe('light');
    expect(mediaQuery.addEventListener).not.toHaveBeenCalled();
  });

  it('显式主题变化的首次渲染就返回新值', () => {
    const renders: string[] = [];
    function Probe({ theme }: { theme: 'light' | 'dark' }) {
      renders.push(useResolvedTheme(theme));
      return null;
    }

    const view = render(createElement(Probe, { theme: 'dark' }));
    renders.length = 0;
    view.rerender(createElement(Probe, { theme: 'light' }));

    expect(renders[0]).toBe('light');
  });

  it('切换到跟随系统的首次渲染读取当前系统偏好', () => {
    const mediaQuery = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));
    const renders: string[] = [];
    function Probe({ theme }: { theme: 'dark' | 'system' }) {
      renders.push(useResolvedTheme(theme));
      return null;
    }

    const view = render(createElement(Probe, { theme: 'dark' }));
    mediaQuery.matches = true;
    renders.length = 0;
    view.rerender(createElement(Probe, { theme: 'system' }));

    expect(renders[0]).toBe('dark');
  });
});
