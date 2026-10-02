import { describe, expect, it } from 'vitest';
import { applyAppFontScale } from '../app/fontScale';
import { createEmptySnapshot, normalizeAppFontScale, normalizeSnapshot } from '../lib/data';

describe('应用整体字号', () => {
  it('新快照默认使用标准字号，旧数据和非法值回退到标准字号', () => {
    expect(createEmptySnapshot(100).settings.appFontScale).toBe(100);
    expect(normalizeAppFontScale(120)).toBe(120);
    expect(normalizeAppFontScale(125)).toBe(100);
    expect(normalizeSnapshot({ settings: { appFontScale: 125 } }).settings.appFontScale).toBe(100);
  });

  it('把字号比例写入应用根节点', () => {
    const root = document.createElement('div');

    applyAppFontScale(120, root);

    expect(root.dataset.appFontScale).toBe('120');
    expect(root.style.getPropertyValue('--app-font-scale')).toBe('1.2');
  });
});
