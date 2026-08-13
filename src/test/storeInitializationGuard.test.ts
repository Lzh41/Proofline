import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('个人数据初始化失败保护', () => {
  beforeEach(() => {
    useAppStore.setState({
      ...createEmptySnapshot(100),
      initialized: false,
      loading: false,
      error: null,
      currentAttemptId: null,
    });
    repository.load.mockReset();
    repository.save.mockReset();
    repository.isReadOnly.mockReset().mockReturnValue(false);
  });

  it('读取失败后保持不可写状态，等待用户刷新重试', async () => {
    repository.load.mockRejectedValueOnce(new Error('数据库正忙'));

    await useAppStore.getState().initialize();

    expect(useAppStore.getState().initialized).toBe(false);
    expect(useAppStore.getState().loading).toBe(false);
    expect(useAppStore.getState().error).toBe('数据库正忙');
  });

  it('加载最终失败时拒绝所有提前排队的写操作且不污染状态', async () => {
    let rejectLoad!: (error: Error) => void;
    repository.load.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectLoad = reject;
    }));
    const problemsBefore = useAppStore.getState().problems;
    const updatedAtBefore = useAppStore.getState().updatedAt;

    const initializePromise = useAppStore.getState().initialize();
    const addPromise = useAppStore.getState().addProblem({ id: 'queued-problem', title: '不应写入' });
    const updatePromise = useAppStore.getState().updateProblem('missing-problem', { title: '同样不应写入' });
    const addOutcome = addPromise.then(() => null, (error: unknown) => error);
    const updateOutcome = updatePromise.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1));
    rejectLoad(new Error('数据库正忙'));

    await initializePromise;
    const [addError, updateError] = await Promise.all([addOutcome, updateOutcome]);

    expect(addError).toMatchObject({ message: '数据库正忙' });
    expect(updateError).toMatchObject({ message: '数据库正忙' });
    expect(repository.save).not.toHaveBeenCalled();
    expect(useAppStore.getState().problems).toBe(problemsBefore);
    expect(useAppStore.getState().updatedAt).toBe(updatedAtBefore);
    expect(useAppStore.getState().error).toBe('数据库正忙');
  });

  it('缓存回退为只读时允许浏览但不回填样例并在更新前拒绝写入', async () => {
    const cached = createEmptySnapshot(100);
    cached.problems = [{
      id: 'cached-problem',
      kind: 'algorithm',
      title: '缓存中的题目',
      source: 'manual',
      difficulty: 'easy',
      tags: ['数组'],
      content: '示例：\n输入：1\n输出：2',
      constraints: [],
      examples: [],
      codeSnippets: [],
      attachments: [],
      platformStatus: 'todo',
      cacheStatus: 'manual',
      importMethod: 'manual',
      createdAt: 100,
      updatedAt: 100,
    }];
    repository.load.mockResolvedValueOnce(cached);
    repository.isReadOnly.mockReturnValue(true);

    await useAppStore.getState().initialize();
    const problemsBefore = useAppStore.getState().problems;
    const updatedAtBefore = useAppStore.getState().updatedAt;

    expect(useAppStore.getState().initialized).toBe(true);
    expect(useAppStore.getState().problems).toHaveLength(1);
    expect(useAppStore.getState().problems[0]).toMatchObject({
      id: 'cached-problem',
      title: '缓存中的题目',
      examples: [],
    });
    expect(repository.save).not.toHaveBeenCalled();

    await expect(useAppStore.getState().updateProblem('cached-problem', {
      examples: [{ input: '1', output: '2' }],
    })).rejects.toThrow('只读');

    expect(repository.save).not.toHaveBeenCalled();
    expect(useAppStore.getState().problems).toBe(problemsBefore);
    expect(useAppStore.getState().updatedAt).toBe(updatedAtBefore);
    expect(useAppStore.getState().error).toContain('只读');
  });
});
