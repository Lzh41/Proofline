import { chromium } from '@playwright/test';

const endpoint = process.env.PROOFLINE_CDP_ENDPOINT ?? 'http://127.0.0.1:9234';
const screenshotPath = process.env.PROOFLINE_SCREENSHOT_PATH;
const requestedTheme = process.env.PROOFLINE_THEME === 'light' ? 'light' : 'dark';

async function connectWithRetry() {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(endpoint);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`无法连接最新 Proofline WebView2：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function intersects(left, right) {
  return !(
    left.x + left.width <= right.x
    || right.x + right.width <= left.x
    || left.y + left.height <= right.y
    || right.y + right.height <= left.y
  );
}

async function inspectLayout(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.locator('main').evaluate((element) => { element.scrollTop = 0; });
  await page.waitForTimeout(250);
  const problem = await page.locator('[class*="solveProblem"]').first().boundingBox();
  const code = await page.locator('[class*="codeWorkbench"]').first().boundingBox();
  const coach = await page.locator('[class*="aiCoachPane"]').first().boundingBox();
  if (!problem || !code || !coach) throw new Error(`${width}x${height} 下无法读取做题页布局边界。`);
  const metrics = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    mainClientHeight: document.querySelector('main')?.clientHeight ?? 0,
    mainScrollHeight: document.querySelector('main')?.scrollHeight ?? 0,
  }));
  const result = {
    viewport: `${width}x${height}`,
    problem,
    code,
    coach,
    problemOverlapsCode: intersects(problem, code),
    problemOverlapsCoach: intersects(problem, coach),
    codeOverlapsCoach: intersects(code, coach),
    horizontalOverflow: Math.max(metrics.documentWidth, metrics.bodyWidth) > metrics.viewportWidth,
    mainPageScrollable: metrics.mainScrollHeight > metrics.mainClientHeight + 1,
    sideBySide: code.x + code.width <= coach.x,
  };
  if (result.problemOverlapsCode || result.problemOverlapsCoach || result.codeOverlapsCoach || result.horizontalOverflow || result.mainPageScrollable) {
    throw new Error(`${width}x${height} 布局出现重叠或横向越界：${JSON.stringify(result)}`);
  }
  return result;
}

const browser = await connectWithRetry();
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((item) => !item.url().startsWith('devtools://')) ?? pages[0];
if (!page) throw new Error('CDP 中未找到 Proofline 主页面。');

await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__?.invoke), undefined, { timeout: 20_000 });
const now = Date.now();
const code = `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> seen;
        for (int i = 0; i < static_cast<int>(nums.size()); ++i) {
            auto found = seen.find(target - nums[i]);
            if (found != seen.end()) return {found->second, i};
            seen[nums[i]] = i;
        }
        return {};
    }
};`;
const snapshot = {
  schemaVersion: 1,
  problems: [{
    id: 'qa-two-sum',
    title: '两数之和',
    source: 'leetcode-cn',
    sourceUrl: 'https://leetcode.cn/problems/two-sum/',
    externalId: '1',
    platformSlug: 'two-sum',
    difficulty: 'easy',
    tags: ['数组', '哈希表'],
    content: '给定一个整数数组 nums 和一个整数目标值 target，请在数组中找出和为目标值的两个整数，并返回它们的下标。',
    constraints: ['每种输入只会对应一个答案。'],
    examples: [{
      input: 'nums = [2,7,11,15], target = 9',
      output: '[0,1]',
      explanation: 'nums[0] + nums[1] = 9。',
    }],
    codeSnippets: [{
      language: 'C++',
      languageSlug: 'cpp',
      code: 'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        \n    }\n};',
    }],
    sampleTestCase: '[2,7,11,15]\n9',
    attachments: [],
    platformStatus: 'todo',
    cacheStatus: 'fresh',
    importMethod: 'connector',
    createdAt: now,
    updatedAt: now,
  }],
  attempts: [{
    id: 'qa-attempt',
    problemId: 'qa-two-sum',
    language: 'cpp',
    code,
    startedAt: now,
    durationSeconds: 0,
    result: 'unfinished',
    hintLevel: 0,
    independent: true,
    mastery: 1,
    createdAt: now,
    updatedAt: now,
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
    theme: requestedTheme,
  },
  updatedAt: now,
};

await page.evaluate((value) => window.__TAURI_INTERNALS__.invoke('save_app_data', { snapshot: value }), snapshot);
await page.evaluate(() => { window.location.hash = '#/solve/qa-two-sum'; });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: /两数之和/ }).waitFor({ timeout: 20_000 });
await page.getByRole('button', { name: '运行样例', exact: true }).click();
await page.getByText('样例 1 通过', { exact: false }).waitFor({ timeout: 30_000 });

const runResult = await page.locator('[class*="runResultPanel"] pre').innerText();
const layouts = [
  await inspectLayout(page, 1440, 900),
  await inspectLayout(page, 1280, 720),
];

await page.setViewportSize({ width: 1440, height: 900 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: /两数之和/ }).waitFor({ timeout: 20_000 });
await page.getByRole('button', { name: '运行样例', exact: true }).click();
await page.getByText('样例 1 通过', { exact: false }).waitFor({ timeout: 30_000 });
if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: false });

process.stdout.write(`${JSON.stringify({
  endpoint,
  pageUrl: page.url(),
  title: await page.title(),
  runResult,
  layouts,
  screenshotPath: screenshotPath ?? null,
  verifiedAt: new Date().toISOString(),
}, null, 2)}\n`);
await browser.close();
