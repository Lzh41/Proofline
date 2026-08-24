import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  build: {
    target: 'esnext',
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
  },
});
