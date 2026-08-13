import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot } from '../lib/data';
import { InterviewPracticePage } from '../pages/InterviewPracticePage';
import { InterviewsPage } from '../pages/InterviewsPage';
import { ProblemsPage } from '../pages/ProblemsPage';
import { useAppStore } from '../store/useAppStore';
import type { Attempt, Problem } from '../types';

const algorithmProblem: Problem = {
  id: 'algo-two-sum',
  kind: 'algorithm',
  title: '两数之和',
  source: 'leetcode-cn',
  externalId: '1',
  difficulty: 'easy',
  tags: ['数组', '哈希表'],
  content: '给定一个整数数组 nums 和一个整数目标值 target，请你在该数组中找出和为目标值 target 的两个整数。',
  constraints: [],
  examples: [{ input: 'nums = [2,7,11,15], target = 9', output: '[0,1]' }],
  attachments: [],
  platformStatus: 'todo',
  cacheStatus: 'fresh',
  importMethod: 'platform',
  createdAt: 100,
  updatedAt: 100,
};

const ragProblem: Problem = {
  id: 'interview-rag-evaluation',
  kind: 'interview',
  title: 'RAG 中如何评估检索质量与生成质量？',
  source: 'manual',
  difficulty: 'medium',
  tags: ['RAG', '评估'],
  content: '请从检索、生成和端到端三个层面回答。',
  constraints: [],
  examples: [],
  attachments: [],
  platformStatus: 'todo',
  cacheStatus: 'manual',
  importMethod: 'import',
  interview: {
    contentOrigin: 'builtin',
    primaryRole: 'llm-app',
    roles: ['llm-app', 'rag-agent'],
    category: 'RAG 评估',
    format: 'scenario',
    keyPoints: ['检索侧使用 Recall@K 和 nDCG', '生成侧检查事实一致性与引用', '端到端结合业务成功率'],
    referenceAnswer: '评估需要拆成检索、生成和端到端三层。检索侧关注候选覆盖和排序；生成侧评估相关性、事实一致性和引用完整性；最后用任务成功率与人工抽检校准自动指标，并持续分析失败样本。',
    followUps: ['没有标准答案时怎样评估事实一致性？'],
  },
  createdAt: 100,
  updatedAt: 100,
};

const backendProblem: Problem = {
  ...ragProblem,
  id: 'interview-backend-cache',
  title: '如何设计缓存一致性方案？',
  tags: ['缓存', '一致性'],
  interview: {
    ...ragProblem.interview!,
    primaryRole: 'backend',
    roles: ['backend'],
    category: '分布式系统',
  },
};

beforeEach(() => {
  const empty = createEmptySnapshot(100);
  useAppStore.setState({
    ...empty,
    problems: [algorithmProblem, ragProblem, backendProblem],
    initialized: true,
    loading: false,
    error: null,
    currentAttemptId: null,
  });
});

afterEach(() => cleanup());

