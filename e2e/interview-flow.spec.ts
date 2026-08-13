import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'xiti.app-data.v1';
const PROBLEM_ID = 'personal-interview-cache-design';
const QUESTION = '企业级缓存一致性方案应该如何设计？';

async function installInterviewFixture(page: Page) {
  const now = Date.now();
  await page.addInitScript(({ key, timestamp }) => {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      problems: [{
        id: 'personal-interview-cache-design',
        kind: 'interview',
        title: '企业级缓存一致性方案应该如何设计？',
        source: 'manual',
        difficulty: 'hard',
        tags: ['缓存', '一致性', '高并发'],
        content: '请结合读写路径、异常恢复与可观测性给出方案。',
        constraints: [],
        examples: [],
        attachments: [],
        platformStatus: 'todo',
        cacheStatus: 'manual',
        importMethod: 'manual',
        interview: {
          contentOrigin: 'user',
          primaryRole: 'backend',
          roles: ['backend'],
          category: '分布式系统',
          format: 'system-design',
          keyPoints: ['明确一致性目标和读写模型', '处理缓存击穿与失效窗口', '补齐监控、降级和数据修复'],
          referenceAnswer: '先根据业务确认一致性等级与允许的失效窗口，再选择旁路缓存或写穿策略。写路径通过事务消息、版本号或延迟双删缩小不一致窗口，读路径处理击穿与空值。最后必须建设命中率、延迟和版本偏差监控，并准备降级、回源限流与离线修复。',
          followUps: ['删除缓存失败时如何保证最终一致？'],
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
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
        dailyTargetInterviewQuestions: 2,
        interviewCatalogVersion: 999,
        privacyConfirmed: false,
        theme: 'dark',
      },
      updatedAt: timestamp,
    }));
  }, { key: STORAGE_KEY, timestamp: now });
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
}

test('面试题筛选、草稿恢复、离线复盘和错题闭环', async ({ page }) => {
  test.setTimeout(90_000);
  await installInterviewFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/interviews');

  await expect(page.getByRole('heading', { name: '把零散八股，练成可表达的答案。' })).toBeVisible();
  await page.getByRole('textbox', { name: '检索面试题' }).fill('企业级缓存一致性');
  await expect(page.getByText(QUESTION)).toBeVisible();
  await page.getByRole('button', { name: `练习：${QUESTION}` }).click();

  const answer = page.getByRole('textbox', { name: '我的回答' });
  await expect(answer).toBeVisible();
  await expect(page.getByRole('button', { name: '点评回答' })).toBeDisabled();
  await answer.fill('我会先确定允许的不一致窗口，再设计写路径和异常补偿。');
  await page.waitForTimeout(700);
  const persistedDraft = await page.evaluate(({ key, problemId }) => {
    const snapshot = JSON.parse(localStorage.getItem(key) ?? '{}');
    return snapshot.attempts?.find((attempt: { problemId?: string }) => attempt.problemId === problemId)?.interview?.answerText;
  }, { key: STORAGE_KEY, problemId: PROBLEM_ID });
  expect(persistedDraft).toBe('我会先确定允许的不一致窗口，再设计写路径和异常补偿。');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '我的回答' })).toHaveValue('我会先确定允许的不一致窗口，再设计写路径和异常补偿。');

  await page.getByRole('button', { name: '提交回答' }).click();
  await expect(page.getByRole('button', { name: /^参考要点/ })).toBeVisible();
  await expect(page.getByText(/先根据业务确认一致性等级/)).toBeVisible();
  await page.getByRole('button', { name: '还需巩固' }).click();
  await expect(page.getByText('已加入巩固队列。')).toBeVisible();
  await page.getByRole('link', { name: '错题' }).click();
  await expect(page.getByText(QUESTION)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('面试工作台和练习页在常用宽度无横向溢出', async ({ page }) => {
  test.setTimeout(90_000);
  await installInterviewFixture(page);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/#/interviews?viewport=${viewport.width}`);
    await expect(page.getByText(QUESTION)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto(`/#/interviews/${PROBLEM_ID}?viewport=${viewport.width}`);
    await expect(page.getByRole('heading', { name: QUESTION })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});
