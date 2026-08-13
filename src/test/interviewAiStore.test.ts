import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot } from '../lib/data';
import { useAppStore } from '../store/useAppStore';
import type { Problem } from '../types';
import { problem } from './fixtures';

const interviewProblem: Problem = problem({
  id: 'interview-rag',
  kind: 'interview',
  title: '如何评估 RAG 系统？',
  content: '请说明分层评估方案。',
  interview: {
    contentOrigin: 'builtin',
    primaryRole: 'rag-agent',
    roles: ['rag-agent'],
    category: 'RAG 评估',
    format: 'scenario',
    keyPoints: ['评估检索召回率', '检查生成事实一致性', '使用业务任务成功率'],
    referenceAnswer: '先拆分检索、生成和端到端三个层次，再以失败样本校准自动指标。',
    followUps: ['没有标准答案时如何评估？'],
  },
});

beforeEach(async () => {
  localStorage.clear();
  const state = createEmptySnapshot(100);
  state.problems = [interviewProblem];
  useAppStore.setState({ ...state, initialized: true, loading: false, error: null });
  await useAppStore.getState().saveAiCredential('test-key');
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

describe('面试 AI Store 链路', () => {
  it('发送当前回答和面试参考要点并记录生成结果', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '先补充端到端业务指标。' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await useAppStore.getState().requestAiHint({
      problemId: interviewProblem.id,
      intent: 'interview-critique',
      answerText: '我会先看检索召回率。',
    } as never);

    expect(response).toBe('先补充端到端业务指标。');
    const request = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(request.messages[0].content).toContain('我会先看检索召回率。');
    expect(request.messages[0].content).toContain('评估检索召回率');
    expect(request.messages[0].content).toContain('点评当前回答');
    expect(useAppStore.getState().aiGenerations[0]).toMatchObject({ problemId: interviewProblem.id });
  });

  it('按技术主题生成并解析结构化面试题', async () => {
    const examinerResponse = {
      topic: 'Transformer',
      overview: '覆盖结构、训练与推理优化。',
      checkpoints: ['自注意力', '位置编码'],
      questions: [{
        title: '为什么自注意力需要除以根号 d_k？',
        category: '注意力机制',
        format: 'knowledge',
        difficulty: 'medium',
        tags: ['Transformer', 'Attention'],
        keyPoints: ['点积方差', 'Softmax 饱和', '梯度稳定性'],
        referenceAnswer: '缩放可以控制点积分布的方差，避免 Softmax 过早饱和。',
        followUps: ['如果不缩放会怎样？'],
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(examinerResponse) } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await useAppStore.getState().requestInterviewExaminer({
      topic: 'Transformer',
      role: 'llm-algorithm',
      difficulty: 'medium',
      count: 5,
    });

    expect(result.questions[0].title).toBe('为什么自注意力需要除以根号 d_k？');
    const request = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(request.messages[0].content).toContain('Transformer');
    expect(request.messages[0].content).toContain('questions 数组必须恰好包含 5 道');
  });
});
