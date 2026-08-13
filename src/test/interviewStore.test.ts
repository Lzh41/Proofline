import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INTERVIEW_CATALOG, INTERVIEW_CATALOG_VERSION } from '../data/interviewCatalog';
import { createEmptySnapshot } from '../lib/data';

const repository = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  isReadOnly: vi.fn(),
}));

vi.mock('../lib/repository', () => ({
  appRepository: repository,
  READ_ONLY_REPOSITORY_MESSAGE: 'SQLite 读取失败后，本地回退数据处于只读状态；请刷新并重新连接主存储',
}));

import { useAppStore } from '../store/useAppStore';

describe('面试题 Store 学习闭环', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    useAppStore.setState({
      ...createEmptySnapshot(100),
      initialized: false,
      loading: false,
      error: null,
      currentAttemptId: null,
    });
    repository.load.mockReset().mockResolvedValue(createEmptySnapshot(100));
    repository.save.mockReset().mockResolvedValue(undefined);
    repository.isReadOnly.mockReset().mockReturnValue(false);
  });

  it('初始化幂等写入完整内置题库和目录版本', async () => {
    await useAppStore.getState().initialize();
    const firstIds = useAppStore.getState().problems.filter((item) => item.kind === 'interview').map((item) => item.id);

    expect(firstIds).toHaveLength(INTERVIEW_CATALOG.length);
    expect(new Set(firstIds).size).toBe(INTERVIEW_CATALOG.length);
    expect(useAppStore.getState().initialized).toBe(true);
    expect(useAppStore.getState().error).toBeNull();
    expect(useAppStore.getState().settings.interviewCatalogVersion).toBe(INTERVIEW_CATALOG_VERSION);
    expect(repository.save).toHaveBeenCalledTimes(1);

    await useAppStore.getState().refresh();
    const refreshedIds = useAppStore.getState().problems.filter((item) => item.kind === 'interview').map((item) => item.id);
    expect(new Set(refreshedIds).size).toBe(INTERVIEW_CATALOG.length);
  });

  it('保存面试草稿并把模糊回答加入复习', async () => {
    const now = new Date('2026-07-23T12:00:00+08:00');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    await useAppStore.getState().initialize();
    const question = useAppStore.getState().problems.find((item) => item.kind === 'interview');
    expect(question).toBeDefined();

    const attempt = await useAppStore.getState().startInterviewAttempt(question!.id);
    expect(attempt).toMatchObject({ mode: 'interview', code: '' });
    await useAppStore.getState().saveInterviewDraft(attempt.id, '我会先区分检索、生成和端到端指标。');
    await useAppStore.getState().finishInterviewAttempt(attempt.id, {
      masteryResult: 'uncertain',
      answerText: '我会先区分检索、生成和端到端指标。',
      omissions: '没有说明无标准答案时的评估方式',
      improvedAnswer: '补充人工抽检和独立评估模型校准。',
    });

    const completed = useAppStore.getState().attempts.find((item) => item.id === attempt.id);
    expect(completed).toMatchObject({ result: 'uncertain', mode: 'interview' });
    expect(completed?.interview).toMatchObject({ masteryResult: 'uncertain', omissions: '没有说明无标准答案时的评估方式' });
    const review = useAppStore.getState().mistakes.find((item) => item.problemId === question!.id);
    expect(review).toMatchObject({ category: 'incomplete', intervalDays: 1, status: 'active' });
    expect(review!.nextReviewAt).toBe(now.getTime() + 24 * 60 * 60 * 1000);
  });

  it('再次练习同一道面试题时恢复上次提交的回答', async () => {
    await useAppStore.getState().initialize();
    const question = useAppStore.getState().problems.find((item) => item.kind === 'interview');
    expect(question).toBeDefined();

    const firstAttempt = await useAppStore.getState().startInterviewAttempt(question!.id);
    await useAppStore.getState().finishInterviewAttempt(firstAttempt.id, {
      masteryResult: 'mastered',
      answerText: '这是需要在下次打开时继续显示的完整回答。',
    });

    const nextAttempt = await useAppStore.getState().startInterviewAttempt(question!.id);
    expect(nextAttempt.interview?.answerText).toBe('这是需要在下次打开时继续显示的完整回答。');
  });
});
