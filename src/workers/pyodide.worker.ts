type PyodideGlobals = { destroy?: () => void };

interface PyodideApi {
  runPython: (code: string) => PyodideGlobals;
  runPythonAsync: (code: string, options?: { globals?: PyodideGlobals; filename?: string }) => Promise<unknown>;
  setStdin: (options: { stdin: () => string | null; autoEOF?: boolean }) => void;
  setStdout: (options: { batched: (value: string) => void }) => void;
  setStderr: (options: { batched: (value: string) => void }) => void;
}

interface PyodideModule {
  loadPyodide: (options: {
    indexURL: string;
    lockFileURL: string;
    stdout: (value: string) => void;
    stderr: (value: string) => void;
  }) => Promise<PyodideApi>;
}

interface PythonRunRequest {
  kind: 'run';
  id: number;
  code: string;
  input?: string;
}

const MAX_OUTPUT_BYTES = 128 * 1024;
const MAX_SOURCE_BYTES = 500 * 1024;
const MAX_INPUT_BYTES = 100 * 1024;

const runtimePromise = loadRuntime();

self.onmessage = async (event: MessageEvent<PythonRunRequest>) => {
  if (event.data.kind !== 'run') return;
  const { id, code, input = '' } = event.data;
  const startedAt = performance.now();

  try {
    if (new TextEncoder().encode(code).byteLength > MAX_SOURCE_BYTES) throw new Error('源代码超过 500 KB，已停止运行。');
    if (new TextEncoder().encode(input).byteLength > MAX_INPUT_BYTES) throw new Error('标准输入超过 100 KB，已停止运行。');
    const pyodide = await runtimePromise;
    const stdout: string[] = [];
    const stderr: string[] = [];
    let outputBytes = 0;
    const appendOutput = (target: string[], value: string) => {
      const remaining = MAX_OUTPUT_BYTES - outputBytes;
      if (remaining <= 0) throw new Error(`输出超过 ${MAX_OUTPUT_BYTES} 字节上限，已停止运行。`);
      const clipped = value.slice(0, remaining);
      target.push(clipped);
      outputBytes += new TextEncoder().encode(clipped).byteLength;
      if (clipped.length < value.length || outputBytes >= MAX_OUTPUT_BYTES) throw new Error(`输出超过 ${MAX_OUTPUT_BYTES} 字节上限，已停止运行。`);
    };
    const inputLines = input.replace(/\r/g, '').split('\n');
    let inputIndex = 0;

    pyodide.setStdin({
      stdin: () => inputIndex < inputLines.length ? inputLines[inputIndex++] : null,
      autoEOF: true,
    });
    pyodide.setStdout({ batched: (value) => appendOutput(stdout, value) });
    pyodide.setStderr({ batched: (value) => appendOutput(stderr, value) });

    const globals = pyodide.runPython("dict(__name__='__main__')");
    try {
      await pyodide.runPythonAsync(code, { globals, filename: 'solution.py' });
      self.postMessage({
        kind: 'result',
        id,
        result: {
          ok: true,
          output: stdout.join('\n'),
          error: stderr.length ? stderr.join('\n') : undefined,
          durationMs: performance.now() - startedAt,
          timedOut: false,
        },
      });
    } catch (error) {
      self.postMessage({
        kind: 'result',
        id,
        result: {
          ok: false,
          output: stdout.join('\n'),
          error: formatError(error, stderr),
          durationMs: performance.now() - startedAt,
          timedOut: false,
        },
      });
    } finally {
      globals.destroy?.();
    }
  } catch (error) {
    self.postMessage({ kind: 'boot-error', error: formatError(error, []) });
  }
};

async function loadRuntime(): Promise<PyodideApi> {
  const indexURL = new URL('/pyodide/', self.location.href).href;
  const module = await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`) as PyodideModule;
  const pyodide = await module.loadPyodide({
    indexURL,
    lockFileURL: `${indexURL}pyodide-lock.json`,
    stdout: () => undefined,
    stderr: () => undefined,
  });
  self.postMessage({ kind: 'ready' });
  return pyodide;
}

function formatError(error: unknown, stderr: string[]): string {
  const message = error instanceof Error ? error.message : String(error);
  return [...stderr, message].filter(Boolean).join('\n');
}
