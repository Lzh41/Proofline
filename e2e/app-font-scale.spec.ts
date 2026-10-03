import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'xiti.app-data.v1';
const PROBLEM_ID = 'font-scale-problem';
const INTERVIEW_ID = 'font-scale-interview';
const NOTE_ID = 'font-scale-note';

const routes = [
  '#/',
  '#/platforms',
  '#/platforms/leetcode-cn',
  '#/problems',
  '#/problems/import',
  `#/solve/${PROBLEM_ID}`,
  `#/problems/${PROBLEM_ID}`,
  '#/solve',
  '#/interviews',
  `#/interviews/${INTERVIEW_ID}`,
  '#/review',
  '#/vocabulary',
  '#/knowledge',
  `#/knowledge/${NOTE_ID}`,
  '#/plan',
  '#/analytics',
  '#/settings',
];

const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

async function installFixture(page: Page) {
  const now = Date.now();
  await page.addInitScript(({ key, timestamp }) => {
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      problems: [
        {
          id: 'font-scale-problem',
          kind: 'algorithm',
          title: '字号与做题布局回归验证题',
          source: 'manual',
          externalId: 'FS-01',
          difficulty: 'medium',
          tags: ['布局', '字号', '回归测试'],
          content: '验证字号调整后题面、编辑器和 AI 教练仍各自在自己的区域内显示。题面文字足够长，用于检查放大后自然换行。',
          constraints: [],
          examples: [{ input: '1 2 3', output: '6' }],
          attachments: [],
          platformStatus: 'todo',
          cacheStatus: 'manual',
          importMethod: 'manual',
          algorithmMode: 'function',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: 'font-scale-interview',
          kind: 'interview',
          title: '字号调整与桌面布局的面试题',
          source: 'manual',
          difficulty: 'medium',
          tags: ['桌面端', '可访问性'],
          content: '说明如何在不缩放整个页面的前提下放大文字。',
          constraints: [],
          examples: [],
          attachments: [],
          platformStatus: 'todo',
          cacheStatus: 'manual',
          importMethod: 'manual',
          interview: {
            contentOrigin: 'user',
            primaryRole: 'frontend',
            roles: ['frontend'],
            category: '前端工程',
            format: 'behavioral',
            keyPoints: ['只缩放文字', '保留布局边界', '验证小屏断点'],
            referenceAnswer: '使用可持久化的文字倍率，并对每个页面检查换行、溢出和交互区域。',
            followUps: ['如何验证高倍率下的可访问性？'],
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      attempts: [],
      thoughtEvents: [],
      platformResults: [],
      mistakes: [],
      knowledgeNotes: [{
        id: 'font-scale-note',
        title: '桌面字号布局检查记录',
        content: '高字号应让正文自然换行，并保留主内容宽度。\n\n- 不缩放整个页面\n- 检查 AI 教练区域\n- 检查窄屏溢出',
        tags: ['字号', '桌面布局'],
        relatedProblemIds: ['font-scale-problem'],
        relatedMistakeIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
      codeTemplates: [],
      dailyPlans: [],
      vocabularyProgress: [],
      vocabularyReviews: [],
      aiGenerations: [],
      settings: {
        aiBaseUrl: 'https://api.openai.com/v1',
        aiModel: '',
        hasAiCredential: false,
        defaultLanguage: 'cpp',
        editorFontSize: 16,
        appFontScale: 100,
        dailyTargetMinutes: 60,
        dailyTargetProblems: 3,
        dailyTargetInterviewQuestions: 2,
        dailyTargetVocabularyWords: 10,
        privacyConfirmed: false,
        theme: 'dark',
      },
      updatedAt: timestamp,
    }));
  }, { key: STORAGE_KEY, timestamp: now });
}

async function configureAiCoach(page: Page) {
  await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    await useAppStore.getState().initialize();
    useAppStore.setState((state) => ({
      settings: { ...state.settings, aiModel: 'e2e-font-scale-model', hasAiCredential: true, privacyConfirmed: true },
    }));
  });
}

