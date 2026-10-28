import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { appFontScaleCssPlugin } from './scripts/fontScaleCssPlugin';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  worker: {
    format: 'es',
  },
  css: {
    postcss: {
      plugins: [appFontScaleCssPlugin],
    },
  },
  build: {
    // macOS 侧跑的是 WKWebView（Safari 内核），Windows 侧是 WebView2（Chromium）。
    // 原来写 esnext 只保证 Chromium 能跑，老一点 macOS 的 WKWebView 会撞上没转译的语法；
    // 取两者交集，让 esbuild 按 safari15 降级。
    target: ['safari15', 'chrome110'],
    minify: 'esbuild',
    sourcemap: false,
  },
  // ── Monaco Editor 预构建 ──
  // Monaco 的 ESM 包含数千个小模块，Vite 开发模式下逐个请求
  // 会导致严重的启动延迟和内存压力。optimizeDeps.include 强制
  // Vite 预构建 Monaco 及其核心依赖，显著加快热启动和模块解析。
  optimizeDeps: {
    include: [
      'monaco-editor',
      'monaco-editor/esm/vs/editor/editor.api.js',
      'monaco-editor/esm/vs/editor/editor.worker.js',
      'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js',
      'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js',
      'monaco-editor/esm/vs/basic-languages/python/python.contribution.js',
      'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js',
    ],
    // 排除 @monaco-editor/react 和 @monaco-editor/loader 避免
    // 它们的依赖在预构建时与 Monaco 的 ESM 模块产生冲突
    exclude: ['@monaco-editor/react', '@monaco-editor/loader'],
  },
});
