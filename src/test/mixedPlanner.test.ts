import { describe, expect, it } from 'vitest';
import { generatePlan } from '../lib/planner';
import { mistake, problem } from './fixtures';

describe('混合每日计划', () => {
  it('优先安排到期面试复习并分别补齐两类目标', () => {
    const problems = [
      problem({ id: 'algorithm-due', title: '到期算法题', kind: 'algorithm' }),
      problem({ id: 'algorithm-new', title: '新算法题', kind: 'algorithm', createdAt: 101 }),
      problem({ id: 'interview-due', title: '到期面试题', kind: 'interview', source: 'manual' }),
      problem({ id: 'interview-overflow', title: '超出面试配额的到期题', kind: 'interview', source: 'manual' }),
      problem({ id: 'interview-new', title: '新面试题', kind: 'interview', source: 'manual', createdAt: 102 }),
    ];
    const mistakes = [
      mistake({ id: 'mistake-algorithm', problemId: 'algorithm-due', nextReviewAt: 80 }),
      mistake({ id: 'mistake-interview', problemId: 'interview-due', nextReviewAt: 90 }),
      mistake({ id: 'mistake-overflow', problemId: 'interview-overflow', nextReviewAt: 95 }),
    ];

    const plan = generatePlan(problems, [], mistakes, {
      now: 100,
      targetAlgorithmProblems: 2,
      targetInterviewQuestions: 1,
    });

    expect(plan.targetProblems).toBe(3);
    expect(plan.targetAlgorithmProblems).toBe(2);
    expect(plan.targetInterviewQuestions).toBe(1);
    expect(plan.taskProblemIds[0]).toBe('interview-due');
    expect(plan.taskProblemIds).toHaveLength(3);
    expect(plan.taskProblemIds.filter((id) => problems.find((item) => item.id === id)?.kind === 'algorithm')).toHaveLength(2);
    expect(plan.taskProblemIds.filter((id) => problems.find((item) => item.id === id)?.kind === 'interview')).toHaveLength(1);
    expect(plan.reviewMistakeIds).toEqual(['mistake-interview', 'mistake-algorithm']);
    expect(plan.taskProblemIds).not.toContain('interview-overflow');
  });

  it('旧 targetProblems 选项只生成算法题目标', () => {
    const plan = generatePlan(
      [problem(), problem({ id: 'interview-1', kind: 'interview', source: 'manual' })],
      [],
      [],
      { now: 100, targetProblems: 1 },
    );

    expect(plan.targetProblems).toBe(1);
    expect(plan.targetAlgorithmProblems).toBe(1);
    expect(plan.targetInterviewQuestions).toBe(0);
    expect(plan.taskProblemIds).toEqual(['problem-1']);
  });
});
