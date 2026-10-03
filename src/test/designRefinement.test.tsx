import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayPage } from '../pages/TodayPage';
import { SolvePage } from '../pages/SolvePage';
import { createEmptySnapshot } from '../lib/data';
import { useAppStore } from '../store/useAppStore';
import type { Problem } from '../types';

HTMLDialogElement.prototype.close ??= function close() {
  this.removeAttribute('open');
};

HTMLDialogElement.prototype.showModal ??= function showModal() {
  this.setAttribute('open', '');
};

vi.mock('../app/storeAdapter', async () => {
  const actual = await vi.importActual<typeof import('../app/storeAdapter')>('../app/storeAdapter');
  return {
    ...actual,
    useStoreView: () => useAppStore.getState(),
  };
});

vi.mock('../lib/localMonaco', () => ({
  default: ({ defaultValue, onChange }: { defaultValue: string; onChange?: (value: string) => void }) => (
    <textarea aria-label="代码编辑器 Mock" defaultValue={defaultValue} onChange={(event) => onChange?.(event.target.value)} />
  ),
}));

const problem: Problem = {
  id: 'design-refinement-problem',
  kind: 'algorithm',
  title: '两数之和',
  source: 'manual',
  difficulty: 'easy',
  tags: ['数组'],
  content: '给定数组，返回目标结果。',
  constraints: [],
  examples: [{ input: '1 2', output: '3' }],
  attachments: [],
  platformStatus: 'todo',
  cacheStatus: 'manual',
  importMethod: 'manual',
  createdAt: 100,
  updatedAt: 100,
};

beforeEach(() => {
  useAppStore.setState({
    ...createEmptySnapshot(100),
    initialized: true,
    loading: false,
    error: null,
    problems: [problem],
  });
});

afterEach(() => cleanup());

describe('Proofline 视觉收敛回归', () => {
  it('今日页首屏标题直接说明当前任务', () => {
    render(<MemoryRouter><TodayPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '今日任务', level: 1 })).toBeVisible();
  });

  it('未配置 AI 时不渲染快捷动作矩阵', async () => {
    render(
      <MemoryRouter initialEntries={['/solve/design-refinement-problem']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('AI 反馈按需开启')).toBeVisible();
    expect(screen.queryByRole('button', { name: '分析当前代码' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '算法逻辑拆解' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '给下一段提示' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '解释运行问题' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '给完整代码' })).not.toBeInTheDocument();
  });
});
