import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../components/AppShell';

const mockStore = vi.hoisted(() => ({
  attempts: [] as unknown[],
  problems: [] as unknown[],
  mistakes: [] as unknown[],
  knowledgeNotes: [] as unknown[],
  dailyPlans: [] as unknown[],
  thoughtEvents: [] as unknown[],
  settings: { theme: 'dark' as const },
  initialized: true,
  loading: false,
  error: null as string | null,
  updateSettings: vi.fn(),
}));

vi.mock('../app/storeAdapter', () => ({
  useStoreView: () => mockStore,
}));

describe('应用外壳主题切换', () => {
  afterEach(cleanup);

  beforeEach(() => {
    mockStore.settings.theme = 'dark';
    mockStore.initialized = true;
    mockStore.updateSettings.mockReset();
  });

  it('保存完成前忽略重复点击，避免主题写入错序', async () => {
    let finishSave: (() => void) | undefined;
    mockStore.updateSettings.mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve; }));

    render(<MemoryRouter><AppShell><div>内容</div></AppShell></MemoryRouter>);
    const toggle = screen.getByRole('button', { name: '切换到浅色主题' });
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(mockStore.updateSettings).toHaveBeenCalledTimes(1);
    expect(toggle).toBeDisabled();

    await act(async () => { finishSave?.(); });
    expect(toggle).not.toBeDisabled();
  });

  it('主题保存失败时按钮恢复且不会泄漏未处理拒绝', async () => {
    mockStore.updateSettings.mockRejectedValueOnce(new Error('磁盘暂不可用'));

    render(<MemoryRouter><AppShell><div>内容</div></AppShell></MemoryRouter>);
    const toggle = screen.getByRole('button', { name: '切换到浅色主题' });
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(mockStore.updateSettings).toHaveBeenCalledTimes(1);
  });

  it('个人数据初始化完成前禁止主题写入', () => {
    mockStore.initialized = false;

    render(<MemoryRouter><AppShell><div>内容</div></AppShell></MemoryRouter>);
    const toggle = screen.getByRole('button', { name: '切换到浅色主题' });

    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(mockStore.updateSettings).not.toHaveBeenCalled();
  });
});
