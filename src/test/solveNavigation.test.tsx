import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot } from '../lib/data';
import { SolvePage } from '../pages/SolvePage';
import { useAppStore } from '../store/useAppStore';
import type { Problem } from '../types';

HTMLDialogElement.prototype.close ??= function close() {
  this.removeAttribute('open');
};

HTMLDialogElement.prototype.showModal ??= function showModal() {
  this.setAttribute('open', '');
};

vi.mock('../lib/localMonaco', () => ({
  default: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange?: (value: string) => void;
    options?: { fontSize?: number };
  }) => (
    <textarea
      aria-label="代码编辑器 Mock"
      data-font-size={String(options?.fontSize ?? '')}
      style={{ fontSize: options?.fontSize ? `${options.fontSize}px` : undefined }}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

function algorithmProblem(overrides: Partial<Problem>): Problem {
  const now = 100;
  return {
    id: 'algo-base',
    kind: 'algorithm',
    title: '算法题',
    source: 'manual',
    difficulty: 'medium',
    tags: ['数组'],
    content: '这是一道算法题题面。',
    constraints: [],
    examples: [{ input: '1 2', output: '3' }],
    attachments: [],
    platformStatus: 'todo',
    cacheStatus: 'manual',
    importMethod: 'manual',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const interviewProblem: Problem = {
  ...algorithmProblem({ id: 'interview-rag', title: 'RAG 面试题', tags: ['RAG'], examples: [] }),
  kind: 'interview',
  interview: {
    contentOrigin: 'builtin',
    primaryRole: 'llm-app',
    roles: ['llm-app'],
    category: 'RAG',
    format: 'knowledge',
    keyPoints: ['检索', '生成', '评估'],
    referenceAnswer: '从检索、生成和端到端评估回答。',
    followUps: ['如何评估幻觉？'],
  },
};

beforeEach(() => {
  const empty = createEmptySnapshot(100);
  useAppStore.setState({
    ...empty,
    problems: [
      interviewProblem,
      algorithmProblem({ id: 'algo-two-sum', title: '两数之和', externalId: '1', tags: ['哈希表'] }),
      algorithmProblem({ id: 'algo-lis', title: '最长递增子序列', externalId: '300', tags: ['动态规划'] }),
      { ...algorithmProblem({ id: 'legacy-algo', title: '旧版无 kind 题' }), kind: undefined as never },
    ],
    initialized: true,
    loading: false,
    error: null,
    currentAttemptId: null,
  });
});

afterEach(() => cleanup());

describe('做题页题库导航', () => {
  it('直接打开做题页时恢复上次关闭前的题目', async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, lastSolveProblemId: 'algo-lis' } as typeof state.settings,
    }));

    render(
      <MemoryRouter initialEntries={['/solve']}>
        <Routes><Route path="/solve" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /300\. 最长递增子序列/ })).toBeVisible();
  });

  it('没有开始计时时也会保存非第一题的代码草稿', async () => {
    const draftCode = 'int lengthOfLIS(vector<int>& nums) { return 7; }';
    const first = render(
      <MemoryRouter initialEntries={['/solve/algo-lis']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    const editor = await screen.findByLabelText('代码编辑器 Mock') as HTMLTextAreaElement;
    expect(useAppStore.getState().attempts.filter((item) => item.problemId === 'algo-lis')).toHaveLength(0);

    fireEvent.change(editor, { target: { value: draftCode } });

    await waitFor(() => {
      const draft = useAppStore.getState().attempts.find((item) => item.problemId === 'algo-lis');
      expect(draft?.code).toBe(draftCode);
    });

    first.unmount();

    render(
      <MemoryRouter initialEntries={['/solve/algo-lis']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('代码编辑器 Mock')).toHaveValue(draftCode);
  });

  it('做题页不把 AI 解惑做成一键分析按钮', async () => {
    render(
      <MemoryRouter initialEntries={['/solve/algo-lis']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('向 AI 代码教练提问')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /AI 解惑/ })).not.toBeInTheDocument();
    expect(screen.queryByText('检查边界')).not.toBeInTheDocument();
  });

  it('AI 解惑由输入问题触发', async () => {
    const requestAiHint = vi.fn(async (_payload: unknown) => '这里用哈希表是为了把查找补数从 O(n) 降到 O(1)。');
    useAppStore.setState((state) => ({
      requestAiHint,
      settings: {
        ...state.settings,
        hasAiCredential: true,
        aiModel: 'mock-model',
        privacyConfirmed: true,
      } as typeof state.settings,
    }));

    render(
      <MemoryRouter initialEntries={['/solve/algo-two-sum']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    const input = await screen.findByLabelText('向 AI 代码教练提问');
    fireEvent.change(input, { target: { value: '为什么这里要用哈希表？' } });
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));

    await waitFor(() => expect(requestAiHint).toHaveBeenCalledTimes(1));
    expect(requestAiHint.mock.calls[0][0]).toMatchObject({
      problemId: 'algo-two-sum',
      intent: 'explain',
      userQuestion: '为什么这里要用哈希表？',
    });
    expect(await screen.findByText(/这里用哈希表/)).toBeInTheDocument();
  });

  it('重新打开做题页后恢复每个功能已经保存的 AI 回答', async () => {
    const requestAiHint = vi.fn(async () => '不应该再次请求');
    useAppStore.setState((state) => ({
      requestAiHint,
      aiGenerations: [{
        id: 'ai-algorithm-logic',
        problemId: 'algo-lis',
        level: 3,
        intent: 'algorithm-logic',
        prompt: '算法逻辑拆解',
        response: '先定义 dp[i]，再解释状态转移为什么成立。',
        model: 'mock-model',
        createdAt: 101,
      }],
      settings: {
        ...state.settings,
        hasAiCredential: false,
        aiModel: '',
        privacyConfirmed: true,
      } as typeof state.settings,
    }));

    const first = render(
      <MemoryRouter initialEntries={['/solve/algo-lis']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/先定义 dp\[i\]/)).toBeInTheDocument();
    first.unmount();

    render(
      <MemoryRouter initialEntries={['/solve/algo-lis']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    const savedAction = await within(screen.getByLabelText('AI 代码教练快捷操作'))
      .findByRole('button', { name: /算法逻辑拆解/ });
    expect(savedAction).toHaveAttribute('data-cached', 'true');
    expect(savedAction).toBeEnabled();
    fireEvent.click(savedAction);

    expect(await screen.findByText(/先定义 dp\[i\]/)).toBeInTheDocument();
    expect(requestAiHint).not.toHaveBeenCalled();
  });

  it('可以从长回答末尾回到当前回答开头', async () => {
    useAppStore.setState((state) => ({
      aiGenerations: [{
        id: 'ai-long-answer',
        problemId: 'algo-lis',
        level: 3,
        intent: 'algorithm-logic',
        prompt: '算法逻辑拆解',
        response: Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 段算法解释`).join('\n\n'),
        model: 'mock-model',
        createdAt: 101,
      }],
      settings: { ...state.settings, privacyConfirmed: true } as typeof state.settings,
    }));

    render(
      <MemoryRouter initialEntries={['/solve/algo-lis']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    const panel = await screen.findByLabelText('AI 回答记录');
    const jump = await screen.findByRole('button', { name: '回到“算法逻辑拆解”回答开头' });
    const turn = jump.closest('article');
    expect(turn).not.toBeNull();

    panel.scrollTop = 500;
    panel.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
    if (turn) turn.getBoundingClientRect = () => ({ top: -220 } as DOMRect);
    const scrollTo = vi.fn();
    panel.scrollTo = scrollTo;

    fireEvent.click(jump);

    expect(scrollTo).toHaveBeenCalledWith({ top: 172, behavior: 'smooth' });
  });

  it('AI 解惑复用同一问题的回答，不同问题仍继续请求', async () => {
    const requestAiHint = vi.fn(async (_payload: unknown) => '因为哈希表把补数查找降为均摊 O(1)。');
    useAppStore.setState((state) => ({
      requestAiHint,
      aiGenerations: [{
        id: 'ai-explain-existing',
        problemId: 'algo-two-sum',
        level: 3,
        intent: 'explain',
        userQuestion: '为什么先查再放？',
        prompt: 'AI 解惑',
        response: '先查再放可以避免同一个元素和自己配对。',
        model: 'mock-model',
        createdAt: 102,
      }],
      settings: {
        ...state.settings,
        hasAiCredential: true,
        aiModel: 'mock-model',
        privacyConfirmed: true,
      } as typeof state.settings,
    }));

    render(
      <MemoryRouter initialEntries={['/solve/algo-two-sum']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    const input = await screen.findByLabelText('向 AI 代码教练提问');
    fireEvent.change(input, { target: { value: '为什么先查再放？' } });
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    expect(await screen.findByText(/避免同一个元素和自己配对/)).toBeInTheDocument();
    expect(requestAiHint).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '为什么这里要用哈希表？' } });
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));

    await waitFor(() => expect(requestAiHint).toHaveBeenCalledTimes(1));
    expect(requestAiHint.mock.calls[0][0]).toMatchObject({
      problemId: 'algo-two-sum',
      intent: 'explain',
      userQuestion: '为什么这里要用哈希表？',
    });
    expect(await screen.findByText(/均摊 O\(1\)/)).toBeInTheDocument();
  });

  it('可以调节代码编辑器字号并保存到本地设置', async () => {
    render(
      <MemoryRouter initialEntries={['/solve/algo-two-sum']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    const editor = await screen.findByLabelText('代码编辑器 Mock');
    expect(editor).toHaveAttribute('data-font-size', '16');

    const fontPicker = screen.getByRole('combobox', { name: '代码字号' }) as HTMLSelectElement;
    expect(fontPicker).toHaveValue('16');

    fireEvent.change(fontPicker, { target: { value: '20' } });

    await waitFor(() => expect(screen.getByLabelText('代码编辑器 Mock')).toHaveAttribute('data-font-size', '20'));
    expect((useAppStore.getState().settings as { editorFontSize?: number }).editorFontSize).toBe(20);
  });

  it('长题面通过独立阅读层完整显示并保留换行', async () => {
    const longContent = `第一段：题目背景。\n\n第二段：输入限制。\n${'边界条件需要完整展示。\n'.repeat(40)}\n最后一段：返回最终结果。`;
    useAppStore.setState((state) => ({
      problems: state.problems.map((item) => item.id === 'algo-two-sum' ? { ...item, content: longContent } : item),
    }));
    render(
      <MemoryRouter initialEntries={['/solve/algo-two-sum']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '显示全文' }));
    const reader = await screen.findByRole('dialog', { name: /1\. 两数之和/ });

    expect(reader).toHaveAttribute('open');
    expect(within(reader).getByLabelText('完整题目内容')).toHaveTextContent('第一段：题目背景。');
    expect(within(reader).getByLabelText('完整题目内容')).toHaveTextContent('最后一段：返回最终结果。');

    fireEvent.click(within(reader).getByRole('button', { name: '关闭题面阅读' }));
    expect(reader).not.toHaveAttribute('open');
  });

  it('可以从算法题库选择题目，并用上一题下一题切换', async () => {
    render(
      <MemoryRouter initialEntries={['/solve/algo-lis']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /300\. 最长递增子序列/ })).toBeVisible();
    const picker = screen.getByRole('combobox', { name: '选择题库题目' }) as HTMLSelectElement;
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      '○ 未练习 · 1. 两数之和',
      '○ 未练习 · 300. 最长递增子序列',
      '○ 未练习 · 旧版无 kind 题',
    ]);
    expect(screen.queryByText('RAG 面试题')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '上一题' }));
    expect(await screen.findByRole('heading', { name: /1\. 两数之和/ })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '下一题' }));
    expect(await screen.findByRole('heading', { name: /300\. 最长递增子序列/ })).toBeVisible();

    fireEvent.change(screen.getByRole('combobox', { name: '选择题库题目' }), { target: { value: 'legacy-algo' } });
    expect(await screen.findByRole('heading', { name: /旧版无 kind 题/ })).toBeVisible();
  });

  it('题库选择器标记已练习和未练习的算法题', async () => {
    useAppStore.setState((state) => ({
      attempts: [{
        id: 'attempt-two-sum', problemId: 'algo-two-sum', mode: 'code', language: 'cpp', code: '', startedAt: 200, durationSeconds: 12,
        result: 'unfinished', hintLevel: 0, independent: true, mastery: 1, createdAt: 200, updatedAt: 200,
      }],
    }));

    render(
      <MemoryRouter initialEntries={['/solve/algo-two-sum']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    const picker = await screen.findByRole('combobox', { name: '选择题库题目' });
    expect(within(picker).getByRole('option', { name: '✓ 已练习 · 1. 两数之和' })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: '○ 未练习 · 300. 最长递增子序列' })).toBeInTheDocument();
  });

  it('运行全部样例通过后自动完成练习并保存成功记录', async () => {
    const runProblemSample = vi.fn(async ({ sampleIndex = 0 }: { sampleIndex?: number }) => ({
      ok: true,
      output: sampleIndex === 0 ? '3' : '7',
      durationMs: 2,
      timedOut: false,
      sampleIndex,
      expectedOutput: sampleIndex === 0 ? '3' : '7',
      actualOutput: sampleIndex === 0 ? '3' : '7',
      passed: true,
      generatedEntryPoint: true,
      mode: 'function' as const,
    }));
    useAppStore.setState((state) => ({
      runProblemSample,
      problems: state.problems.map((item) => item.id === 'algo-two-sum'
        ? { ...item, examples: [{ input: '1 2', output: '3' }, { input: '3 4', output: '7' }] }
        : item),
    }));

    render(
      <MemoryRouter initialEntries={['/solve/algo-two-sum']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '运行全部样例' }));

    await waitFor(() => {
      const saved = useAppStore.getState().attempts.find((item) => item.problemId === 'algo-two-sum');
      expect(saved).toMatchObject({ result: 'sample-passed' });
      expect(saved?.endedAt).toEqual(expect.any(Number));
    });
    expect(runProblemSample).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('全部样例通过，练习已自动完成。')).toBeInTheDocument();
    expect(screen.queryByText('结束练习')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '样例通过' })).not.toBeInTheDocument();
  });

  it('切换题目时不会把上一题的签名误存进新题的草稿', async () => {
    useAppStore.setState((state) => ({
      problems: [
        algorithmProblem({
          id: 'algo-two-sum',
          title: '两数之和',
          externalId: '1',
          tags: ['哈希表'],
          codeSnippets: [{ language: 'Python3', languageSlug: 'python3', code: 'class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        ' }],
        }),
        algorithmProblem({
          id: 'algo-lis',
          title: '最长递增子序列',
          externalId: '300',
          tags: ['动态规划'],
          codeSnippets: [{ language: 'Python3', languageSlug: 'python3', code: 'class Solution:\n    def lengthOfLIS(self, nums: List[int]) -> int:\n        ' }],
        }),
      ],
      settings: { ...state.settings, defaultLanguage: 'python' } as typeof state.settings,
    }));

    const first = render(
      <MemoryRouter initialEntries={['/solve/algo-two-sum']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    const editor = await screen.findByLabelText('代码编辑器 Mock') as HTMLTextAreaElement;
    expect(editor.value).toContain('twoSum');

    // 通过下拉框直接切换到另一道题：旧的编辑器内容不应被存成新题的草稿
    fireEvent.change(screen.getByRole('combobox', { name: '选择题库题目' }), { target: { value: 'algo-lis' } });
    await screen.findByRole('heading', { name: /300\. 最长递增子序列/ });

    await waitFor(() => {
      const lisDrafts = useAppStore.getState().attempts.filter((item) => item.problemId === 'algo-lis');
      expect(lisDrafts).toHaveLength(0);
    });

    // 用户真正输入后，草稿才按当前题目保存
    const lisEditor = await screen.findByLabelText('代码编辑器 Mock') as HTMLTextAreaElement;
    expect(lisEditor.value).toContain('lengthOfLIS');
    fireEvent.change(lisEditor, { target: { value: 'class Solution:\n    def lengthOfLIS(self, nums: List[int]) -> int:\n        return 1\n' } });

    await waitFor(() => {
      const draft = useAppStore.getState().attempts.find((item) => item.problemId === 'algo-lis');
      expect(draft?.code).toContain('lengthOfLIS');
    });
    first.unmount();
  });

  it('目标题已有上一题官方模板草稿时自动恢复当前题签名', async () => {
    const medianTemplate = 'class Solution:\n    def findMedianSortedArrays(self, nums1: List[int], nums2: List[int]) -> float:\n        ';
    const palindromeTemplate = 'class Solution:\n    def longestPalindrome(self, s: str) -> str:\n        ';
    useAppStore.setState((state) => ({
      problems: [
        algorithmProblem({
          id: 'algo-median',
          title: '寻找两个正序数组的中位数',
          externalId: '4',
          codeSnippets: [{ language: 'Python3', languageSlug: 'python3', code: medianTemplate }],
        }),
        algorithmProblem({
          id: 'algo-palindrome',
          title: '最长回文子串',
          externalId: '5',
          codeSnippets: [{ language: 'Python3', languageSlug: 'python3', code: palindromeTemplate }],
        }),
      ],
      attempts: [
        {
          id: 'attempt-median',
          problemId: 'algo-median',
          mode: 'code',
          language: 'python',
          code: medianTemplate,
          startedAt: 200,
          durationSeconds: 0,
          result: 'unfinished',
          hintLevel: 0,
          independent: true,
          mastery: 1,
          createdAt: 200,
          updatedAt: 200,
        },
        {
          id: 'attempt-palindrome-stale',
          problemId: 'algo-palindrome',
          mode: 'code',
          language: 'python',
          code: medianTemplate,
          startedAt: 201,
          durationSeconds: 0,
          result: 'unfinished',
          hintLevel: 0,
          independent: true,
          mastery: 1,
          createdAt: 201,
          updatedAt: 201,
        },
      ],
      settings: { ...state.settings, defaultLanguage: 'python' } as typeof state.settings,
    }));

    render(
      <MemoryRouter initialEntries={['/solve/algo-median']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('代码编辑器 Mock')).toHaveValue(medianTemplate);
    fireEvent.change(screen.getByRole('combobox', { name: '选择题库题目' }), { target: { value: 'algo-palindrome' } });

    expect(await screen.findByRole('heading', { name: /5\. 最长回文子串/ })).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('代码编辑器 Mock')).toHaveValue(palindromeTemplate));
    await waitFor(() => {
      expect(useAppStore.getState().attempts.find((item) => item.id === 'attempt-palindrome-stale')?.code).toBe(palindromeTemplate);
    });
    expect(useAppStore.getState().attempts.find((item) => item.id === 'attempt-median')?.code).toBe(medianTemplate);
  });
});
