import { describe, expect, it } from 'vitest';
import { INTERVIEW_CATALOG, MINIMUM_ROLE_COVERAGE } from '../data/interviewCatalog';
import { createEmptySnapshot, normalizeSnapshot } from '../lib/data';
import {
  catalogItemToProblem,
  mergeInterviewCatalog,
  searchInterviewCatalog,
  validateInterviewCatalog,
  type InterviewCatalogItem,
} from '../lib/interviews';
import { calculateStatistics, isSuccessfulAttempt } from '../lib/statistics';
import { attempt, problem } from './fixtures';

describe('面试题数据兼容', () => {
  it('把旧快照规范化为算法题和代码尝试', () => {
    const now = 1_700_000_000_000;
    const empty = createEmptySnapshot(now);
    const snapshot = normalizeSnapshot({
      ...empty,
      schemaVersion: 1,
      problems: [{
        id: 'problem-legacy',
        title: '旧算法题',
        source: 'manual',
        difficulty: 'easy',
        tags: [],
        content: '',
        constraints: [],
        examples: [],
        attachments: [],
        platformStatus: 'todo',
        cacheStatus: 'manual',
        importMethod: 'manual',
        createdAt: now,
        updatedAt: now,
      }],
      attempts: [{
        id: 'attempt-legacy',
        problemId: 'problem-legacy',
        language: 'cpp',
        code: '',
        startedAt: now,
        durationSeconds: 0,
        result: 'unfinished',
        hintLevel: 0,
        independent: false,
        mastery: 1,
        createdAt: now,
        updatedAt: now,
      }],
    });

    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.problems[0].kind).toBe('algorithm');
    expect(snapshot.attempts[0].mode).toBe('code');
    expect(snapshot.settings.dailyTargetInterviewQuestions).toBe(2);
    expect(snapshot.settings.interviewCatalogVersion).toBe(0);
  });

  it('算法和面试成功结果互不污染', () => {
    expect(isSuccessfulAttempt('algorithm', 'accepted')).toBe(true);
    expect(isSuccessfulAttempt('algorithm', 'mastered')).toBe(false);
    expect(isSuccessfulAttempt('interview', 'mastered')).toBe(true);
    expect(isSuccessfulAttempt('interview', 'accepted')).toBe(false);
    expect(isSuccessfulAttempt('interview', 'uncertain')).toBe(false);
  });

  it('算法统计排除误关联到算法题的面试模式尝试', () => {
    const value = calculateStatistics(
      [problem()],
      [attempt({ mode: 'interview', result: 'mastered', durationSeconds: 90 })],
      [],
      100,
    );

    expect(value.totalAttempts).toBe(0);
    expect(value.totalFocusSeconds).toBe(0);
    expect(value.solvedProblems).toBe(0);
  });
});

const catalogItem: InterviewCatalogItem = {
  id: 'llm-rag-evaluation',
  question: 'RAG 中如何评估检索质量与生成质量？',
  primaryRole: 'llm-app',
  roles: ['llm-app', 'rag-agent'],
  category: 'RAG 评估',
  format: 'scenario',
  difficulty: 'medium',
  tags: ['RAG', '检索评估'],
  keyPoints: ['检索侧使用 Recall@K 和 nDCG', '生成侧检查事实一致性与引用', '端到端结合业务成功率'],
  referenceAnswer: '评估需要拆成检索、生成和端到端三层。检索侧用 Recall@K、MRR 与 nDCG 检查候选覆盖和排序；生成侧评估相关性、事实一致性和引用完整性；最后用任务成功率与人工抽检校准自动指标，并持续分析失败样本。数据集还要覆盖无答案、冲突证据和时效变化，按用户场景分层报告置信区间，避免平均分掩盖关键业务退化。',
  followUps: ['没有标准答案时怎样评估事实一致性？'],
};

describe('面试题目录服务', () => {
  it('汇总不少于 1050 道题并满足全部岗位最低覆盖', () => {
    expect(INTERVIEW_CATALOG.length).toBeGreaterThanOrEqual(1050);
    const counts = Object.fromEntries(Object.keys(MINIMUM_ROLE_COVERAGE).map((role) => [
      role,
      INTERVIEW_CATALOG.filter((item) => item.primaryRole === role).length,
    ]));
    for (const [role, minimum] of Object.entries(MINIMUM_ROLE_COVERAGE)) {
      expect(counts[role], `${role} 题量不足`).toBeGreaterThanOrEqual(minimum);
    }
    expect(validateInterviewCatalog(INTERVIEW_CATALOG)).toEqual([]);
  });

  it('校验完整题目并拒绝重复 ID 与空答案', () => {
    expect(validateInterviewCatalog([catalogItem])).toEqual([]);
    const errors = validateInterviewCatalog([
      catalogItem,
      { ...catalogItem, referenceAnswer: '', question: '另一道题' },
    ]);
    expect(errors.some((message) => message.includes('重复'))).toBe(true);
    expect(errors.some((message) => message.includes('参考答案'))).toBe(true);
  });

  it('参考答案必须包含至少 80 个中文汉字', () => {
    const errors = validateInterviewCatalog([{
      ...catalogItem,
      referenceAnswer: 'a'.repeat(100),
    }]);

    expect(errors.some((message) => message.includes('80 个中文汉字'))).toBe(true);
  });

  it('岗位别名和正文关键词都可以检索', () => {
    expect(searchInterviewCatalog([catalogItem], { query: '大模型' })).toHaveLength(1);
    expect(searchInterviewCatalog([catalogItem], { query: '事实一致性' })).toHaveLength(1);
    expect(searchInterviewCatalog([catalogItem], { role: 'rag-agent' })).toHaveLength(1);
    expect(searchInterviewCatalog([catalogItem], { role: 'frontend' })).toHaveLength(0);
  });

  it('目录升级使用稳定 ID 并保留用户归档状态', () => {
    const existing = catalogItemToProblem(catalogItem, 100);
    existing.interview = { ...existing.interview!, archived: true, catalogVersion: 1 };
    const upgraded = mergeInterviewCatalog([existing], [{ ...catalogItem, question: '更新后的 RAG 评估题' }], 200, 2);

    expect(upgraded).toHaveLength(1);
    expect(upgraded[0]).toMatchObject({ id: existing.id, title: '更新后的 RAG 评估题' });
    expect(upgraded[0].interview).toMatchObject({ archived: true, catalogVersion: 2 });
  });
});
