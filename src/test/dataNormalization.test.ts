import { describe, expect, it } from 'vitest';
import { normalizeSnapshot } from '../lib/data';

const legacySchema1Snapshot = {
  schemaVersion: 1,
  problems: [{
    id: 'legacy-problem',
    title: '旧算法题',
    source: 'manual',
    difficulty: 'easy',
    tags: [],
    content: '题面',
    constraints: [],
    examples: [],
    attachments: [],
    platformStatus: 'todo',
    cacheStatus: 'manual',
    importMethod: 'manual',
    createdAt: 100,
    updatedAt: 100,
  }],
  attempts: [{
    id: 'legacy-attempt',
    problemId: 'legacy-problem',
    language: 'cpp',
    code: '',
    startedAt: 100,
    durationSeconds: 30,
    result: 'unfinished',
    hintLevel: 0,
    independent: true,
    mastery: 1,
    createdAt: 100,
    updatedAt: 100,
  }],
  thoughtEvents: [],
  platformResults: [],
  mistakes: [],
  knowledgeNotes: [],
  codeTemplates: [],
  dailyPlans: [{
    id: 'legacy-plan',
    date: '2026-07-23',
    targetMinutes: 60,
    targetProblems: 4,
    taskProblemIds: ['legacy-problem'],
    reviewMistakeIds: [],
    completedProblemIds: [],
    focusTags: [],
    difficultyRatio: { easy: 30, medium: 50, hard: 20 },
    createdAt: 100,
    updatedAt: 100,
  }],
  aiGenerations: [],
  settings: {
    aiBaseUrl: 'https://api.openai.com/v1',
    aiModel: '',
    hasAiCredential: false,
    defaultLanguage: 'cpp',
    dailyTargetMinutes: 60,
    dailyTargetProblems: 3,
    privacyConfirmed: false,
    theme: 'dark',
  },
  updatedAt: 100,
} as const;

describe('数据快照规范化', () => {
  it('用真实 schema 1 字面量迁移旧计划的算法目标', () => {
    const snapshot = normalizeSnapshot(legacySchema1Snapshot);

    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.problems[0].kind).toBe('algorithm');
    expect(snapshot.attempts[0].mode).toBe('code');
    expect(snapshot.dailyPlans[0]).toMatchObject({
      targetProblems: 4,
      targetAlgorithmProblems: 4,
      targetInterviewQuestions: 0,
    });
  });

  it.each([null, 1, 'snapshot', [], true])('拒绝非快照对象：%j', (value) => {
    expect(() => normalizeSnapshot(value)).toThrow(/快照.*对象/);
  });

  it('拒绝未来 schema，避免把新格式静默降级', () => {
    expect(() => normalizeSnapshot({ schemaVersion: 3 })).toThrow(/schema.*3/i);
  });

  it.each([
    ['problems', { schemaVersion: 2, problems: [null] }],
    ['attempts', { schemaVersion: 2, attempts: [null] }],
    ['dailyPlans', { schemaVersion: 2, dailyPlans: [null] }],
  ])('拒绝 %s 中的 null 元素并指出位置', (field, value) => {
    expect(() => normalizeSnapshot(value)).toThrow(`${field}[0]`);
  });

  it('拒绝未知题目 kind 和尝试 mode', () => {
    expect(() => normalizeSnapshot({ schemaVersion: 2, problems: [{ kind: 'essay' }] }))
      .toThrow(/problems\[0\].*kind/);
    expect(() => normalizeSnapshot({ schemaVersion: 2, attempts: [{ mode: 'voice' }] }))
      .toThrow(/attempts\[0\].*mode/);
  });
});
