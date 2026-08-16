import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'xiti.app-data.v1';
const screenshotStamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

interface ProblemFixture {
  id: string;
  title: string;
  source: 'manual' | 'leetcode-cn';
  sourceUrl?: string;
  content: string;
  examples: Array<{ input: string; output: string; explanation?: string }>;
  sampleTestCase?: string;
}

interface RunnerCall {
  sampleIndex: number;
  input: string;
  output: string;
  exampleCount: number;
}

async function installProblem(page: Page, overrides: Partial<ProblemFixture> = {}, additionalProblems: ProblemFixture[] = []) {
  const timestamp = Date.now();
  const problem: ProblemFixture = {
    id: 'sample-editor-problem',
    title: '样例编辑测试题',
    source: 'manual',
    content: '',
    examples: [],
    ...overrides,
  };

  await page.addInitScript(({ key, now, values }) => {
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      problems: values.map((value, index) => ({
        ...value,
        externalId: `E2E-SAMPLE-${index + 1}`,
        difficulty: 'easy',
        tags: ['样例'],
        constraints: [],
        attachments: [],
        platformStatus: 'attempted',
        cacheStatus: 'manual',
        importMethod: 'manual',
        createdAt: now,
        updatedAt: now,
      })),
      attempts: [],
      thoughtEvents: [],
      platformResults: [],
      mistakes: [],
      knowledgeNotes: [],
      codeTemplates: [],
      dailyPlans: [],
      aiGenerations: [],
      settings: {
        aiBaseUrl: 'https://api.openai.com/v1',
        aiModel: '',
        hasAiCredential: false,
        defaultLanguage: 'cpp',
        dailyTargetMinutes: 60,
        dailyTargetProblems: 3,
        privacyConfirmed: false,
        theme: 'light',
      },
      updatedAt: now,
    }));
  }, { key: STORAGE_KEY, now: timestamp, values: [problem, ...additionalProblems] });

  await page.goto(`/#/solve/${problem.id}`);
  await expect(page.getByRole('heading', { name: problem.title, exact: false })).toBeVisible();
}

async function installAiCoachProbe(page: Page) {
  await page.evaluate(async () => {
    const moduleUrl = '/src/store/useAppStore.ts';
    const { useAppStore } = await import(moduleUrl);
    const seenIntents: string[] = [];
    const testWindow = window as typeof window & { __aiCoachIntents?: string[] };
    testWindow.__aiCoachIntents = seenIntents;
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        aiModel: 'e2e-model',
        hasAiCredential: true,
        privacyConfirmed: true,
      },
      requestAiHint: async (payload) => {
        seenIntents.push(String(payload.intent));
        payload.onChunk?.('状态定义');
        return '状态定义：解释算法为什么这么写。';
      },
    }));
  });
}

async function installDeferredRecoveryProbe(page: Page) {
  await page.evaluate(async () => {
    const moduleUrl = '/src/store/useAppStore.ts';
    const { useAppStore } = await import(moduleUrl);
    const recoverIds: string[] = [];
    const runnerProblemIds: string[] = [];
    let releaseRecovery: (() => void) | undefined;
    const testWindow = window as typeof window & {
      __sampleRecoverIds?: string[];
      __sampleRunnerProblemIds?: string[];
      __releaseSampleRecovery?: () => void;
    };
    testWindow.__sampleRecoverIds = recoverIds;
    testWindow.__sampleRunnerProblemIds = runnerProblemIds;
    testWindow.__releaseSampleRecovery = () => releaseRecovery?.();
    useAppStore.setState({
      recoverProblemSamples: async (id) => new Promise((resolve, reject) => {
        recoverIds.push(id);
        releaseRecovery = () => {
          const problem = useAppStore.getState().problems.find((item) => item.id === id);
          if (!problem) {
            reject(new Error('测试题目不存在'));
            return;
          }
          resolve({ ...problem, examples: [{ input: '旧题输入', output: '旧题输出' }] });
        };
      }),
      runProblemSample: async (request) => {
        runnerProblemIds.push(request.problem.id);
        return {
          ok: true,
          output: '旧题输出',
          durationMs: 1,
          timedOut: false,
          sampleIndex: 0,
          expectedOutput: '旧题输出',
          actualOutput: '旧题输出',
          passed: true,
          generatedEntryPoint: false,
          mode: 'stdin',
        };
      },
    });
  });
}