async function layoutMetrics(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#root')!;
    const rect = root.getBoundingClientRect();
    const coach = document.querySelector<HTMLElement>('[class*="aiCoachPane"]')?.getBoundingClientRect();
    const code = document.querySelector<HTMLElement>('[class*="codeWorkbench"]')?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      htmlClientWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      rootX: rect.x,
      rootWidth: rect.width,
      rootRight: rect.right,
      rootZoom: getComputedStyle(root).zoom,
      appScale: document.documentElement.dataset.appFontScale,
      rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      visualScale: window.visualViewport?.scale ?? 1,
      coach: coach ? { x: coach.x, width: coach.width, right: coach.right } : null,
      code: code ? { x: code.x, width: code.width, right: code.right } : null,
    };
  });
}

test('所有页面在应用字号放大后保持视口布局与文字倍率', async ({ page }) => {
  test.setTimeout(120_000);
  await installFixture(page);
  await page.setViewportSize(viewports[0]);
  await page.goto('/#/settings');
  await expect(page.getByLabel('应用字号')).toHaveValue('100');

  const baselineFontSize = await page.locator('aside nav a').first().evaluate((element) => getComputedStyle(element).fontSize);
  for (const scale of [100, 130] as const) {
    await page.goto('/#/settings');
    await page.getByLabel('应用字号').selectOption(String(scale));
    await expect.poll(() => page.locator('html').getAttribute('data-app-font-scale')).toBe(String(scale));
    if (scale === 130) {
      const enlargedFontSize = await page.locator('aside nav a').first().evaluate((element) => getComputedStyle(element).fontSize);
      expect(Number.parseFloat(enlargedFontSize)).toBeGreaterThan(Number.parseFloat(baselineFontSize) * 1.29);
    }

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.evaluate((hash) => { window.location.hash = hash; }, route);
        await expect(page.locator('[class*="shell"]').first()).toBeVisible();
        await expect(page.locator('main').first()).toBeVisible();
        if (route === `#/solve/${PROBLEM_ID}`) await configureAiCoach(page);

        const layout = await layoutMetrics(page);
        expect(layout.appScale, `${route} @ ${viewport.width}px @ ${scale}%`).toBe(String(scale));
        expect(layout.visualScale, `${route} @ ${viewport.width}px @ ${scale}%`).toBe(1);
        expect(layout.rootZoom, `${route} @ ${viewport.width}px @ ${scale}%`).toBe('1');
        expect(layout.rootX, `${route} @ ${viewport.width}px @ ${scale}%`).toBe(0);
        expect(layout.rootWidth, `${route} @ ${viewport.width}px @ ${scale}%`).toBeCloseTo(layout.htmlClientWidth, 0);
        expect(layout.rootRight, `${route} @ ${viewport.width}px @ ${scale}%`).toBeLessThanOrEqual(viewport.width + 1);
        expect(layout.documentWidth, `${route} @ ${viewport.width}px @ ${scale}%`).toBeLessThanOrEqual(viewport.width + 1);
        expect(layout.bodyWidth, `${route} @ ${viewport.width}px @ ${scale}%`).toBeLessThanOrEqual(viewport.width + 1);

        if (route === `#/solve/${PROBLEM_ID}` && viewport.width >= 1024) {
          expect(layout.code?.width).toBeGreaterThan(0);
          expect(layout.coach?.width).toBeGreaterThan(0);
          expect(layout.code?.right).toBeLessThanOrEqual((layout.coach?.x ?? 0) + 1);
          expect(layout.coach?.right).toBeLessThanOrEqual(viewport.width + 1);
        }
      }
    }
  }

  const screenshotPath = process.env.PROOFLINE_FONT_SCALE_SCREENSHOT;
  if (screenshotPath) {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/#/solve/${PROBLEM_ID}?fontScaleScreenshot=${Date.now()}`);
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: screenshotPath, fullPage: false });
  }
  const mobileScreenshotPath = process.env.PROOFLINE_FONT_SCALE_MOBILE_SCREENSHOT;
  if (mobileScreenshotPath) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#/settings?fontScaleMobileScreenshot=${Date.now()}`);
    await expect(page.getByLabel('应用字号')).toHaveValue('130');
    await page.screenshot({ path: mobileScreenshotPath, fullPage: false });
  }
});
