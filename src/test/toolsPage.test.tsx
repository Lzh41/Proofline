import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalTool } from '../types';

const mocks = vi.hoisted(() => ({
  deleteLocalTool: vi.fn(),
  updateLocalTool: vi.fn(),
  createLocalTool: vi.fn(),
  probeLocalPort: vi.fn(),
  openLocalTool: vi.fn(),
  openLocalToolUrl: vi.fn(),
  stopLocalService: vi.fn(),
}));

const TOOLS: LocalTool[] = [
  {
    id: 'tool-benchlab',
    name: 'benchlab 评测看板',
    category: '评测',
    description: '跑评测时边跑边看的看板。',
    url: 'http://127.0.0.1:8777/dashboard.html',
    port: 8777,
    launchCommand: '".venv\\Scripts\\python.exe" serve.py --port 8777',
    workingDirectory: 'G:\\benchlab',
    origin: 'seed',
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'tool-mililab',
    name: 'MiliLab 集群客户端',
    category: '集群',
    description: 'SSH 集群客户端。',
    url: 'http://127.0.0.1:8787/',
    port: 8787,
    pinned: true,
    origin: 'seed',
    createdAt: 2,
    updatedAt: 2,
  },
];

vi.mock('../app/storeAdapter', () => ({
  useStoreView: () => ({
    initialized: true,
    problems: [],
    attempts: [],
    mistakes: [],
    knowledgeNotes: [],
    dailyPlans: [],
    thoughtEvents: [],
    aiGenerations: [],
    localTools: TOOLS,
    settings: {},
    deleteLocalTool: mocks.deleteLocalTool,
    updateLocalTool: mocks.updateLocalTool,
    createLocalTool: mocks.createLocalTool,
  }),
}));

vi.mock('../lib/localTools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/localTools')>();
  return {
    ...actual,
    probeLocalPort: mocks.probeLocalPort,
    openLocalTool: mocks.openLocalTool,
    openLocalToolUrl: mocks.openLocalToolUrl,
    stopLocalService: mocks.stopLocalService,
  };
});

import { ToolsPage } from '../pages/ToolsPage';

describe('本地工具页', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.probeLocalPort.mockResolvedValue(false);
    mocks.deleteLocalTool.mockResolvedValue(undefined);
    mocks.stopLocalService.mockResolvedValue([]);
  });

  it('把登记的工具和它们的启动方式都摊在卡片上', async () => {
    render(<ToolsPage />);

    expect(screen.getByText('benchlab 评测看板')).toBeInTheDocument();
    expect(screen.getByText('MiliLab 集群客户端')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:8777/dashboard.html')).toBeInTheDocument();
    expect(screen.getByText('G:\\benchlab')).toBeInTheDocument();

    await waitFor(() => expect(mocks.probeLocalPort).toHaveBeenCalledWith(8777, TOOLS[0].url));
  });

  it('在线状态按探测结果切换按钮文案', async () => {
    mocks.probeLocalPort.mockImplementation(async (port?: number) => port === 8777);
    render(<ToolsPage />);

    await waitFor(() => expect(screen.getByText('正在运行')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^打开$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /启动并打开/ })).toBeInTheDocument();
  });

  it('删除前确认，确认后调用删除', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ToolsPage />);

    fireEvent.click(screen.getByRole('button', { name: '删除MiliLab 集群客户端' }));

    await waitFor(() => expect(mocks.deleteLocalTool).toHaveBeenCalledWith('tool-mililab'));
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('取消确认就不删', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ToolsPage />);

    fireEvent.click(screen.getByRole('button', { name: '删除MiliLab 集群客户端' }));

    expect(mocks.deleteLocalTool).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('按分类筛选只留下对应工具', () => {
    render(<ToolsPage />);

    fireEvent.click(screen.getByRole('button', { name: '集群' }));

    expect(screen.getByText('MiliLab 集群客户端')).toBeInTheDocument();
    expect(screen.queryByText('benchlab 评测看板')).not.toBeInTheDocument();
  });

  it('置顶的工具排在最前面', () => {
    render(<ToolsPage />);

    const cards = screen.getAllByRole('article');
    expect(cards[0]).toHaveTextContent('MiliLab 集群客户端');
    expect(cards[1]).toHaveTextContent('benchlab 评测看板');
  });

  it('点钉住按钮切换置顶', async () => {
    render(<ToolsPage />);

    fireEvent.click(screen.getByRole('button', { name: '取消置顶MiliLab 集群客户端' }));

    await waitFor(() => expect(mocks.updateLocalTool).toHaveBeenCalledWith('tool-mililab', { pinned: false }));
  });

  it('点叉号结束占用端口的进程', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.stopLocalService.mockResolvedValue([1234]);
    render(<ToolsPage />);

    fireEvent.click(screen.getByRole('button', { name: '结束MiliLab 集群客户端的进程' }));

    await waitFor(() => expect(mocks.stopLocalService).toHaveBeenCalledWith(8787));
    confirmSpy.mockRestore();
  });
});
