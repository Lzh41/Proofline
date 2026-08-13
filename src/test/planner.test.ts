import { describe, expect, it } from 'vitest';
import { generatePlan } from '../lib/planner';
import { attempt, mistake, problem } from './fixtures';

describe('每日计划', () => {
  it('优先排入到期复习，再补齐薄弱标签题目', () => {
    const problems = [
      problem(),
      problem({ id: 'problem-2', title: '最长子串', sourceUrl: undefined, externalId: '3', tags: ['滑动窗口'], difficulty: 'medium' }),
      problem({ id: 'problem-3', title: '窗口变体', sourceUrl: undefined, externalId: '76', tags: ['滑动窗口'], difficulty: 'hard' }),
    ];
    const attempts = [attempt({ problemId: 'problem-2', result: 'sample-failed' })];
    const plan = generatePlan(problems, attempts, [mistake({ nextReviewAt: 99 })], { now: 100, targetProblems: 2 });
    expect(plan.taskProblemIds[0]).toBe('problem-1');
    expect(plan.taskProblemIds).toContain('problem-3');
    expect(plan.reviewMistakeIds).toEqual(['mistake-1']);
    expect(plan.focusTags).toContain('滑动窗口');
  });
});
