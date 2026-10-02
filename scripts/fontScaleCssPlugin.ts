import type { Plugin } from 'postcss';

const SCALABLE_FONT_UNITS = /(?:^|[^\w.-])\d*\.?\d+(?:px|pt|pc|in|cm|mm|q|vw|vh|vmin|vmax|dvw|dvh|svw|svh|lvw|lvh)\b/i;

export const appFontScaleCssPlugin: Plugin = {
  postcssPlugin: 'proofline-app-font-scale',
  Once(root, { result }) {
    const sourcePath = (result.opts.from ?? '').replaceAll('\\', '/');
    if (!sourcePath.includes('/src/')) return;

    root.walkDecls('font-size', (declaration) => {
      const value = declaration.value.trim();
      if (
        value === '0'
        || value.includes('--app-font-scale')
        || /\b(?:em|rem)\b/i.test(value)
        || !SCALABLE_FONT_UNITS.test(value)
      ) {
        return;
      }

      declaration.value = `calc(${value} * var(--app-font-scale, 1))`;
    });
  },
};