async function installDeferredRunner(page: Page) {
  await page.evaluate(async () => {
    const moduleUrl = '/src/store/useAppStore.ts';
    const { useAppStore } = await import(moduleUrl);
    let releaseRunner: (() => void) | undefined;
    const testWindow = window as typeof window & {
      __sampleRunnerStarted?: number;
      __releaseSampleRunner?: () => void;
    };
    testWindow.__sampleRunnerStarted = 0;
    testWindow.__releaseSampleRunner = () => releaseRunner?.();
    useAppStore.setState({
      recoverProblemSamples: async (id) => {
        const problem = useAppStore.getState().problems.find((item) => item.id === id);
        if (!problem) throw new Error('测试题目不存在');
        return { ...problem, examples: [{ input: '5', output: '10' }] };
      },
      runProblemSample: async () => new Promise((resolve) => {
        testWindow.__sampleRunnerStarted = (testWindow.__sampleRunnerStarted ?? 0) + 1;
        releaseRunner = () => resolve({
          ok: true,
          output: '10',
          durationMs: 1,
          timedOut: false,
          sampleIndex: 0,
          expectedOutput: '10',
          actualOutput: '10',
          passed: true,
          generatedEntryPoint: false,
          mode: 'stdin',
        });
      }),
    });
  });
}

async function installRunnerProbe(page: Page) {
  await page.evaluate(async () => {
    const moduleUrl = '/src/store/useAppStore.ts';
    const { useAppStore } = await import(moduleUrl);
    const calls: RunnerCall[] = [];
    (window as typeof window & { __sampleRunnerCalls?: RunnerCall[] }).__sampleRunnerCalls = calls;
    useAppStore.setState({
      runProblemSample: async (request) => {
        const sampleIndex = request.sampleIndex ?? 0;
        const example = request.problem.examples[sampleIndex];
        calls.push({
          sampleIndex,
          input: example?.input ?? request.problem.sampleTestCase ?? '',
          output: example?.output ?? '',
          exampleCount: request.problem.examples.length,
        });
        return {
          ok: true,
          output: example?.output ?? '',
          durationMs: 1,
          timedOut: false,
          sampleIndex,
          expectedOutput: example?.output ?? '',
          actualOutput: example?.output ?? '',
          passed: Boolean(example?.output),
          generatedEntryPoint: false,
          mode: 'stdin',
        };
      },
    });
  });
}

async function readRunnerCalls(page: Page): Promise<RunnerCall[]> {
  return page.evaluate(() => (window as typeof window & { __sampleRunnerCalls?: RunnerCall[] }).__sampleRunnerCalls ?? []);
}

async function installDelayedProblemUpdate(page: Page) {
  await page.evaluate(async () => {
    const moduleUrl = '/src/store/useAppStore.ts';
    const { useAppStore } = await import(moduleUrl);
    const originalUpdate = useAppStore.getState().updateProblem;
    let release: (() => void) | undefined;
    (window as typeof window & { __releaseSampleSave?: () => void }).__releaseSampleSave = () => release?.();
    useAppStore.setState({
      updateProblem: async (id, patch) => {
        await new Promise<void>((resolve) => { release = resolve; });
        await originalUpdate(id, patch);
      },
    });
  });
}

test('只有 sampleTestCase 时仍先恢复，缺少完整样例则不调用 runner', async ({ page }) => {
  await installProblem(page, { sampleTestCase: '仅有旧版输入' });
  await installRunnerProbe(page);

  await page.getByRole('button', { name: '运行全部样例' }).click();

  const dialog = page.getByRole('dialog', { name: '编辑样例' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('没有找到可运行的完整样例')).toBeVisible();
  await expect.poll(() => readRunnerCalls(page)).toHaveLength(0);
});

test('旧题恢复请求在切题后失效且不得覆盖新题运行状态', async ({ page }) => {
  await installProblem(page, {
    id: 'race-old',
    title: '并发旧题',
  }, [{
    id: 'race-new',
    title: '并发新题',
    source: 'manual',
    content: '新题正文',
    examples: [{ input: '9', output: '18' }],
  }]);
  await installDeferredRecoveryProbe(page);

  await page.getByRole('button', { name: '运行全部样例' }).click();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __sampleRecoverIds?: string[] }
  ).__sampleRecoverIds ?? [])).toEqual(['race-old']);

  await page.evaluate(() => { window.location.hash = '#/solve/race-new'; });
  await expect(page.getByRole('heading', { name: /并发新题/ })).toBeVisible();
  await page.evaluate(async () => {
    (window as typeof window & { __releaseSampleRecovery?: () => void }).__releaseSampleRecovery?.();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });

  await expect(page.getByRole('button', { name: '运行全部样例' })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __sampleRunnerProblemIds?: string[] }
  ).__sampleRunnerProblemIds ?? [])).toHaveLength(0);
  await page.getByRole('button', { name: '显示运行终端' }).click();
  await expect(page.getByText('还没有运行样例。', { exact: false })).toBeVisible();
  await expect(page.getByText('旧题输出', { exact: false })).not.toBeVisible();
});

