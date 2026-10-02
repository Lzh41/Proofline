import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { appFontScaleCssPlugin } from '../../scripts/fontScaleCssPlugin';

describe('应用字号 CSS 转换', () => {
  it('缩放应用字体尺寸，保留相对字号和零字号', async () => {
    const result = await postcss([appFontScaleCssPlugin]).process(`
      .label { font-size: 13px; }
      .important { font-size: 11px !important; }
      .heading { font-size: clamp(30px, 3vw, 42px); }
      .relative { font-size: 1.45em; }
      .rootRelative { font-size: 1rem; }
      .iconOnly { font-size: 0; }
      .spacing { margin: 13px; }
    `, { from: 'G:\\Codex\\xiti\\src\\pages\\Pages.module.css' });

    expect(result.css).toContain('font-size: calc(13px * var(--app-font-scale, 1))');
    expect(result.css).toContain('font-size: calc(clamp(30px, 3vw, 42px) * var(--app-font-scale, 1))');
    expect(result.css).toContain('font-size: 1.45em');
    expect(result.css).toContain('font-size: 1rem');
    expect(result.css).toContain('font-size: 0');
    expect(result.css).toContain('margin: 13px');
  });

  it('不改写第三方样式', async () => {
    const result = await postcss([appFontScaleCssPlugin]).process('.label { font-size: 13px; }', {
      from: 'G:\\Codex\\xiti\\node_modules\\monaco-editor\\editor.css',
    });

    expect(result.css).toContain('font-size: 13px');
  });
});
