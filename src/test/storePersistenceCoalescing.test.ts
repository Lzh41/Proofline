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
import type { AppDataSnapshot } from '../types';

describe('保存合并（同一时刻只有一个持久化循环）', () => {
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

  it('一次写入进行中到达的多个保存请求合并为一次补写，且都等到最新状态落盘', async () => {
    const snapshots: AppDataSnapshot[] = [];
    let releaseFirstSave: () => void = () => undefined;
    let markFirstSaveEntered: () => void = () => undefined;
    const firstSaveEntered = new Promise<void>((resolve) => { markFirstSaveEntered = resolve; });
    const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });

    repository.save.mockImplementation(async (snapshot: AppDataSnapshot) => {
      snapshots.push(snapshot);
      if (snapshots.length === 1) {
        markFirstSaveEntered();
        await firstSaveGate;
      }
    });

    const first = useAppStore.getState().updateSettings({ dailyTargetProblems: 1 });
    await firstSaveEntered;

    // 第一次写入仍在进行中时连发三个请求：都应被合并进同一次补写。
    const queued = [
      useAppStore.getState().updateSettings({ dailyTargetProblems: 2 }),
      useAppStore.getState().updateSettings({ dailyTargetProblems: 3 }),
      useAppStore.getState().updateSettings({ dailyTargetProblems: 4 }),
    ];
    // 让这三个请求完成「登记版本号」的微任务步骤。
    await Promise.resolve();
    await Promise.resolve();

    releaseFirstSave();
    await Promise.all([first, ...queued]);

    expect(snapshots).toHaveLength(2);
    expect(snapshots[snapshots.length - 1].settings.dailyTargetProblems).toBe(4);
    expect(useAppStore.getState().settings.dailyTargetProblems).toBe(4);
    expect(useAppStore.getState().error).toBeNull();
  });

  it('保存失败时向所有等待方抛出并记录错误，恢复后仍能正常保存', async () => {
    repository.save.mockRejectedValueOnce(new Error('SQLite 保存失败'));

    await expect(useAppStore.getState().updateSettings({ dailyTargetProblems: 7 })).rejects.toThrow('SQLite 保存失败');
    expect(useAppStore.getState().error).toContain('本地数据保存失败');

    repository.save.mockResolvedValue(undefined);
    await expect(useAppStore.getState().updateSettings({ dailyTargetProblems: 8 })).resolves.toBeUndefined();
    expect(useAppStore.getState().error).toBeNull();
    expect(repository.save).toHaveBeenCalledTimes(2);
  });
});