test('运行期间锁定全部题面样例入口且不能改变样例', async ({ page }) => {
  await installProblem(page);
  await installDeferredRunner(page);

  await page.getByRole('button', { name: '运行全部样例' }).click();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __sampleRunnerStarted?: number }
  ).__sampleRunnerStarted ?? 0)).toBe(1);

  const problemActions = page.locator('[class*="solveProblemActions"]');
  await expect(problemActions.getByRole('button', { name: '补齐样例' })).toBeDisabled();
  const editButtons = page.getByRole('button', { name: '编辑样例' });
  await expect(editButtons).toHaveCount(2);
  await expect(editButtons.nth(0)).toBeDisabled();
  await expect(editButtons.nth(1)).toBeDisabled();
  await editButtons.nth(1).click({ force: true });
  await expect(page.getByRole('dialog', { name: '编辑样例' })).not.toBeVisible();
  await expect.poll(() => page.evaluate((key) => {
    const snapshot = JSON.parse(localStorage.getItem(key) ?? '{}');
    return snapshot.problems?.[0]?.examples;
  }, STORAGE_KEY)).toEqual([]);

  await page.evaluate(() => (window as typeof window & { __releaseSampleRunner?: () => void }).__releaseSampleRunner?.());
  await expect(page.getByText('样例 1 通过')).toBeVisible();
});

test('可新增样例，保存后运行全部样例并持久化规范化结果', async ({ page }) => {
  await installProblem(page);

  await page.locator('[class*="solveProblemActions"]').getByRole('button', { name: '编辑样例' }).click();
  const dialog = page.getByRole('dialog', { name: '编辑样例' });
  await dialog.getByLabel('样例 1 输入').fill('  2 4  ');
  await dialog.getByLabel('样例 1 预期输出').fill('  6  ');
  await dialog.getByLabel('样例 1 解释').fill('基础相加');
  await dialog.getByRole('button', { name: '新增样例' }).click();
  await dialog.getByLabel('样例 2 输入').fill('8 9');
  await dialog.getByLabel('样例 2 预期输出').fill('17');
  await dialog.getByRole('button', { name: '保存样例' }).click();

  await expect(dialog).not.toBeVisible();
  const examples = page.locator('[class*="solveExamples"]');
  await expect(examples.getByText('输入：2 4')).toBeVisible();
  await expect(examples.getByText('输出：17')).toBeVisible();
  await expect.poll(() => page.evaluate((key) => {
    const snapshot = JSON.parse(localStorage.getItem(key) ?? '{}');
    return snapshot.problems?.[0]?.examples;
  }, STORAGE_KEY)).toEqual([
    { input: '2 4', output: '6', explanation: '基础相加' },
    { input: '8 9', output: '17' },
  ]);

  await installRunnerProbe(page);
  await page.getByRole('button', { name: '运行全部样例' }).click();
  await expect(page.getByText('全部 2 条样例通过')).toBeVisible();
  await expect(page.getByText('样例 1 通过')).toBeVisible();
  await expect(page.getByText('样例 2 通过')).toBeVisible();
  await expect.poll(() => readRunnerCalls(page)).toEqual([
    { sampleIndex: 0, input: '2 4', output: '6', exampleCount: 2 },
    { sampleIndex: 1, input: '8 9', output: '17', exampleCount: 2 },
  ]);
  await page.screenshot({ path: `artifacts/proofline-all-samples-${screenshotStamp}.png`, fullPage: false });
});

