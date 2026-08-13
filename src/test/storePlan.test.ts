import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot } from '../lib/data';

const repository = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  isReadOnly: vi.fn(() => false),
}));

vi.mock('../lib/repository', () => ({
  appRepository: repository,
  READ_ONLY_REPOSITORY_MESSAGE: '只读',
}));

import { useAppStore } from '../store/useAppStore';

describe('每日计划目标保存', () => {
  beforeEach(() => {
    useAppStore.setState({
      ...createEmptySnapshot(100),
      initialized: true,
      loading: false,
      error: null,
      currentAttemptId: null,
    });
    repository.save.mockReset().mockResolvedValue(undefined);
    repository.isReadOnly.mockReturnValue(false);
  });

  it('兼容旧调用：targetProblems 全部视为算法目标', async () => {
    const plan = await useAppStore.getState().savePlan({ targetProblems: 4 });

    expect(plan).toMatchObject({
      targetProblems: 4,
      targetAlgorithmProblems: 4,
      targetInterviewQuestions: 0,
    });
  });

  it('新调用始终从两个分项目标重算总数', async () => {
    const plan = await useAppStore.getState().savePlan({
      targetProblems: 99,
      targetAlgorithmProblems: 2,
      targetInterviewQuestions: 3,
    });

    expect(plan).toMatchObject({
      targetProblems: 5,
      targetAlgorithmProblems: 2,
      targetInterviewQuestions: 3,
    });
  });

  it.each([
    { targetAlgorithmProblems: -1, targetInterviewQuestions: 2 },
    { targetAlgorithmProblems: 1.5, targetInterviewQuestions: 2 },
    { targetAlgorithmProblems: 1, targetInterviewQuestions: Number.NaN },
    { targetProblems: -1 },
  ])('拒绝非负整数以外的目标：%j', async (input) => {
    await expect(useAppStore.getState().savePlan(input)).rejects.toThrow(/非负整数/);
    expect(repository.save).not.toHaveBeenCalled();
  });
});
