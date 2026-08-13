import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  importPlatformProblems: vi.fn(),
}));

vi.mock('../app/storeAdapter', () => ({
  sourceLabel: (source: string) => ({ 'leetcode-cn': '力扣', leetcode: 'LeetCode', nowcoder: '牛客' }[source] ?? source),
  useStoreView: () => ({
    problems: [],
    attempts: [],
    mistakes: [],
    knowledgeNotes: [],
    dailyPlans: [],
    thoughtEvents: [],
    aiGenerations: [],
    settings: {},
    importPlatformProblems: mocks.importPlatformProblems,
    cancelPlatformProblemImport: vi.fn(),
  }),
}));

import { PlatformsPage } from '../pages/PlatformsPage';

describe('平台批量导入', () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.importPlatformProblems.mockReset();
    mocks.importPlatformProblems.mockResolvedValue({
      source: 'leetcode-cn',
      requestedCount: 3,
      fetchedCount: 2,
      paidOnlyCount: 0,
      notFoundCount: 1,
      failedCount: 0,
      cancelled: false,
      addedCount: 2,
      updatedCount: 0,
      skippedCount: 0,
      items: [{ requestedId: '3', status: 'not-found', error: '公开题库目录中没有找到该题号' }],
    });
  });

  it('按输入范围调用导入并展示部分失败结果', async () => {
    render(<PlatformsPage />);

    fireEvent.change(screen.getByLabelText('起始题号'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('结束题号'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '开始导入' }));

    await waitFor(() => expect(mocks.importPlatformProblems).toHaveBeenCalledWith(
      { source: 'leetcode-cn', startId: 1, endId: 3 },
      expect.any(Function),
    ));
    expect(await screen.findByText('2', { selector: 'strong' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看 1 条失败明细' }));
    expect(screen.getByText('公开题库目录中没有找到该题号')).toBeInTheDocument();
  });

  it('牛客范围超过五十道时在本地阻止请求', async () => {
    render(<PlatformsPage />);

    fireEvent.change(screen.getByLabelText('平台'), { target: { value: 'nowcoder' } });
    fireEvent.change(screen.getByLabelText('起始题号'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('结束题号'), { target: { value: '51' } });
    fireEvent.click(screen.getByRole('button', { name: '开始导入' }));

    expect(await screen.findByText('当前平台单次最多导入 50 道题，请缩小范围。')).toBeInTheDocument();
    expect(mocks.importPlatformProblems).not.toHaveBeenCalled();
  });
});
