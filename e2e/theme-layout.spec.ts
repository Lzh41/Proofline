import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'xiti.app-data.v1';

function intersects(left: DOMRect, right: DOMRect): boolean {
  return !(
    left.x + left.width <= right.x
    || right.x + right.width <= left.x
    || left.y + left.height <= right.y
    || right.y + right.height <= left.y
  );
}

async function installThemeFixture(page: Page) {
  const now = Date.now();
  await page.addInitScript(({ key, timestamp }) => {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      problems: [{
        id: 'theme-two-sum',
        title: '两数之和',
        source: 'manual',
        externalId: '1',
        difficulty: 'easy',
        tags: ['数组', '哈希表'],
        content: '给定整数数组与目标值，返回两个数的下标。',
        examples: [{ input: '[2,7,11,15]\n9', output: '[0,1]' }],
        attachments: [],
        platformStatus: 'attempted',
        importMethod: 'manual',
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
      attempts: [{
        id: 'theme-attempt',
        problemId: 'theme-two-sum',
        language: 'cpp',
        code: 'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        return {};\n    }\n};',
        startedAt: timestamp,
        durationSeconds: 0,
        result: 'unfinished',
        hintLevel: 0,
        independent: true,
        mastery: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
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
      updatedAt: timestamp,
    }));
  }, { key: STORAGE_KEY, timestamp: now });
}

async function useTheme(page: Page, theme: 'light' | 'dark') {
  const current = await page.locator('html').getAttribute('data-theme');
  if (current !== theme) {
    await page.getByRole('button', { name: theme === 'dark' ? '切换到深色主题' : '切换到浅色主题' }).click();
  }
  await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe(theme);
}

async function inspectSolveLayout(page: Page) {
  return page.evaluate(() => {
    const box = (part: string) => {
      const rect = document.querySelector<HTMLElement>(`[class*="${part}"]`)?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    };
    const editor = document.querySelector<HTMLElement>('.monaco-editor');
    return {
      theme: document.documentElement.dataset.theme,
      editorBackground: editor ? getComputedStyle(editor).backgroundColor : '',
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      problem: box('solveProblem'),
      code: box('codeWorkbench'),
      coach: box('aiCoachPane'),
      search: box('search'),
      themeToggle: box('themeToggle'),
      mobileTrigger: box('mobileTrigger'),
    };
  });
}

test('深浅主题做题页在桌面与窄屏都无重叠和横向溢出', async ({ page }) => {
  test.setTimeout(90_000);
  await installThemeFixture(page);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/#/solve/theme-two-sum');
    await expect(page.getByRole('heading', { name: /两数之和/ })).toBeVisible();
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 15_000 });

    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme);
      const layout = await inspectSolveLayout(page);

      expect(layout.theme).toBe(theme);
      expect(layout.editorBackground).toBe(theme === 'light' ? 'rgb(250, 249, 245)' : 'rgb(24, 23, 21)');
      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.problem && layout.code && layout.coach).toBeTruthy();
      for (const box of [layout.problem, layout.code, layout.coach, layout.search, layout.themeToggle]) {
        expect(box?.x).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(layout.viewportWidth);
      }
      expect(intersects(layout.problem as DOMRect, layout.code as DOMRect)).toBe(false);
      expect(intersects(layout.problem as DOMRect, layout.coach as DOMRect)).toBe(false);
      expect(intersects(layout.code as DOMRect, layout.coach as DOMRect)).toBe(false);
      expect(intersects(layout.search as DOMRect, layout.themeToggle as DOMRect)).toBe(false);
      if (viewport.width <= 920) {
        expect(intersects(layout.search as DOMRect, layout.mobileTrigger as DOMRect)).toBe(false);
      }
    }
  }

  await page.reload();
  await expect(page.getByRole('button', { name: '切换到浅色主题' })).toBeVisible();
  await expect.poll(() => page.locator('.monaco-editor').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(24, 23, 21)');
});
