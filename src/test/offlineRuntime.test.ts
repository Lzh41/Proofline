// @ts-expect-error 测试在 Node 中运行，应用 tsconfig 有意不向前端暴露 Node 类型。
import { stat } from 'node:fs/promises';
// @ts-expect-error 测试在 Node 中运行，应用 tsconfig 有意不向前端暴露 Node 类型。
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OCR_ASSET_PATHS } from '../lib/ocr';
import { runCode } from '../lib/runCode';

const REQUIRED_ASSETS: Array<[string, number]> = [
  ['pyodide/pyodide.mjs', 10_000],
  ['pyodide/pyodide.asm.mjs', 1_000_000],
  ['pyodide/pyodide.asm.wasm', 9_000_000],
  ['pyodide/python_stdlib.zip', 2_000_000],
  ['pyodide/pyodide-lock.json', 100_000],
  [OCR_ASSET_PATHS.worker, 100_000],
  [OCR_ASSET_PATHS.core, 3_000_000],
  [`${OCR_ASSET_PATHS.languageDirectory}chi_sim.traineddata.gz`, 1_000_000],
  [`${OCR_ASSET_PATHS.languageDirectory}eng.traineddata.gz`, 2_000_000],
];

describe('离线运行资产', () => {
  it.each(REQUIRED_ASSETS)('%s 已打包且不是占位文件', async (relativePath, minimumBytes) => {
    const file = await stat(resolve('public', relativePath));
    expect(file.isFile()).toBe(true);
    expect(file.size).toBeGreaterThan(minimumBytes);
  });

  it('C++17 明确交给官方平台运行', async () => {
    const result = await runCode({ language: 'cpp', code: 'int main(){}' });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.error).toContain('官方平台');
  });
});
