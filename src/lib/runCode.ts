import type { RunCodeResult } from '../types';

export interface LocalRunCodeRequest {
  language: string;
  code: string;
  input?: string;
  timeoutMs?: number;
}

interface PythonWorkerMessage {
  kind: 'ready' | 'result' | 'boot-error';
  id?: number;
  error?: string;
  result?: RunCodeResult;
}

interface PendingPythonRun {
  id: number;
  resolve: (result: RunCodeResult) => void;
  timer: ReturnType<typeof globalThis.setTimeout>;
  startedAt: number;
}

interface PythonRuntime {
  worker: Worker;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  bootTimer: ReturnType<typeof globalThis.setTimeout>;
  pending?: PendingPythonRun;
  disposed: boolean;
}

let pythonRuntime: PythonRuntime | undefined;
let pythonRunId = 0;
let pythonQueue: Promise<void> = Promise.resolve();

export function runCode(request: LocalRunCodeRequest): Promise<RunCodeResult> {
  const language = request.language.toLowerCase();
  if (language === 'cpp' || language === 'c++' || language === 'cpp17') {
    return Promise.resolve({
      ok: false,
      output: '',
      error: 'C++17 仅支持在力扣、LeetCode 或牛客官方平台运行。',
      durationMs: 0,
      timedOut: false,
    });
  }
  if (language === 'python' || language === 'python3') return enqueuePython(request);
  if (language === 'javascript' || language === 'typescript') return runJavaScript(request);
  return Promise.resolve({
    ok: false,
    output: '',
    error: `暂不支持本地运行 ${request.language}。`,
    durationMs: 0,
    timedOut: false,
  });
}

function runJavaScript(request: LocalRunCodeRequest): Promise<RunCodeResult> {
  const timeoutMs = clampTimeout(request.timeoutMs);
  const startedAt = performance.now();
  const worker = new Worker(new URL('../workers/codeRunner.worker.ts', import.meta.url), { type: 'module' });

  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: RunCodeResult) => {
      if (finished) return;
      finished = true;
      globalThis.clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    const timer = globalThis.setTimeout(() => finish({
      ok: false,
      output: '',
      error: `运行超过 ${timeoutMs} 毫秒，已强制终止。`,
      durationMs: performance.now() - startedAt,
      timedOut: true,
    }), timeoutMs);

    worker.onmessage = (event: MessageEvent<RunCodeResult>) => finish(event.data);
    worker.onerror = (event) => finish({
      ok: false,
      output: '',
      error: event.message || '本地代码 Worker 运行失败。',
      durationMs: performance.now() - startedAt,
      timedOut: false,
    });
    worker.postMessage({ ...request, timeoutMs });
  });
}

function enqueuePython(request: LocalRunCodeRequest): Promise<RunCodeResult> {
  const result = pythonQueue.then(() => runPython(request));
  pythonQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function runPython(request: LocalRunCodeRequest): Promise<RunCodeResult> {
  const timeoutMs = clampTimeout(request.timeoutMs);
  let runtime = getPythonRuntime();

  try {
    await runtime.ready;
  } catch (error) {
    disposePythonRuntime(runtime);
    return {
      ok: false,
      output: '',
      error: error instanceof Error ? error.message : 'Python 解释器加载失败。',
      durationMs: 0,
      timedOut: false,
    };
  }

  if (runtime.disposed || pythonRuntime !== runtime) {
    runtime = getPythonRuntime();
    try {
      await runtime.ready;
    } catch (error) {
      disposePythonRuntime(runtime);
      return {
        ok: false,
        output: '',
        error: error instanceof Error ? error.message : 'Python 解释器加载失败。',
        durationMs: 0,
        timedOut: false,
      };
    }
  }

  return new Promise((resolve) => {
    const id = ++pythonRunId;
    const startedAt = performance.now();
    const timer = globalThis.setTimeout(() => {
      if (runtime.pending?.id !== id) return;
      runtime.pending = undefined;
      resolve({
        ok: false,
        output: '',
        error: `Python 运行超过 ${timeoutMs} 毫秒，已强制终止。`,
        durationMs: performance.now() - startedAt,
        timedOut: true,
      });
      disposePythonRuntime(runtime);
    }, timeoutMs);

    runtime.pending = { id, resolve, timer, startedAt };
    runtime.worker.postMessage({ kind: 'run', id, code: request.code, input: request.input ?? '' });
  });
}

function getPythonRuntime(): PythonRuntime {
  if (pythonRuntime && !pythonRuntime.disposed) return pythonRuntime;

  const worker = new Worker(new URL('../workers/pyodide.worker.ts', import.meta.url), { type: 'module' });
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const runtime: PythonRuntime = {
    worker,
    ready,
    resolveReady,
    rejectReady,
    bootTimer: globalThis.setTimeout(() => {
      rejectReady(new Error('Python 解释器加载超过 30 秒，已终止。'));
      disposePythonRuntime(runtime);
    }, 30_000),
    disposed: false,
  };

  worker.onmessage = (event: MessageEvent<PythonWorkerMessage>) => {
    const message = event.data;
    if (message.kind === 'ready') {
      globalThis.clearTimeout(runtime.bootTimer);
      runtime.resolveReady();
      return;
    }
    if (message.kind === 'boot-error') {
      runtime.rejectReady(new Error(message.error || 'Python 解释器加载失败。'));
      disposePythonRuntime(runtime);
      return;
    }
    if (message.kind !== 'result' || !runtime.pending || runtime.pending.id !== message.id) return;
    const pending = runtime.pending;
    runtime.pending = undefined;
    globalThis.clearTimeout(pending.timer);
    pending.resolve(message.result ?? {
      ok: false,
      output: '',
      error: 'Python Worker 返回了无效结果。',
      durationMs: performance.now() - pending.startedAt,
      timedOut: false,
    });
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Python Worker 运行失败。');
    runtime.rejectReady(error);
    if (runtime.pending) {
      const pending = runtime.pending;
      runtime.pending = undefined;
      globalThis.clearTimeout(pending.timer);
      pending.resolve({
        ok: false,
        output: '',
        error: error.message,
        durationMs: performance.now() - pending.startedAt,
        timedOut: false,
      });
    }
    disposePythonRuntime(runtime);
  };

  pythonRuntime = runtime;
  return runtime;
}

function disposePythonRuntime(runtime: PythonRuntime): void {
  if (runtime.disposed) return;
  runtime.disposed = true;
  globalThis.clearTimeout(runtime.bootTimer);
  runtime.worker.terminate();
  if (pythonRuntime === runtime) pythonRuntime = undefined;
}

function clampTimeout(value?: number): number {
  return Math.min(3_000, Math.max(100, value ?? 3_000));
}
