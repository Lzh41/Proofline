import { transpile } from 'typescript';
import type { RunCodeRequest, RunCodeResult } from '../types';

const MAX_OUTPUT_BYTES = 128 * 1024;
const MAX_SOURCE_BYTES = 500 * 1024;
const MAX_INPUT_BYTES = 100 * 1024;

self.onmessage = (event: MessageEvent<RunCodeRequest>) => {
  const startedAt = performance.now();
  const request = event.data;
  const output: string[] = [];
  let outputBytes = 0;
  const write = (...values: unknown[]) => {
    const text = values.map(formatValue).join(' ');
    const remaining = MAX_OUTPUT_BYTES - outputBytes;
    if (remaining <= 0) throw new Error(`输出超过 ${MAX_OUTPUT_BYTES} 字节上限，已停止运行。`);
    const clipped = text.slice(0, remaining);
    output.push(clipped);
    outputBytes += new TextEncoder().encode(clipped).byteLength;
    if (clipped.length < text.length || outputBytes >= MAX_OUTPUT_BYTES) throw new Error(`输出超过 ${MAX_OUTPUT_BYTES} 字节上限，已停止运行。`);
  };
  try {
    if (new TextEncoder().encode(request.code).byteLength > MAX_SOURCE_BYTES) throw new Error('源代码超过 500 KB，已停止运行。');
    if (new TextEncoder().encode(request.input ?? '').byteLength > MAX_INPUT_BYTES) throw new Error('标准输入超过 100 KB，已停止运行。');
    const source = request.language === 'typescript'
      ? transpile(request.code, { target: 9, module: 0, strict: true })
      : request.code;
    const input = request.input ?? '';
    const lines = input.replace(/\r/g, '').split('\n');
    const safeConsole = { log: write, info: write, warn: write, error: write };
    const execute = new Function(
      'input', 'lines', 'print', 'console', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts',
      `"use strict";\n${source}`,
    );
    const returned = execute(input, lines, write, safeConsole, undefined, undefined, undefined, undefined, undefined);
    if (returned !== undefined) write(returned);
    const result: RunCodeResult = { ok: true, output: output.join('\n'), durationMs: performance.now() - startedAt, timedOut: false };
    self.postMessage(result);
  } catch (error) {
    const result: RunCodeResult = {
      ok: false,
      output: output.join('\n'),
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      durationMs: performance.now() - startedAt,
      timedOut: false,
    };
    self.postMessage(result);
  }
};

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  try { return JSON.stringify(value); }
  catch { return String(value); }
}
