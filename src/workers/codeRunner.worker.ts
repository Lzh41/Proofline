import { transpile } from 'typescript';
import type { RunCodeRequest, RunCodeResult } from '../types';

self.onmessage = (event: MessageEvent<RunCodeRequest>) => {
  const startedAt = performance.now();
  const request = event.data;
  const output: string[] = [];
  const write = (...values: unknown[]) => output.push(values.map(formatValue).join(' '));
  try {
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
