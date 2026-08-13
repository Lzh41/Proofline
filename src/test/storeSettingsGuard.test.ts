import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptySnapshot } from '../lib/data';
import { useAppStore } from '../store/useAppStore';

describe('设置持久化保护', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      ...createEmptySnapshot(100),
      initialized: false,
      loading: true,
      error: null,
      currentAttemptId: null,
    });
  });

  it('个人数据尚未加载完成时不修改或保存空快照', async () => {
    await useAppStore.getState().updateSettings({ theme: 'light' });

    expect(useAppStore.getState().settings.theme).toBe('dark');
    expect(localStorage.getItem('xiti.app-data.v1')).toBeNull();
  });
});
