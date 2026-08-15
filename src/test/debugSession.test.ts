import { describe, expect, it, vi } from 'vitest';
import { DebugSession } from '../lib/debugSession';
import type { DebugEvent } from '../types';

describe('受限调试会话协议', () => {
  it('所有事件带 sessionId，并支持开始、单步和幂等终止', async () => {
    const events: DebugEvent[] = [];
    const session = new DebugSession({
      sessionId: 'debug-test',
      language: 'typescript',
      code: 'const value = 1;\nconsole.log(value);',
      input: '',
      breakpoints: [],
      onEvent: (event) => events.push(event),
    });

    session.start();
    expect(events.map((event) => event.type)).toEqual(['started', 'paused']);
    expect(events.every((event) => event.sessionId === 'debug-test')).toBe(true);
    await session.command({ type: 'step-over', sessionId: 'debug-test' });
    expect(events.at(-1)?.type).toBe('paused');
    await session.command({ type: 'terminate', sessionId: 'debug-test' });
    await session.command({ type: 'terminate', sessionId: 'debug-test' });
    expect(events.filter((event) => event.type === 'terminated')).toHaveLength(1);
  });

  it('忽略迟到或错误会话的命令', async () => {
    const onEvent = vi.fn<(event: DebugEvent) => void>();
    const session = new DebugSession({ sessionId: 'current', language: 'cpp17', code: 'int main() {}', input: '', breakpoints: [], onEvent });
    session.start();
    const count = onEvent.mock.calls.length;
    await session.command({ type: 'continue', sessionId: 'stale' });
    expect(onEvent.mock.calls).toHaveLength(count);
  });
});