test('AI 代码教练提供算法逻辑拆解入口并发送对应意图', async ({ page }) => {
  await installProblem(page, {
    title: '最长无重复子串',
    content: '给定一个字符串 s，请你找出其中不含有重复字符的最长子串的长度。',
    examples: [{ input: '"abcabcbb"', output: '3' }],
  });
  await installAiCoachProbe(page);

  await page.getByRole('button', { name: '算法逻辑拆解' }).click();

  await expect(page.getByText('状态定义：解释算法为什么这么写。')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __aiCoachIntents?: string[] }).__aiCoachIntents ?? []
  ))).toEqual(['algorithm-logic']);
});

test('删除最后一条样例后可保存空集合并回到空态', async ({ page }) => {
  await installProblem(page, { examples: [{ input: '1', output: '2' }] });

  await page.locator('[class*="solveProblemActions"]').getByRole('button', { name: '编辑样例' }).click();
  const dialog = page.getByRole('dialog', { name: '编辑样例' });
  await dialog.getByRole('button', { name: '删除样例 1' }).click();
  await expect(dialog.getByLabel('样例 1 输入')).toHaveValue('');
  await dialog.getByRole('button', { name: '保存样例' }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[class*="solveExamples"]').getByText('暂无公开样例')).toBeVisible();
  await expect.poll(() => page.evaluate((key) => {
    const snapshot = JSON.parse(localStorage.getItem(key) ?? '{}');
    return snapshot.problems?.[0]?.examples;
  }, STORAGE_KEY)).toEqual([]);
});

test('存在部分填写项时阻止保存并聚焦第一处缺失字段', async ({ page }) => {
  await installProblem(page, { examples: [{ input: '1', output: '2' }] });

  await page.locator('[class*="solveProblemActions"]').getByRole('button', { name: '编辑样例' }).click();
  const dialog = page.getByRole('dialog', { name: '编辑样例' });
  await dialog.getByRole('button', { name: '新增样例' }).click();
  await dialog.getByLabel('样例 2 输入').fill('3');
  await dialog.getByRole('button', { name: '保存样例' }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('样例 2 缺少预期输出，请补充后再保存。')).toBeVisible();
  await expect(dialog.getByLabel('样例 2 预期输出')).toBeFocused();
  await expect(dialog.getByLabel('样例 2 预期输出')).toHaveAttribute('aria-invalid', 'true');
});

test('保存进行中锁定全部编辑和关闭操作', async ({ page }) => {
  await installProblem(page);
  await installDelayedProblemUpdate(page);

  await page.locator('[class*="solveProblemActions"]').getByRole('button', { name: '编辑样例' }).click();
  const dialog = page.getByRole('dialog', { name: '编辑样例' });
  await dialog.getByLabel('样例 1 输入').fill('4');
  await dialog.getByLabel('样例 1 预期输出').fill('8');
  await dialog.getByRole('button', { name: '保存样例' }).click();

  await expect(dialog.getByRole('button', { name: '保存中' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '新增样例' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '删除样例 1' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '关闭样例编辑器' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '取消' })).toBeDisabled();
  await expect(dialog.getByLabel('样例 1 输入')).toBeDisabled();
  await expect(dialog.getByLabel('样例 1 预期输出')).toBeDisabled();
  await expect(dialog.getByLabel('样例 1 解释')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  await page.evaluate(() => (window as typeof window & { __releaseSampleSave?: () => void }).__releaseSampleSave?.());
  await expect(dialog).not.toBeVisible();
});

test('可从现有题面补齐可解析样例', async ({ page }) => {
  await installProblem(page, {
    content: '给定两个整数。\n\n样例 1\n输入：3 5\n输出：8\n解释：两数相加。',
  });

  await page.getByRole('button', { name: '补齐样例' }).click();

  await expect(page.getByText('样例已补齐，共 1 条。')).toBeVisible();
  const examples = page.locator('[class*="solveExamples"]');
  await expect(examples.getByText('输入：3 5')).toBeVisible();
  await expect(examples.getByText('输出：8')).toBeVisible();
});

test('桌面与 390px 窄屏保持单屏且长样例只在对话框内部滚动', async ({ page }) => {
  const longExamples = Array.from({ length: 20 }, (_, index) => ({
    input: `${index} ${index + 1}\n补充输入行 ${index}`,
    output: `${index * 2 + 1}`,
    explanation: `这是第 ${index + 1} 条样例的解释。`,
  }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await installProblem(page, { examples: longExamples });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/#/solve/sample-editor-problem');
    await expect(page.getByRole('heading', { name: /样例编辑测试题/ })).toBeVisible();

    const pageLayout = await page.evaluate(() => {
      const box = (part: string) => {
        const rect = document.querySelector<HTMLElement>(`[class*="${part}"]`)?.getBoundingClientRect();
        return rect ? { top: rect.top, bottom: rect.bottom } : null;
      };
      return {
        viewportHeight: document.documentElement.clientHeight,
        documentHeight: document.documentElement.scrollHeight,
        bodyHeight: document.body.scrollHeight,
        problem: box('solveProblem'),
        code: box('codeWorkbench'),
        coach: box('aiCoachPane'),
      };
    });
    expect(pageLayout.documentHeight).toBeLessThanOrEqual(pageLayout.viewportHeight);
    expect(pageLayout.bodyHeight).toBeLessThanOrEqual(pageLayout.viewportHeight);
    for (const box of [pageLayout.problem, pageLayout.code, pageLayout.coach]) {
      expect(box).toBeTruthy();
      expect(box?.top).toBeGreaterThanOrEqual(0);
      expect(box?.bottom).toBeLessThanOrEqual(pageLayout.viewportHeight);
    }

    await page.locator('[class*="solveProblemActions"]').getByRole('button', { name: '编辑样例' }).click();
    const dialog = page.getByRole('dialog', { name: '编辑样例' });
    await expect(dialog).toBeVisible();
    const dialogLayout = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const list = element.querySelector<HTMLElement>('[class*="sampleEditorList"]');
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        listClientHeight: list?.clientHeight ?? 0,
        listScrollHeight: list?.scrollHeight ?? 0,
      };
    });
    expect(dialogLayout.left).toBeGreaterThanOrEqual(0);
    expect(dialogLayout.right).toBeLessThanOrEqual(dialogLayout.viewportWidth);
    expect(dialogLayout.top).toBeGreaterThanOrEqual(0);
    expect(dialogLayout.bottom).toBeLessThanOrEqual(dialogLayout.viewportHeight);
    expect(dialogLayout.documentWidth).toBeLessThanOrEqual(dialogLayout.viewportWidth);
    expect(dialogLayout.documentHeight).toBeLessThanOrEqual(dialogLayout.viewportHeight);
    expect(dialogLayout.listScrollHeight).toBeGreaterThan(dialogLayout.listClientHeight);
    const list = dialog.locator('[class*="sampleEditorList"]');
    await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await dialog.getByRole('button', { name: '关闭样例编辑器' }).click();
  }
});