describe('企业面试工作台', () => {
  it('个人题库只展示算法题，面试题留在面试工作台', () => {
    render(<MemoryRouter><ProblemsPage /></MemoryRouter>);

    expect(screen.getByRole('button', { name: `开始 ${algorithmProblem.title}` })).toBeVisible();
    expect(screen.queryByRole('button', { name: `开始 ${ragProblem.title}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `开始 ${backendProblem.title}` })).not.toBeInTheDocument();
  });

  it('可以按现代岗位筛选并打开题目', () => {
    render(
      <MemoryRouter initialEntries={['/interviews']}>
        <Routes>
          <Route path="/interviews" element={<InterviewsPage />} />
          <Route path="/interviews/:id" element={<div>已进入面试练习</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /大语言模型应用开发/ }));
    expect(screen.getByText(ragProblem.title)).toBeVisible();
    expect(screen.queryByText(backendProblem.title)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `练习：${ragProblem.title}` }));
    expect(screen.getByText('已进入面试练习')).toBeVisible();
  });

  it('练习后返回时保留原来的岗位和分类筛选', async () => {
    render(
      <MemoryRouter initialEntries={['/interviews']}>
        <Routes>
          <Route path="/interviews" element={<InterviewsPage />} />
          <Route path="/interviews/:id" element={<InterviewPracticePage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /大语言模型应用开发/ }));
    fireEvent.change(screen.getByRole('combobox', { name: '知识分类' }), { target: { value: 'RAG 评估' } });
    expect(screen.queryByText(backendProblem.title)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `练习：${ragProblem.title}` }));
    fireEvent.click(await screen.findByRole('button', { name: '返回面试题库' }));

    expect(await screen.findByRole('combobox', { name: '知识分类' })).toHaveValue('RAG 评估');
    expect(screen.getByRole('button', { name: /大语言模型应用开发/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(backendProblem.title)).not.toBeInTheDocument();
  });

  it('存在空白未结束记录时仍在回答框恢复最近提交的答案', () => {
    const answeredAttempt: Attempt = {
      id: 'attempt-answered',
      problemId: ragProblem.id,
      mode: 'interview',
      language: 'text',
      code: '',
      startedAt: 100,
      endedAt: 300,
      durationSeconds: 200,
      result: 'mastered',
      hintLevel: 0,
      independent: true,
      mastery: 5,
      interview: { answerText: '这是上一次已经提交并需要继续保留的回答。', masteryResult: 'mastered' },
      createdAt: 100,
      updatedAt: 300,
    };
    const blankOpenAttempt: Attempt = {
      ...answeredAttempt,
      id: 'attempt-blank-open',
      endedAt: undefined,
      result: 'unfinished',
      mastery: 1,
      interview: { answerText: '' },
      createdAt: 400,
      updatedAt: 400,
    };
    useAppStore.setState({ attempts: [blankOpenAttempt, answeredAttempt] });

    render(
      <MemoryRouter initialEntries={[`/interviews/${ragProblem.id}`]}>
        <Routes><Route path="/interviews/:id" element={<InterviewPracticePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('textbox', { name: '我的回答' })).toHaveValue('这是上一次已经提交并需要继续保留的回答。');
  });

  it('AI 出题官生成后可以勾选保存到个人面试题库', async () => {
    const generated = {
      topic: 'Transformer',
      overview: '覆盖结构、训练与推理优化。',
      checkpoints: ['自注意力', '位置编码'],
      questions: [{
        title: '为什么自注意力需要除以根号 d_k？',
        category: '注意力机制',
        format: 'knowledge' as const,
        difficulty: 'medium' as const,
        tags: ['Transformer', 'Attention'],
        keyPoints: ['点积方差', 'Softmax 饱和', '梯度稳定性'],
        referenceAnswer: '缩放可以控制点积分布的方差，避免 Softmax 过早饱和。',
        followUps: ['如果不缩放会怎样？'],
      }],
    };
    const requestInterviewExaminer = vi.fn(async () => generated);
    const addProblem = vi.fn(async () => ragProblem);
    useAppStore.setState({
      requestInterviewExaminer,
      addProblem,
      settings: {
        ...useAppStore.getState().settings,
        hasAiCredential: true,
        aiModel: 'mock-model',
        privacyConfirmed: true,
      },
    } as never);
    render(<MemoryRouter><InterviewsPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'AI 面试出题官' }));
    fireEvent.change(screen.getByRole('textbox', { name: '技术主题' }), { target: { value: 'Transformer' } });
    fireEvent.click(screen.getByRole('button', { name: '生成面试考点' }));

    expect(await screen.findByText('为什么自注意力需要除以根号 d_k？')).toBeVisible();
    expect(screen.getByText('自注意力')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '加入个人题库' }));

    await waitFor(() => expect(addProblem).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'interview',
      title: '为什么自注意力需要除以根号 d_k？',
      importMethod: 'import',
      interview: expect.objectContaining({ contentOrigin: 'ai' }),
    })));
  });

  it('没有 AI 密钥也能提交回答、查看参考内容并记录掌握度', async () => {
    const interviewAttempt: Attempt = {
      id: 'attempt-interview',
      problemId: ragProblem.id,
      mode: 'interview',
      language: 'text',
      code: '',
      startedAt: 100,
      durationSeconds: 0,
      result: 'unfinished',
      hintLevel: 0,
      independent: true,
      mastery: 1,
      interview: { answerText: '' },
      createdAt: 100,
      updatedAt: 100,
    };
    const startInterviewAttempt = vi.fn(async () => interviewAttempt);
    const saveInterviewDraft = vi.fn(async () => undefined);
    const finishInterviewAttempt = vi.fn(async () => undefined);
    useAppStore.setState({ startInterviewAttempt, saveInterviewDraft, finishInterviewAttempt } as never);

    render(
      <MemoryRouter initialEntries={[`/interviews/${ragProblem.id}`]}>
        <Routes><Route path="/interviews/:id" element={<InterviewPracticePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: '点评回答' })).toBeDisabled();
    await screen.findByText('自动保存');
    fireEvent.change(screen.getByRole('textbox', { name: '我的回答' }), { target: { value: '我会先看检索召回，再评估事实一致性。' } });
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }));

    expect(saveInterviewDraft).toHaveBeenCalledWith(
      interviewAttempt.id,
      '我会先看检索召回，再评估事实一致性。',
    );
    expect(await screen.findByText('参考要点')).toBeVisible();
    expect(screen.getByText(ragProblem.interview!.referenceAnswer)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '还需巩固' }));
    await waitFor(() => expect(finishInterviewAttempt).toHaveBeenCalledWith(
      interviewAttempt.id,
      expect.objectContaining({ masteryResult: 'uncertain' }),
    ));
  });

  it('可以建立完整的个人面试题', async () => {
    const addProblem = vi.fn(async () => ragProblem);
    useAppStore.setState({ addProblem } as never);
    render(<MemoryRouter><InterviewsPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '新增面试题' }));
    fireEvent.change(screen.getByRole('textbox', { name: '题目' }), { target: { value: '如何设计模型灰度发布方案？' } });
    fireEvent.change(screen.getByRole('textbox', { name: '知识分类' }), { target: { value: '模型发布' } });
    fireEvent.change(screen.getByRole('textbox', { name: '参考要点' }), { target: { value: '流量分层\n指标守护\n自动回滚' } });
    fireEvent.change(screen.getByRole('textbox', { name: '完整参考答案' }), { target: { value: '先按用户和流量维度建立稳定分层，再同时观察质量、延迟、错误率与成本指标。发布过程需要保留对照组，明确自动暂停和回滚阈值，并保证模型、提示词、特征和配置都可以追溯。出现异常后先止损，再根据版本与请求链路定位影响范围。' } });
    fireEvent.change(screen.getByRole('textbox', { name: '追问' }), { target: { value: '如何避免实验组相互污染？' } });
    fireEvent.click(screen.getByRole('button', { name: '保存面试题' }));

    await waitFor(() => expect(addProblem).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'interview',
      title: '如何设计模型灰度发布方案？',
      interview: expect.objectContaining({ keyPoints: ['流量分层', '指标守护', '自动回滚'] }),
    })));
  });
});
