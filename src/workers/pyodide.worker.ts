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

const runtimePromise = loadRuntime();

self.onmessage = async (event: MessageEvent<PythonRunRequest>) => {
  if (event.data.kind !== 'run') return;
  const { id, code, input = '' } = event.data;
  const startedAt = performance.now();

  try {
    const pyodide = await runtimePromise;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const inputLines = input.replace(/\r/g, '').split('\n');
    let inputIndex = 0;

    pyodide.setStdin({
      stdin: () => inputIndex < inputLines.length ? inputLines[inputIndex++] : null,
      autoEOF: true,
    });
    pyodide.setStdout({ batched: (value) => stdout.push(value) });
    pyodide.setStderr({ batched: (value) => stderr.push(value) });

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