test('样例输出进入内嵌终端并支持隐藏、暂停、单步和终止调试', async ({ page }) => {
  await installProblem(page, { examples: [{ input: '1', output: '1' }] });
  await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    useAppStore.setState({
      runProblemSample: async (request) => ({
        ok: true,
        output: request.problem.examples[request.sampleIndex ?? 0]?.output ?? '1',
        durationMs: 1,
        timedOut: false,
        sampleIndex: request.sampleIndex ?? 0,
        expectedOutput: '1',
        actualOutput: '1',
        passed: true,
        generatedEntryPoint: false,
        mode: 'stdin',
      }),
    });
  });

  await page.getByRole('button', { name: '运行全部样例' }).click();
  await expect(page.getByLabel('样例运行进度')).toBeVisible();
  await page.getByRole('button', { name: '隐藏运行终端' }).click();
  await expect(page.getByLabel('样例运行进度')).not.toBeVisible();
  await page.getByRole('button', { name: '显示运行终端' }).click();
  await page.getByRole('button', { name: '调试当前样例' }).click();
  await expect(page.getByText('已暂停')).toBeVisible();
  await page.getByRole('button', { name: '单步跳过' }).click();
  await expect(page.getByText('单步')).toBeVisible();
  await page.getByRole('button', { name: '终止调试' }).click();
  await expect(page.getByText('用户终止调试会话')).toBeVisible();
});
