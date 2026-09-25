import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot } from '../lib/data';
import { filterVocabularyWords } from '../lib/vocabulary';

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

  it('同一天按词汇方向独立保存每日计划', async () => {
    await useAppStore.getState().savePlan({ date: '2026-01-02', vocabularyDifficulty: 'cet4', targetVocabularyWords: 4 });
    await useAppStore.getState().savePlan({ date: '2026-01-02', vocabularyDifficulty: 'ielts', targetVocabularyWords: 7 });
    await useAppStore.getState().savePlan({ date: '2026-01-02', vocabularyDifficulty: 'cet4', targetVocabularyWords: 5 });

    const plans = useAppStore.getState().dailyPlans.filter((item) => item.date === '2026-01-02');
    expect(plans).toHaveLength(2);
    expect(plans.find((item) => item.vocabularyDifficulty === 'cet4')?.targetVocabularyWords).toBe(5);
    expect(plans.find((item) => item.vocabularyDifficulty === 'ielts')?.targetVocabularyWords).toBe(7);
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

  it('把同方向前一日标记不熟的词带入额外计划且不占每日目标', async () => {
    const state = createEmptySnapshot(100);
    const cet4Word = filterVocabularyWords(state.vocabularyWords, 'cet4')[0];
    const ieltsWord = filterVocabularyWords(state.vocabularyWords, 'ielts').find((word) => word.id !== cet4Word.id)!;
    state.dailyPlans = [
      {
        id: 'yesterday-cet4', date: '2026-01-01', targetMinutes: 60,
        targetProblems: 0, targetAlgorithmProblems: 0, targetInterviewQuestions: 0,
        targetVocabularyWords: 1, taskProblemIds: [], taskVocabularyWordIds: [cet4Word.id],
        reviewMistakeIds: [], completedProblemIds: [], completedVocabularyWordIds: [],
        vocabularyPreviewedWordIds: [], vocabularyUnfamiliarWordIds: [cet4Word.id], vocabularyExtraWordIds: [],
        focusTags: [], difficultyRatio: { easy: 30, medium: 50, hard: 20 },
        vocabularyDifficulty: 'cet4', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'yesterday-ielts', date: '2026-01-01', targetMinutes: 60,
        targetProblems: 0, targetAlgorithmProblems: 0, targetInterviewQuestions: 0,
        targetVocabularyWords: 1, taskProblemIds: [], taskVocabularyWordIds: [ieltsWord.id],
        reviewMistakeIds: [], completedProblemIds: [], completedVocabularyWordIds: [],
        vocabularyPreviewedWordIds: [], vocabularyUnfamiliarWordIds: [ieltsWord.id], vocabularyExtraWordIds: [],
        focusTags: [], difficultyRatio: { easy: 30, medium: 50, hard: 20 },
        vocabularyDifficulty: 'ielts', createdAt: 1, updatedAt: 1,
      },
    ];
    useAppStore.setState({ ...state, initialized: true, loading: false, error: null, currentAttemptId: null });

    const plan = await useAppStore.getState().generateDailyPlan({
      date: '2026-01-02', targetVocabularyWords: 1, vocabularyDifficulty: 'cet4',
    });

    expect(plan.vocabularyExtraWordIds).toEqual([cet4Word.id]);
    expect(plan.taskVocabularyWordIds).toContain(cet4Word.id);
    expect(plan.taskVocabularyWordIds).not.toContain(ieltsWord.id);
    expect(plan.targetVocabularyWords).toBe(1);
    expect(plan.taskVocabularyWordIds.length).toBeGreaterThan(plan.targetVocabularyWords);
  });

  it('次日计划已生成后再标记不熟也会补入额外复习，取消时移除', async () => {
    const state = createEmptySnapshot(100);
    const word = filterVocabularyWords(state.vocabularyWords, 'cet4')[0];
    const otherWord = filterVocabularyWords(state.vocabularyWords, 'cet4').find((item) => item.id !== word.id)!;
    state.dailyPlans = [
      {
        id: 'source-cet4', date: '2026-01-01', targetMinutes: 60,
        targetProblems: 0, targetAlgorithmProblems: 0, targetInterviewQuestions: 0,
        targetVocabularyWords: 1, taskProblemIds: [], taskVocabularyWordIds: [word.id],
        reviewMistakeIds: [], completedProblemIds: [], completedVocabularyWordIds: [],
        vocabularyPreviewedWordIds: [], vocabularyUnfamiliarWordIds: [], vocabularyExtraWordIds: [],
        focusTags: [], difficultyRatio: { easy: 30, medium: 50, hard: 20 },
        vocabularyDifficulty: 'cet4', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'already-generated-cet4', date: '2026-01-02', targetMinutes: 60,
        targetProblems: 0, targetAlgorithmProblems: 0, targetInterviewQuestions: 0,
        targetVocabularyWords: 1, taskProblemIds: [], taskVocabularyWordIds: [otherWord.id],
        reviewMistakeIds: [], completedProblemIds: [], completedVocabularyWordIds: [],
        vocabularyPreviewedWordIds: [], vocabularyUnfamiliarWordIds: [], vocabularyExtraWordIds: [],
        focusTags: [], difficultyRatio: { easy: 30, medium: 50, hard: 20 },
        vocabularyDifficulty: 'cet4', createdAt: 1, updatedAt: 1,
      },
    ];
    useAppStore.setState({ ...state, initialized: true, loading: false, error: null, currentAttemptId: null });

    await useAppStore.getState().markVocabularyUnfamiliar(word.id, '2026-01-01', 'cet4');
    let tomorrow = useAppStore.getState().dailyPlans.find((plan) => plan.id === 'already-generated-cet4')!;
    expect(tomorrow.vocabularyExtraWordIds).toContain(word.id);
    expect(tomorrow.taskVocabularyWordIds).toContain(word.id);
    expect(tomorrow.targetVocabularyWords).toBe(1);

    await useAppStore.getState().unmarkVocabularyUnfamiliar(word.id, '2026-01-01', 'cet4');
    tomorrow = useAppStore.getState().dailyPlans.find((plan) => plan.id === 'already-generated-cet4')!;
    expect(tomorrow.vocabularyExtraWordIds).not.toContain(word.id);
    expect(tomorrow.taskVocabularyWordIds).not.toContain(word.id);
    expect(tomorrow.taskVocabularyWordIds).toEqual([otherWord.id]);
  });

  it('取消不熟时保留次日原本安排的常规新词', async () => {
    const state = createEmptySnapshot(100);
    const word = filterVocabularyWords(state.vocabularyWords, 'cet4')[0];
    state.dailyPlans = [
      {
        id: 'source-cet4', date: '2026-01-01', targetMinutes: 60,
        targetProblems: 0, targetAlgorithmProblems: 0, targetInterviewQuestions: 0,
        targetVocabularyWords: 1, taskProblemIds: [], taskVocabularyWordIds: [word.id],
        reviewMistakeIds: [], completedProblemIds: [], completedVocabularyWordIds: [],
        vocabularyPreviewedWordIds: [], vocabularyUnfamiliarWordIds: [], vocabularyExtraWordIds: [],
        focusTags: [], difficultyRatio: { easy: 30, medium: 50, hard: 20 },
        vocabularyDifficulty: 'cet4', createdAt: 1, updatedAt: 1,
      },
      {
        id: 'already-generated-cet4', date: '2026-01-02', targetMinutes: 60,
        targetProblems: 0, targetAlgorithmProblems: 0, targetInterviewQuestions: 0,
        targetVocabularyWords: 1, taskProblemIds: [], taskVocabularyWordIds: [word.id],
        reviewMistakeIds: [], completedProblemIds: [], completedVocabularyWordIds: [],
        vocabularyPreviewedWordIds: [], vocabularyUnfamiliarWordIds: [], vocabularyExtraWordIds: [],
        focusTags: [], difficultyRatio: { easy: 30, medium: 50, hard: 20 },
        vocabularyDifficulty: 'cet4', createdAt: 1, updatedAt: 1,
      },
    ];
    useAppStore.setState({ ...state, initialized: true, loading: false, error: null, currentAttemptId: null });

    await useAppStore.getState().markVocabularyUnfamiliar(word.id, '2026-01-01', 'cet4');
    await useAppStore.getState().unmarkVocabularyUnfamiliar(word.id, '2026-01-01', 'cet4');
    const tomorrow = useAppStore.getState().dailyPlans.find((plan) => plan.id === 'already-generated-cet4')!;
    expect(tomorrow.vocabularyExtraWordIds).toEqual([]);
    expect(tomorrow.taskVocabularyWordIds).toEqual([word.id]);
  });

  it('同一个词在不同方向的复习进度分别保存', async () => {
    const word = createEmptySnapshot(100).vocabularyWords.find((item) => item.word === 'achieve')!;
    useAppStore.setState({
      ...createEmptySnapshot(100),
      initialized: true,
      loading: false,
      error: null,
      currentAttemptId: null,
    });

    await useAppStore.getState().recordVocabularyReview({
      wordId: word.id, scope: 'cet4', direction: 'meaning-to-word', rating: 'good',
      response: word.word, correct: true,
    });
    await useAppStore.getState().recordVocabularyReview({
      wordId: word.id, scope: 'cet6', direction: 'meaning-to-word', rating: 'again',
      response: '', correct: false,
    });

    const progress = useAppStore.getState().vocabularyProgress.filter((item) => item.wordId === word.id);
    expect(progress).toHaveLength(2);
    expect(progress.find((item) => item.scope === 'cet4')).toMatchObject({ state: 'learning', repetitions: 1 });
    expect(progress.find((item) => item.scope === 'cet6')).toMatchObject({ state: 'learning', repetitions: 0, lapses: 1 });
  });
});
