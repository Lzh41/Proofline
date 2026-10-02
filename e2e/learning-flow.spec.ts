import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'xiti.app-data.v1';

interface StoredSnapshot {
  problems: Array<{ id: string; title: string; content: string; tags: string[]; kind?: string }>;
  attempts: Array<{
    id: string;
    problemId: string;
    code: string;
    durationSeconds: number;
    result: string;
    endedAt?: number;
  }>;
  mistakes: Array<{
    id: string;
    problemId: string;
    intervalDays: number;
    status: string;
    failedReviews: number;
  }>;
  dailyPlans: Array<{
    date: string;
    targetMinutes: number;
    targetProblems: number;
    taskProblemIds: string[];
  }>;
  settings: {
    aiBaseUrl: string;
    aiModel: string;
    defaultLanguage: string;
    privacyConfirmed: boolean;
    hasAiCredential: boolean;
  };
}

async function openWithEmptyLocalStore(page: Page) {
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await expect(page.getByRole('heading', { name: '今天，稳稳推进。' })).toBeVisible();
  await expect(page.getByText('本地已保存')).toBeVisible();
}

async function readSnapshot(page: Page): Promise<StoredSnapshot | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as StoredSnapshot : null;
  }, STORAGE_KEY);
}

test.describe('析题个人学习闭环', () => {
  test('空库启动不会常驻任何演示题或静态假数据', async ({ page }) => {
    await openWithEmptyLocalStore(page);

    await expect(page.getByText('今天还没有题目')).toBeVisible();
    await page.getByRole('link', { name: '题库', exact: true }).click();
    // 等待 HashRouter 完成导航，避免在旧页面上读取空行数后立即触发下一次导航。
    await expect(page.getByRole('heading', { name: '函数题与完整程序题，分开练。' })).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(0);
    await expect.poll(async () => {
      const snapshot = await readSnapshot(page);
      return snapshot?.problems.filter((problem) => problem.kind !== 'interview').length ?? -1;
    }).toBe(0);
    await page.getByRole('link', { name: '面试题', exact: true }).click();
    await expect(page.getByRole('heading', { name: '把零散八股，练成可表达的答案。' })).toBeVisible();
    await expect.poll(async () => {
      const snapshot = await readSnapshot(page);
      return snapshot?.problems.filter((problem) => problem.kind === 'interview').length ?? 0;
    }).toBeGreaterThan(0);
  });

  test('从原创题卡到计时、草稿、错题复盘和今日计划均真实持久化', async ({ page }) => {
    await openWithEmptyLocalStore(page);
    const uniqueSuffix = `${Date.now()}-${test.info().workerIndex}`;
    const problemTitle = `原创测试题：能量窗口 ${uniqueSuffix}`;
    const problemContent = '给定一组整数与目标值，求和不小于目标值的最短连续区间长度；不存在时返回 0。';
    const codeDraft = 'const solve = (values, target) => values.length + target;';

    await page.getByRole('link', { name: '题库', exact: true }).click();
    await page.getByRole('button', { name: '建立学习卡' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('题目标题').fill(problemTitle);
    await dialog.getByLabel('题号').fill(`E2E-${uniqueSuffix}`);
    await dialog.getByLabel('难度').selectOption('medium');
    await dialog.getByLabel('标签').fill('滑动窗口，双指针，原创');
    await dialog.getByLabel('题目内容').fill(problemContent);
    await dialog.getByRole('button', { name: '保存学习卡' }).click();

    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: problemTitle })).toBeVisible();
    await expect.poll(async () => (await readSnapshot(page))?.problems.find((problem) => problem.title === problemTitle)).toMatchObject({
      title: problemTitle,
      content: problemContent,
      tags: ['滑动窗口', '双指针', '原创'],
    });
    const savedProblemId = (await readSnapshot(page))?.problems.find((problem) => problem.title === problemTitle)?.id;
    expect(savedProblemId).toBeTruthy();

    await page.getByRole('button', { name: `开始 ${problemTitle}` }).click();
    await expect(page.getByRole('heading', { name: problemTitle, exact: false })).toBeVisible();
    await page.getByRole('button', { name: '开始计时', exact: true }).click();
    await expect(page.getByText('计时已开始，代码和笔记会自动保存。')).toBeVisible();
    await expect(page.getByRole('button', { name: '暂停计时', exact: true })).toBeVisible();
    await page.waitForTimeout(1_100);

    const editor = page.locator('.monaco-editor');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    const editorInput = editor.locator('.native-edit-context');
    await expect(editorInput).toHaveCount(1);
    await editorInput.focus();
    await expect(editorInput).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(codeDraft);
    await expect.poll(async () => (await readSnapshot(page))?.attempts.find((attempt) => attempt.problemId === savedProblemId)?.code).toContain(codeDraft);
    // 停止计时后再直接构造失败记录，避免后台计时写入覆盖本次测试快照。
    await page.getByRole('button', { name: '暂停计时' }).click();
    await expect(page.getByRole('button', { name: '开始计时' })).toBeVisible();
    await expect.poll(async () => {
      const snapshot = await readSnapshot(page);
      return snapshot?.attempts.find((attempt) => attempt.problemId === savedProblemId)?.durationSeconds ?? 0;
    }).toBeGreaterThan(0);

    // 练习完成由“运行全部样例”自动判定；这里直接恢复一次失败记录，继续验证错题与计划的持久化链路。
    // 先离开做题页，让 pagehide 草稿补刷完成，再改写失败记录，避免离开页面时的旧快照覆盖测试数据。
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: '今天，稳稳推进。' })).toBeVisible();
    await page.evaluate(({ key, problemId }) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const snapshot = JSON.parse(raw);
      const attempt = snapshot.attempts.find((item: { problemId: string }) => item.problemId === problemId);
      if (!attempt) return;
      const now = Date.now();
      attempt.result = 'sample-failed';
      attempt.endedAt = now;
      attempt.updatedAt = now;
      snapshot.mistakes = [{
        id: `e2e-mistake-${problemId}`,
        problemId,
        attemptId: attempt.id,
        category: 'other',
        rootCause: '本次练习未通过，待补充根因',
        correction: '',
        nextChecklistItem: '重新独立推导并检查边界条件',
        reviewStage: 0,
        intervalDays: 1,
        nextReviewAt: now + 86_400_000,
        successfulReviews: 0,
        failedReviews: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }];
      localStorage.setItem(key, JSON.stringify(snapshot));
    }, { key: STORAGE_KEY, problemId: savedProblemId });
    await page.reload();
    await expect(page.getByText('本地已保存')).toBeVisible();
    await expect.poll(async () => {
      const snapshot = await readSnapshot(page);
      const attempt = snapshot?.attempts.find((item) => item.problemId === savedProblemId);
      return {
        result: attempt?.result,
        ended: Boolean(attempt?.endedAt),
        mistakes: snapshot?.mistakes.filter((mistake) => mistake.problemId === savedProblemId).length,
      };
    }).toEqual({ result: 'sample-failed', ended: true, mistakes: 1 });

    await page.getByRole('link', { name: '复习', exact: true }).click();
    await expect(page.getByRole('heading', { name: '温故而知新，随机巩固已练过的题目。' })).toBeVisible();
    await expect(page.getByRole('button', { name: '随机复习一道算法题' })).toBeEnabled();

    await page.getByRole('link', { name: '计划', exact: true }).click();
    await page.getByLabel('学习时长（分钟）').fill('45');
    await page.getByLabel('算法题目标').fill('1');
    await page.getByLabel('面试题目标').fill('0');
    await page.getByLabel('关注专题').fill('滑动窗口');
    await page.getByRole('button', { name: '生成今日任务' }).click();
    await expect(page.getByText('今日词汇与题目任务已生成；到期单词复习不会占用新词目标。')).toBeVisible();
    await expect(page.getByText(problemTitle)).toBeVisible();

    const beforeReload = await readSnapshot(page);
    expect(beforeReload?.dailyPlans).toHaveLength(1);
    expect(beforeReload?.dailyPlans[0]).toMatchObject({ targetMinutes: 45, targetProblems: 1 });
    expect(beforeReload?.dailyPlans[0].taskProblemIds).toContain(savedProblemId);

    await page.reload();
    await expect(page.getByText('本地已保存')).toBeVisible();
    await expect(page.getByText(problemTitle)).toBeVisible();
    const afterReload = await readSnapshot(page);
    expect(afterReload).toEqual(beforeReload);
  });

  test('设置页保存练习偏好与 AI 元数据且不把密钥写入 localStorage', async ({ page }) => {
    await openWithEmptyLocalStore(page);
    await page.getByRole('link', { name: '设置', exact: true }).click();

    await page.getByLabel('接口地址').fill('https://ai.example.test/v1');
    await page.getByLabel('模型 ID').fill('xiti-e2e-model');
    await page.getByLabel('API 密钥').fill('sk-xiti-e2e-never-persist');
    await page.getByRole('button', { name: '保存配置' }).click();
    await expect(page.getByText('AI 配置已保存，密钥不会写入普通配置文件。')).toBeVisible();

    await page.getByLabel('默认语言').selectOption('typescript');
    await page.getByLabel('应用字号').selectOption('120');
    await page.getByLabel('发送前隐私确认').check();
    await expect.poll(async () => (await readSnapshot(page))?.settings).toMatchObject({
      aiBaseUrl: 'https://ai.example.test/v1',
      aiModel: 'xiti-e2e-model',
      defaultLanguage: 'typescript',
      appFontScale: 120,
      privacyConfirmed: true,
      hasAiCredential: true,
    });

    const serialized = await page.evaluate((key) => localStorage.getItem(key) ?? '', STORAGE_KEY);
    expect(serialized).not.toContain('sk-xiti-e2e-never-persist');

    await page.reload();
    await expect(page.getByText('本地已保存')).toBeVisible();
    await page.getByRole('link', { name: '今日', exact: true }).click();
    await page.getByRole('link', { name: '设置', exact: true }).click();
    await expect(page.getByLabel('接口地址')).toHaveValue('https://ai.example.test/v1');
    await expect(page.getByLabel('模型 ID')).toHaveValue('xiti-e2e-model');
    await expect(page.getByLabel('默认语言')).toHaveValue('typescript');
    await expect(page.getByLabel('应用字号')).toHaveValue('120');
    await expect(page.getByLabel('发送前隐私确认')).toBeChecked();
    await expect(page.getByLabel('API 密钥')).toHaveValue('');
  });
});
