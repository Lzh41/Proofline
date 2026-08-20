import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot } from '../lib/data';
import { SolvePage, visibleStickyScopes } from '../pages/SolvePage';
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
    defaultValue,
    onChange,
    options,
  }: {
    defaultValue: string;
    onChange?: (value: string) => void;
    options?: {
      fontSize?: number;
      stickyScroll?: { enabled?: boolean; maxLineCount?: number; defaultModel?: string };
      tabCompletion?: string;
      quickSuggestions?: unknown;
    };
  }) => {
    const editorRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
      if (editorRef.current && editorRef.current.value !== defaultValue) editorRef.current.value = defaultValue;
    }, [defaultValue]);
    return (
      <textarea
        ref={editorRef}
        aria-label="代码编辑器 Mock"
        data-font-size={String(options?.fontSize ?? '')}
        data-sticky-scroll={String(options?.stickyScroll?.enabled ?? false)}
        data-sticky-max-lines={String(options?.stickyScroll?.maxLineCount ?? '')}
        data-sticky-model={String(options?.stickyScroll?.defaultModel ?? '')}
        data-tab-completion={String(options?.tabCompletion ?? '')}
        data-quick-suggestions={String(options?.quickSuggestions !== undefined)}
        style={{ fontSize: options?.fontSize ? `${options.fontSize}px` : undefined }}
        defaultValue={defaultValue}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  },
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
  it('按语言识别当前函数和类作用域，供 sticky 标题使用', () => {
    const cppLines = `class Solver {
public:
    int add(int a, int b) {
        return a + b;
    }
};
int helper(int value) {
    return value * 2;
}`.split('\n');
    expect(visibleStickyScopes(cppLines, 'cpp', 4).map((scope) => scope.label)).toEqual(['class Solver', 'add()']);

    const pythonLines = `class Solver:
    def add(self, value):
        return value + 1

def helper(value):
    return value * 2`.split('\n');
    expect(visibleStickyScopes(pythonLines, 'python', 3).map((scope) => scope.label)).toEqual(['class Solver', 'add()']);

    const scriptLines = `class Solver {
  add(value) {
    return value + 1;
  }
}
const helper = (value) => value * 2;`.split('\n');
    expect(visibleStickyScopes(scriptLines, 'javascript', 3).map((scope) => scope.label)).toEqual(['class Solver', 'add()']);

    const deeplyNestedLines = `class Outer {
  method() {
    if (ready) {
      nested() {
        return true;
      }
    }
  }
}`.split('\n');
    expect(visibleStickyScopes(deeplyNestedLines, 'javascript', 6).map((scope) => scope.label)).toEqual(['class Outer', 'method()', 'nested()']);

    const typeLines = `interface Solver {
  value: number;
}
const helper = (value: number): number => value * 2;`.split('\n');
    expect(visibleStickyScopes(typeLines, 'typescript', 2).map((scope) => scope.label)).toEqual(['interface Solver']);
  });

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

    const explainShortcut = screen.getByRole('button', { name: 'AI 解惑' });
    expect(explainShortcut).toBeInTheDocument();
    fireEvent.click(explainShortcut);
    expect(await screen.findByLabelText('向 AI 代码教练提问')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('向 AI 代码教练提问')).toHaveFocus());
    expect(screen.queryByText('检查边界')).not.toBeInTheDocument();
  });

  it('默认只显示当前教练模块，AI 解惑输入仅属于解惑模块', async () => {
    render(
      <MemoryRouter initialEntries={['/solve/algo-lis']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('AI 代码教练快捷操作')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: '重新生成回答' })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'AI 解惑' }));
    expect(screen.getByRole('region', { name: 'AI 解惑对话' })).toBeVisible();
    expect(screen.getByText('AI 解惑输入')).toBeVisible();
    expect(Array.from(document.querySelectorAll<HTMLElement>('[data-ai-module]')).map((module) => module.dataset.aiModule))
      .toEqual(['explain']);
    expect(screen.getByLabelText('向 AI 代码教练提问').closest('[data-ai-module]'))
      .toHaveAttribute('data-ai-module', 'explain');
  });

  it('点击不同教练模块时只切换当前模块的回答', async () => {
    useAppStore.setState((state) => ({
      aiGenerations: [
        {
          id: 'ai-logic-visible', problemId: 'algo-lis', level: 3, intent: 'algorithm-logic',
          prompt: '算法逻辑拆解', response: '逻辑模块回答', model: 'mock-model', createdAt: 101,
        },
        {
          id: 'ai-next-visible', problemId: 'algo-lis', level: 2, intent: 'next-code',
          prompt: '给下一段提示', response: '下一段模块回答', model: 'mock-model', createdAt: 102,
        },
      ],
      settings: { ...state.settings, privacyConfirmed: true } as typeof state.settings,
    }));

    render(
      <MemoryRouter initialEntries={['/solve/algo-lis']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('下一段模块回答')).toBeInTheDocument();
    expect(screen.queryByText('逻辑模块回答')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /算法逻辑拆解/ }));
    expect(await screen.findByText('逻辑模块回答')).toBeInTheDocument();
    expect(screen.queryByText('下一段模块回答')).not.toBeInTheDocument();
    expect(document.querySelectorAll<HTMLElement>('[data-ai-module]')).toHaveLength(1);
    expect(document.querySelector('[data-ai-module]')).toHaveAttribute('data-ai-module', 'algorithm-logic');
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

    fireEvent.click(screen.getByRole('button', { name: 'AI 解惑' }));
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

  it('五个教练功能重新生成后只显示最新回答', async () => {
    const requestAiHint = vi.fn(async ({ intent }: { intent?: string }) => `重新生成的${intent ?? '回答'}`);
    useAppStore.setState((state) => ({
      requestAiHint,
      aiGenerations: [
        {
          id: 'ai-logic-old', problemId: 'algo-lis', level: 3, intent: 'algorithm-logic',
          prompt: '算法逻辑拆解', response: '旧的逻辑拆解答案', model: 'mock-model', createdAt: 101,
        },
        {
          id: 'ai-next-old', problemId: 'algo-lis', level: 2, intent: 'next-code',
          prompt: '给下一段提示', response: '旧的下一步提示答案', model: 'mock-model', createdAt: 102,
        },
      ],
      settings: {
        ...state.settings,
        hasAiCredential: true,
        aiModel: 'mock-model',
        privacyConfirmed: true,
      } as typeof state.settings,
    }));

    render(
      <MemoryRouter initialEntries={['/solve/algo-lis']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('旧的下一步提示答案')).toBeInTheDocument();
    expect(screen.queryByText('旧的逻辑拆解答案')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /算法逻辑拆解/ }));
    expect(await screen.findByText('旧的逻辑拆解答案')).toBeInTheDocument();
    expect(screen.queryByText('旧的下一步提示答案')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重新生成“算法逻辑拆解”回答' }));
    await waitFor(() => expect(requestAiHint).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('重新生成的algorithm-logic')).toBeInTheDocument();
    expect(screen.queryByText('旧的逻辑拆解答案')).not.toBeInTheDocument();
    expect(screen.queryByText('旧的下一步提示答案')).not.toBeInTheDocument();
  });

  it('AI 解惑对话模块追加保存每次提问，不覆盖之前答案', async () => {
    let answerIndex = 0;
    const requestAiHint = vi.fn(async ({ userQuestion }: { userQuestion?: string }) => {
      answerIndex += 1;
      return `回答${answerIndex}：${userQuestion}`;
    });
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

    fireEvent.click(screen.getByRole('button', { name: 'AI 解惑' }));
    const input = await screen.findByLabelText('向 AI 代码教练提问');
    fireEvent.change(input, { target: { value: '第一个问题' } });
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    await waitFor(() => expect(screen.getByText('回答1：第一个问题')).toBeInTheDocument());

    fireEvent.change(input, { target: { value: '第二个问题' } });
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
    await waitFor(() => expect(screen.getByText('回答2：第二个问题')).toBeInTheDocument());

    const explainModule = screen.getByRole('region', { name: 'AI 解惑对话' });
    expect(within(explainModule).getByText('回答1：第一个问题')).toBeInTheDocument();
    expect(within(explainModule).getByText('回答2：第二个问题')).toBeInTheDocument();
    expect(within(explainModule).getByText('2 条问答记录')).toBeInTheDocument();
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

    const panel = await screen.findByLabelText('算法逻辑拆解对话内容');
    const jump = await screen.findByRole('button', { name: '回到“算法逻辑拆解”回答开头' });
    const turn = jump.closest('article');
    expect(turn).not.toBeNull();

    panel.scrollTop = 500;
    Object.defineProperty(panel, 'offsetTop', { configurable: true, value: 0 });
    if (turn) Object.defineProperty(turn, 'offsetTop', { configurable: true, value: 180 });
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

    fireEvent.click(screen.getByRole('button', { name: 'AI 解惑' }));
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

  it('编辑器启用 sticky scroll 与 IDE 补全交互选项', async () => {
    render(
      <MemoryRouter initialEntries={['/solve/algo-two-sum']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    const editor = await screen.findByLabelText('代码编辑器 Mock');
    expect(editor).toHaveAttribute('data-sticky-scroll', 'true');
    expect(editor).toHaveAttribute('data-sticky-max-lines', '5');
    expect(editor).toHaveAttribute('data-sticky-model', 'outlineModel');
    expect(editor).toHaveAttribute('data-tab-completion', 'on');
    expect(editor).toHaveAttribute('data-quick-suggestions', 'true');
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

  it('运行结果显示在代码编辑器下方的可隐藏终端，做题页不再显示思路笔记入口', async () => {
    render(
      <MemoryRouter initialEntries={['/solve/algo-two-sum']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('思路笔记')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '运行全部样例' }));
    expect(await screen.findByTestId('sample-terminal')).toBeVisible();
    expect(screen.getByRole('log', { name: '样例运行终端' })).toBeVisible();
  });

  it('运行样例先渲染内嵌终端，再逐条更新运行进度', async () => {
      useAppStore.setState((state) => ({
        ...state,
        problems: state.problems.map((item) => item.id === 'algo-two-sum'
          ? { ...item, examples: [{ input: '1 2', output: '3' }, { input: '3 4', output: '7' }] }
          : item),
        runProblemSample: vi.fn(async ({ sampleIndex = 0 }: { sampleIndex?: number }) => ({
          ok: true,
          output: sampleIndex === 0 ? '3' : '7',
          durationMs: 1,
          timedOut: false,
          sampleIndex,
          expectedOutput: sampleIndex === 0 ? '3' : '7',
          actualOutput: sampleIndex === 0 ? '3' : '7',
          passed: true,
          generatedEntryPoint: true,
          mode: 'function' as const,
        })),
      }));

      render(
        <MemoryRouter initialEntries={['/solve/algo-two-sum']}>
          <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
        </MemoryRouter>,
      );

      fireEvent.click(await screen.findByRole('button', { name: '运行全部样例' }));
      await waitFor(() => expect(screen.getByRole('log', { name: '样例运行终端' })).toBeVisible());
      expect(screen.getByLabelText('样例运行进度')).toBeInTheDocument();
  });

  it('题库选择器只把样例全部通过的题标记为已练习', async () => {
    useAppStore.setState((state) => ({
      attempts: [{
        id: 'attempt-two-sum', problemId: 'algo-two-sum', mode: 'code', language: 'cpp', code: '', startedAt: 200, durationSeconds: 12,
        result: 'sample-passed', endedAt: 220, hintLevel: 0, independent: true, mastery: 1, createdAt: 200, updatedAt: 220,
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

  it('只有草稿或失败样例不会标记为已练习', async () => {
    useAppStore.setState((state) => ({
      attempts: [
        {
          id: 'attempt-draft', problemId: 'algo-two-sum', mode: 'code', language: 'cpp', code: 'draft', startedAt: 200, durationSeconds: 12,
          result: 'unfinished', hintLevel: 0, independent: true, mastery: 1, createdAt: 200, updatedAt: 200,
        },
        {
          id: 'attempt-failed', problemId: 'algo-lis', mode: 'code', language: 'cpp', code: 'wrong', startedAt: 201, durationSeconds: 12,
          result: 'sample-failed', endedAt: 220, hintLevel: 0, independent: true, mastery: 1, createdAt: 201, updatedAt: 220,
        },
      ],
    }));

    render(
      <MemoryRouter initialEntries={['/solve/algo-two-sum']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    const picker = await screen.findByRole('combobox', { name: '选择题库题目' });
    expect(within(picker).getByRole('option', { name: '○ 未练习 · 1. 两数之和' })).toBeInTheDocument();
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
    expect(screen.getByRole('log', { name: '样例运行终端' })).toBeVisible();

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

  it('样例运行过程中逐条显示状态，并在后续样例结束前不提前完成练习', async () => {
    let resolveSecond!: (result: {
      ok: boolean;
      output: string;
      durationMs: number;
      timedOut: boolean;
      sampleIndex: number;
      expectedOutput: string;
      actualOutput: string;
      passed: boolean;
      generatedEntryPoint: boolean;
      mode: 'function';
    }) => void;
    const secondResult = new Promise<Parameters<typeof resolveSecond>[0]>((resolve) => {
      resolveSecond = resolve;
    });
    const runProblemSample = vi.fn(({ sampleIndex = 0 }: { sampleIndex?: number }) => sampleIndex === 0
      ? Promise.resolve({
          ok: true,
          output: '3',
          durationMs: 2,
          timedOut: false,
          sampleIndex,
          expectedOutput: '3',
          actualOutput: '3',
          passed: true,
          generatedEntryPoint: true,
          mode: 'function' as const,
        })
      : secondResult);
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
      const progress = within(screen.getByLabelText('样例运行进度'));
      expect(progress.getByText('样例 1')).toBeInTheDocument();
      expect(progress.getByText('通过')).toBeInTheDocument();
      expect(progress.getByText('样例 2')).toBeInTheDocument();
      expect(progress.getByText('运行中')).toBeInTheDocument();
    });
    expect(useAppStore.getState().attempts.find((item) => item.problemId === 'algo-two-sum')?.result).not.toBe('sample-passed');

    resolveSecond({
      ok: true,
      output: '0',
      durationMs: 2,
      timedOut: false,
      sampleIndex: 1,
      expectedOutput: '7',
      actualOutput: '0',
      passed: false,
      generatedEntryPoint: true,
      mode: 'function',
    });
    await waitFor(() => expect(within(screen.getByLabelText('样例运行进度')).getByText('未通过')).toBeInTheDocument());
    expect(runProblemSample).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().attempts.find((item) => item.problemId === 'algo-two-sum')?.result).not.toBe('sample-passed');
  });

  it('运行样例固定启动时的代码快照，编辑器不会被练习记录创建覆盖', async () => {
    let resolveRun!: (result: {
      ok: boolean;
      output: string;
      durationMs: number;
      timedOut: boolean;
      sampleIndex: number;
      expectedOutput: string;
      actualOutput: string;
      passed: boolean;
      generatedEntryPoint: boolean;
      mode: 'function';
    }) => void;
    const runPending = new Promise<Parameters<typeof resolveRun>[0]>((resolve) => {
      resolveRun = resolve;
    });
    const runProblemSample = vi.fn(({ code }: { code: string }) => {
      expect(code).toContain('custom solution');
      return runPending;
    });
    useAppStore.setState((state) => ({ ...state, runProblemSample }));

    render(
      <MemoryRouter initialEntries={['/solve/algo-two-sum']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    const editor = await screen.findByLabelText('代码编辑器 Mock') as HTMLTextAreaElement;
    const launchCode = '// custom solution\nint solve() { return 3; }';
    fireEvent.change(editor, { target: { value: launchCode } });
    const runButton = await screen.findByRole('button', { name: '运行全部样例' });
    fireEvent.click(runButton);
    fireEvent.click(runButton);

    await waitFor(() => expect(runProblemSample).toHaveBeenCalledTimes(1));
    expect(runProblemSample.mock.calls[0][0].code).toBe(launchCode);
    expect(editor).toHaveValue(launchCode);

    const editedWhileRunning = `${launchCode}\n// edited while running`;
    fireEvent.change(editor, { target: { value: editedWhileRunning } });
    expect(editor).toHaveValue(editedWhileRunning);
    resolveRun({
      ok: true,
      output: '0',
      durationMs: 2,
      timedOut: false,
      sampleIndex: 0,
      expectedOutput: '3',
      actualOutput: '0',
      passed: false,
      generatedEntryPoint: true,
      mode: 'function',
    });
    await waitFor(() => expect(within(screen.getByLabelText('样例运行进度')).getByText('未通过')).toBeInTheDocument());
    expect(editor).toHaveValue(editedWhileRunning);
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

  it('做题工作台默认隐藏终端并提供可访问的布局拖动分隔条', async () => {
    render(
      <MemoryRouter initialEntries={['/solve/algo-two-sum']}>
        <Routes><Route path="/solve/:id" element={<SolvePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /1\. 两数之和/ })).toBeVisible();
    expect(screen.getByTestId('problem-area-resizer')).toHaveAttribute('aria-label', '调整题干区高度');
    expect(screen.getByTestId('problem-text-resizer')).toHaveAttribute('aria-orientation', 'vertical');
    expect(screen.getByTestId('workbench-resizer')).toHaveAttribute('aria-label', '调整代码区和 AI 教练区宽度');
    const terminalResizer = screen.getByTestId('terminal-resizer');
    expect(terminalResizer).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(screen.getByTestId('workbench-resizer'), { key: 'ArrowRight' });
    expect(screen.getByTestId('workbench-resizer').parentElement?.style.getPropertyValue('--workbench-code-column')).toBe('544px');

    fireEvent.click(screen.getByRole('button', { name: '显示运行终端' }));
    expect(screen.getByTestId('terminal-resizer')).toHaveAttribute('tabindex', '0');
  });
});
