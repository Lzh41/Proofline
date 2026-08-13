import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCode } from '../lib/runCode';

class HangingWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
}

describe('本地代码运行器', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('超时后强制终止 Worker 并返回可识别结果', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', HangingWorker);
    const resultPromise = runCode({ language: 'javascript', code: 'while(true){}', timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(101);
    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.error).toContain('强制终止');
  });
});
