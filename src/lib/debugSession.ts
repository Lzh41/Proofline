import type {
  DebugCommand,
  DebugEvent,
  DebugScope,
  DebugSourceLocation,
  DebugStackFrame,
  RunCodeResult,
} from '../types';
import { runCode } from './runCode';

const MAX_DEBUG_SOURCE = 500_000;
const MAX_DEBUG_INPUT = 100_000;
const MAX_DEBUG_BREAKPOINTS = 200;
const MAX_DEBUG_STEPS = 500;

export interface DebugSessionOptions {
  sessionId: string;
  code: string;
  language: string;
  input: string;
  breakpoints: number[];
  onEvent: (event: DebugEvent) => void;
}

/**
 * 受限的本地调试适配器：脚本语言使用现有隔离 worker 执行，断点和单步通过
 * 可执行源行快照驱动；C++ 保持诊断降级，不直接把调试器进程暴露给页面。
 */
export class DebugSession {
  private readonly options: DebugSessionOptions;
  private readonly executableLines: number[];
  private readonly breakpoints: Set<number>;
  private currentIndex = 0;
  private steps = 0;
  private status: 'created' | 'paused' | 'running' | 'completed' | 'terminated' = 'created';

  constructor(options: DebugSessionOptions) {
    this.options = {
      ...options,
      code: options.code.slice(0, MAX_DEBUG_SOURCE),
      input: options.input.slice(0, MAX_DEBUG_INPUT),
      breakpoints: options.breakpoints.filter((line) => Number.isInteger(line) && line > 0).slice(0, MAX_DEBUG_BREAKPOINTS),
    };
    this.breakpoints = new Set(this.options.breakpoints);
    this.executableLines = this.options.code.split(/\r?\n/)
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => line && !line.startsWith('//') && !line.startsWith('#') && !line.startsWith('*'))
      .map(({ number }) => number);
  }

  start(): void {
    if (this.status !== 'created') return;
    this.status = 'paused';
    this.emit({ type: 'started', sessionId: this.options.sessionId, entryFile: this.options.language.toLowerCase().startsWith('python') ? 'solution.py' : 'solution.ts' });
    this.pause('breakpoint');
  }

  async command(command: Exclude<DebugCommand, { type: 'start' }>): Promise<void> {
    if (command.sessionId !== this.options.sessionId || this.status === 'terminated' || this.status === 'completed') return;
    switch (command.type) {
      case 'pause':
        if (this.status === 'running') {
          this.status = 'paused';
          this.pause('step');
        }
        return;
      case 'terminate':
        this.status = 'terminated';
        this.emit({ type: 'terminated', sessionId: this.options.sessionId, reason: '用户终止调试会话' });
        return;
      case 'step-over':
      case 'step-into':
      case 'step-out':
        this.steps += 1;
        if (this.steps > MAX_DEBUG_STEPS) {
          this.status = 'terminated';
          this.emit({ type: 'error', sessionId: this.options.sessionId, code: 'STEP_LIMIT', message: '单步次数超过限制，会话已终止。' });
          return;
        }
        this.currentIndex = Math.min(this.currentIndex + 1, Math.max(0, this.executableLines.length - 1));
        this.status = 'paused';
        this.pause('step');
        return;
      case 'continue':
        await this.continueRun();
        return;
      default:
        return;
    }
  }

  private async continueRun(): Promise<void> {
    this.status = 'running';
    this.emit({ type: 'continued', sessionId: this.options.sessionId });
    if (this.breakpoints.size) {
      const nextBreakpoint = this.executableLines.findIndex((line, index) => index > this.currentIndex && this.breakpoints.has(line));
      if (nextBreakpoint >= 0) {
        this.currentIndex = nextBreakpoint;
        this.status = 'paused';
        this.pause('breakpoint');
        return;
      }
    }
    if (/^(?:cpp|cpp17|c\+\+|c\+\+17)$/i.test(this.options.language.trim())) {
      this.status = 'completed';
      this.emit({ type: 'error', sessionId: this.options.sessionId, code: 'CPP_DIAGNOSTIC_ONLY', message: 'C++ 调试当前提供受限诊断模式，请使用样例运行查看编译错误、调用栈和输出。' });
      return;
    }
    let result: RunCodeResult;
    try {
      result = await runCode({ language: this.options.language, code: this.options.code, input: this.options.input, timeoutMs: 3_000 });
    } catch (error) {
      result = { ok: false, output: '', error: error instanceof Error ? error.message : '调试运行失败。', durationMs: 0, timedOut: false };
    }
    if (result.output) this.emit({ type: 'output', sessionId: this.options.sessionId, stream: 'stdout', text: result.output });
    if (result.error) this.emit({ type: 'output', sessionId: this.options.sessionId, stream: 'stderr', text: result.error });
    this.status = result.ok ? 'completed' : 'paused';
    if (!result.ok && !result.timedOut) this.pause('exception', result.error);
    else this.emit({ type: 'completed', sessionId: this.options.sessionId, result });
  }

  private pause(reason: 'breakpoint' | 'exception' | 'step', error?: string): void {
    const line = this.executableLines[this.currentIndex] ?? 1;
    const location: DebugSourceLocation = { file: this.options.language.toLowerCase().startsWith('python') ? 'solution.py' : 'solution.ts', line, column: 1 };
    const stack: DebugStackFrame[] = [{ id: 'frame-0', name: 'global', location }];
    const variables = extractVariables(this.options.code, line);
    const scopes: DebugScope[] = [{ name: '局部变量', variables }, { name: '调试状态', variables: [{ name: '暂停原因', value: error ?? reason, type: 'string' }] }];
    this.emit({ type: 'paused', sessionId: this.options.sessionId, reason, location, stack, scopes });
  }

  private emit(event: DebugEvent): void { this.options.onEvent(event); }
}

function extractVariables(code: string, line: number): DebugScope['variables'] {
  const lines = code.split(/\r?\n/).slice(0, line);
  const values = new Map<string, DebugScope['variables'][number]>();
  const pattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+)/g;
  lines.join('\n').replace(pattern, (_match, name: string, value: string) => {
    values.set(name, { name, value: value.trim().slice(0, 160), type: 'unknown' });
    return _match;
  });
  return [...values.values()].slice(0, 50);
}
