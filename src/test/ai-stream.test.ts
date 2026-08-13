import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSseDecoder, buildHintPrompt, coachIntentLevel, extractAiResponseContent } from '../lib/ai';
import { useAppStore } from '../store/useAppStore';
import { attempt, problem, snapshot } from './fixtures';

beforeEach(async () => {
  localStorage.clear();
  const data = snapshot();
  data.problems = [problem()];
  useAppStore.setState({ ...data, initialized: true, loading: false, error: null });
  await useAppStore.getState().saveAiCredential('test-key-123456');
  await useAppStore.getState().updateSettings({
    aiBaseUrl: 'http://127.0.0.1:3456/v1',
    aiModel: 'mock-model',
    privacyConfirmed: true,
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await useAppStore.getState().deleteAiCredential();
});

describe('AI 流式响应', () => {
  it('最近练习分析提示要求覆盖每道题并整理成知识笔记结构', () => {
    const promptText = buildHintPrompt({
      intent: 'explain',
      problem: problem({ title: '两数之和' }),
      analysisContext: '练习 1\n题目：两数之和\n结果：sample-passed\n代码：使用哈希表',
      userQuestion: '请整理最近新增练习',
    });

    expect(promptText).toContain('最近练习复盘');
    expect(promptText).toContain('共同考点');
    expect(promptText).toContain('两数之和');
    expect(promptText).toContain('下一轮复习清单');
  });

  it('只分析上次分析之后的已完成题目，并将结果保存为关联笔记', async () => {
    const firstProblem = problem({ id: 'problem-1', title: '两数之和' });
    const secondProblem = problem({ id: 'problem-2', title: '滑动窗口' });
    const originalRequestAiHint = useAppStore.getState().requestAiHint;
    useAppStore.setState((state) => ({
      ...state,
      problems: [firstProblem, secondProblem],
      attempts: [
        attempt({ id: 'attempt-new', problemId: 'problem-2', result: 'sample-passed', endedAt: 300, updatedAt: 300 }),
        attempt({ id: 'attempt-old', problemId: 'problem-1', result: 'sample-passed', endedAt: 200, updatedAt: 200 }),
      ],
      knowledgeNotes: [{
        id: 'analysis-old', title: '旧分析', content: '已整理', tags: ['AI练习分析'], relatedProblemIds: ['problem-1'], relatedMistakeIds: [], createdAt: 250, updatedAt: 250,
      }],
      requestAiHint: vi.fn(async (payload: { analysisContext?: string }) => {
        expect(payload.analysisContext).toContain('滑动窗口');
        expect(payload.analysisContext).not.toContain('两数之和');
        return '共同考点\n滑动窗口复盘';
      }),
    }));

    const note = await useAppStore.getState().analyzeRecentPractice();
    useAppStore.setState({ requestAiHint: originalRequestAiHint });
    expect(note?.relatedProblemIds).toEqual(['problem-2']);
    expect(note?.tags).toContain('AI练习分析');
    expect(useAppStore.getState().knowledgeNotes[0]?.content).toContain('滑动窗口复盘');
  });

  it('算法逻辑拆解提示解释算法为什么这样写', () => {
    const promptText = buildHintPrompt({
      intent: 'algorithm-logic' as never,
      problem: problem({
        title: '最长无重复子串',
        tags: ['滑动窗口'],
        content: '给定一个字符串 s，请你找出其中不含有重复字符的最长子串的长度。',
      }),
      code: 'function lengthOfLongestSubstring(s: string): number { return 0; }',
      language: 'typescript',
    });

    expect(coachIntentLevel('algorithm-logic' as never)).toBe(3);
    expect(promptText).toContain('算法逻辑拆解');
    expect(promptText).toContain('解释算法为什么这么写');
    expect(promptText).toContain('状态定义');
    expect(promptText).toContain('转移或更新规则');
    expect(promptText).toContain('复杂度');
    expect(promptText).not.toContain('完整解答');
  });

  it('AI 解惑按用户问题进行对话式讲解', () => {
    const promptText = buildHintPrompt({
      intent: 'explain' as never,
      problem: problem({
        title: '最长无重复子串',
        tags: ['滑动窗口'],
        content: '给定一个字符串 s，请你找出其中不含有重复字符的最长子串的长度。',
      }),
      code: 'while (seen.has(s[right])) left++;',
      language: 'typescript',
      userQuestion: '为什么 left 要移动，不能直接跳过 right 吗？',
    });

    expect(coachIntentLevel('explain' as never)).toBe(3);
    expect(promptText).toContain('AI 解惑');
    expect(promptText).toContain('像对话问答一样');
    expect(promptText).toContain('为什么 left 要移动');
    expect(promptText).toContain('结合当前代码');
    expect(promptText).not.toContain('检查边界');
  });

  it('可以拼接跨网络分片的 SSE 增量并识别结束标记', () => {
    const decoder = new AiSseDecoder();

    expect(decoder.push('data: {"choices":[{"delta":{"content":"关键')).toEqual([]);
    expect(decoder.push('观察"}}]}\n\ndata: [DONE]\n\n')).toEqual([
      { event: 'delta', content: '关键观察' },
      { event: 'done' },
    ]);
    expect(decoder.push('data: {"choices":[{"delta":{"content":"不应出现"}}]}\n')).toEqual([]);
  });

  it('兼容分段内容并把服务端错误转为中文错误事件', () => {
    const decoder = new AiSseDecoder();
    expect(decoder.push('data: {"choices":[{"delta":{"content":[{"text":"第一段"},{"text":"第二段"}]}}]}\n')).toEqual([
      { event: 'delta', content: '第一段第二段' },
    ]);
    expect(decoder.push('data: {"error":{"message":"model unavailable"}}\n')).toEqual([
      { event: 'error', message: 'AI 服务返回错误：model unavailable' },
    ]);
  });

  it('兼容忽略流式参数后返回的普通聊天响应', () => {
    expect(extractAiResponseContent({
      choices: [{ message: { content: [{ text: '完整' }, { text: '回答' }] } }],
    })).toBe('完整回答');
  });

  it('逐段回调可见内容并在完成后保存完整生成记录', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"先找"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"不变量"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const chunks: string[] = [];

    const answer = await useAppStore.getState().requestAiHint({
      problemId: 'problem-1',
      intent: 'explain',
      userQuestion: '为什么要先找不变量？',
      previousGuidance: '第一级已经完成入口骨架',
      onChunk: (chunk) => chunks.push(chunk),
    });

    expect(chunks).toEqual(['先找', '不变量']);
    expect(answer).toBe('先找不变量');
    expect(useAppStore.getState().aiGenerations[0]).toMatchObject({
      intent: 'explain',
      userQuestion: '为什么要先找不变量？',
      response: '先找不变量',
    });
    const request = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(request.messages[0].content).toContain('最近教练对话：\n第一级已经完成入口骨架');
  });

  it('取消后终止请求且不丢失已经回调的内容', async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"已收到"}}]}\n\n'));
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        },
      });
      return Promise.resolve(new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }));
    }));
    const chunks: string[] = [];
    const pending = useAppStore.getState().requestAiHint({
      problemId: 'problem-1',
      level: 2,
      onChunk: (chunk) => chunks.push(chunk),
    });
    await vi.waitFor(() => expect(chunks).toEqual(['已收到']));

    await useAppStore.getState().cancelAiRequest();

    await expect(pending).rejects.toThrow('AI 请求已取消');
    expect(chunks).toEqual(['已收到']);
  });
});
