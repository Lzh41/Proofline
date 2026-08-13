import type { AppDataSnapshot, Attempt, Mistake, Problem } from '../types';
import { createEmptySnapshot } from '../lib/data';

export function problem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: 'problem-1',
    kind: 'algorithm',
    title: '两数之和',
    source: 'leetcode-cn',
    sourceUrl: 'https://leetcode.cn/problems/two-sum/',
    externalId: '1',
    difficulty: 'easy',
    tags: ['数组', '哈希表'],
    content: '给定数组与目标值。',
    constraints: [],
    examples: [],
    attachments: [],
    platformStatus: 'todo',
    cacheStatus: 'fresh',
    importMethod: 'connector',
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

export function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 'attempt-1',
    problemId: 'problem-1',
    mode: 'code',
    language: 'cpp',
    code: '',
    startedAt: 100,
    durationSeconds: 30,
    result: 'sample-failed',
    hintLevel: 0,
    independent: true,
    mastery: 1,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

export function mistake(overrides: Partial<Mistake> = {}): Mistake {
  return {
    id: 'mistake-1',
    problemId: 'problem-1',
    category: 'implementation',
    rootCause: '下标错误',
    correction: '检查边界',
    nextChecklistItem: '先写边界',
    reviewStage: 0,
    intervalDays: 1,
    nextReviewAt: 100,
    successfulReviews: 0,
    failedReviews: 0,
    status: 'active',
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

export function snapshot(): AppDataSnapshot {
  return createEmptySnapshot(100);
}
