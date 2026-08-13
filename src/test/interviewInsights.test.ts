import { describe, expect, it } from 'vitest';
import {
  buildInterviewExaminerPrompt,
  buildInterviewPrompt,
  parseInterviewExaminerResponse,
} from '../lib/ai';
import { calculateInterviewStatistics } from '../lib/statistics';
import type { Problem } from '../types';
import { attempt, mistake, problem } from './fixtures';

function interviewProblem(overrides: Partial<Problem> = {}): Problem {
  return problem({
    id: 'interview-rag-evaluation',
    kind: 'interview',
    title: 'RAG 中如何评估检索质量与生成质量？',
    difficulty: 'medium',
    tags: ['RAG', '评估'],
    content: '请从离线指标、在线指标和失败分析三个层面回答。',
    interview: {
      contentOrigin: 'builtin',
      primaryRole: 'llm-app',
      roles: ['llm-app', 'rag-agent'],
      category: 'RAG 评估',
      format: 'scenario',
      keyPoints: ['检索侧使用 Recall@K 与 nDCG', '生成侧检查事实一致性与引用完整性', '端到端结合业务任务成功率'],
      referenceAnswer: '完整评估需要分别观察检索召回、生成事实一致性和端到端任务成功率，并结合失败样本持续校准。',
      followUps: ['没有标准答案时，怎样评估事实一致性？'],
    },
    ...overrides,
  });
}

describe('面试洞察与 AI 教练', () => {
  it('出题官提示包含主题、岗位和严格的结构化题目契约', () => {
    const promptText = buildInterviewExaminerPrompt({
      topic: 'Transformer',
      role: '大语言模型算法工程师',
      difficulty: 'hard',
      count: 3,
    });

    expect(promptText).toContain('Transformer');
    expect(promptText).toContain('大语言模型算法工程师');
    expect(promptText).toContain('questions');
    expect(promptText).toContain('referenceAnswer');
    expect(promptText).toContain('followUps');
    expect(promptText).toContain('只输出一个合法 JSON 对象');
  });

  it('出题官可以解析带代码围栏的结构化结果', () => {
    const parsed = parseInterviewExaminerResponse(`\`\`\`json
      {
        "topic": "Transformer",
        "overview": "从注意力机制到训练与推理优化",
        "checkpoints": ["自注意力", "位置编码"],
        "questions": [{
          "title": "为什么自注意力需要除以根号 d_k？",
          "category": "注意力机制",
          "format": "knowledge",
          "difficulty": "medium",
          "tags": ["Transformer", "Attention"],
          "keyPoints": ["点积方差", "Softmax 饱和", "梯度稳定性"],
          "referenceAnswer": "缩放可以控制点积分布的方差，避免 Softmax 过早饱和并保持梯度稳定。",
          "followUps": ["如果不用缩放会观察到什么现象？"]
        }]
      }
    \`\`\``);

    expect(parsed.topic).toBe('Transformer');
    expect(parsed.checkpoints).toEqual(['自注意力', '位置编码']);
    expect(parsed.questions[0]).toMatchObject({
      title: '为什么自注意力需要除以根号 d_k？',
      format: 'knowledge',
      difficulty: 'medium',
    });
  });

  it('面试提示包含用户回答、参考要点、题目意图和严格输出规则', () => {
    const current = interviewProblem();
    const promptText = buildInterviewPrompt({
      intent: 'interview-critique',
      problem: current,
      answerText: '我会先看 Recall@K，再做人工抽检。',
    });

    expect(promptText).toContain('我会先看 Recall@K，再做人工抽检。');
    expect(promptText).toContain(current.interview!.keyPoints[0]);
    expect(promptText).toContain('点评当前回答');
    expect(promptText).toContain('不要直接复述参考答案');
  });

  it('追问提示只生成一个递进问题并结合内置追问', () => {
    const promptText = buildInterviewPrompt({
      intent: 'interview-follow-up',
      problem: interviewProblem(),
      answerText: '我会用离线指标评估。',
    });

    expect(promptText).toContain('只提出一个');
    expect(promptText).toContain('没有标准答案时，怎样评估事实一致性？');
  });

  it('独立统计面试完成、掌握、到期复习和薄弱岗位', () => {
    const now = 2_000;
    const rag = interviewProblem();
    const backend = interviewProblem({
      id: 'interview-backend-lock',
      title: '如何定位分布式锁失效？',
      interview: {
        ...interviewProblem().interview!,
        primaryRole: 'backend',
        roles: ['backend'],
        category: '分布式系统',
      },
    });
    const statistics = calculateInterviewStatistics(
      [rag, backend, problem()],
      [
        attempt({ id: 'a1', problemId: rag.id, mode: 'interview', result: 'mastered', durationSeconds: 120 }),
        attempt({ id: 'a2', problemId: backend.id, mode: 'interview', result: 'uncertain', durationSeconds: 60 }),
        attempt({ id: 'a3', problemId: 'problem-1', mode: 'code', result: 'accepted', durationSeconds: 30 }),
      ],
      [mistake({ id: 'm1', problemId: backend.id, nextReviewAt: now - 1, status: 'active' })],
      now,
    );

    expect(statistics).toMatchObject({
      totalQuestions: 2,
      practicedQuestions: 2,
      masteredQuestions: 1,
      totalAttempts: 2,
      totalFocusSeconds: 180,
      activeMistakes: 1,
      dueReviews: 1,
    });
    expect(statistics.weakRoles[0]).toMatchObject({ role: 'backend', attempts: 1, failures: 1 });
    expect(statistics.byCategory).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'RAG 评估', practiced: 1, mastered: 1 }),
      expect.objectContaining({ category: '分布式系统', practiced: 1, mastered: 0 }),
    ]));
  });
});
