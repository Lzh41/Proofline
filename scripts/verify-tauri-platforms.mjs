import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) throw new Error('缺少 LOCALAPPDATA 环境变量。');

const platformDefinitions = [
  { source: 'leetcode-cn', label: '力扣' },
  { source: 'leetcode', label: 'LeetCode' },
  { source: 'nowcoder', label: '牛客' },
];

const mainPortFile = path.join(localAppData, 'com.xiti.desktop', 'EBWebView', 'DevToolsActivePort');
const platformPortFile = (source) => path.join(localAppData, 'Xiti', 'platforms', source, 'EBWebView', 'DevToolsActivePort');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function endpointFromFile(file, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const [portLine] = (await readFile(file, 'utf8')).trim().split(/\r?\n/);
      const port = Number(portLine);
      if (!Number.isInteger(port) || port <= 0) throw new Error(`端口文件内容无效：${portLine}`);
      const endpoint = `http://127.0.0.1:${port}`;
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return endpoint;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`无法从 ${file} 连接 CDP：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function firstPage(browser, expectedUrl) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find((item) => item.url().includes(expectedUrl)) ?? pages[0];
    if (page) return page;
    await delay(250);
  }
  throw new Error(`CDP 中未找到 ${expectedUrl} 页面。`);
}

async function waitEnabled(locator, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!(await locator.isDisabled())) return;
    await delay(100);
  }
  throw new Error('平台操作按钮未在预期时间内恢复。');
}

const mainEndpoint = await endpointFromFile(mainPortFile);
const mainBrowser = await chromium.connectOverCDP(mainEndpoint);
const main = await firstPage(mainBrowser, 'localhost:1420');
await main.waitForLoadState('domcontentloaded');

async function loadSnapshot() {
  return main.evaluate(() => window.__TAURI_INTERNALS__.invoke('load_app_data'));
}

if (process.argv.includes('--inspect')) {
  const snapshot = await loadSnapshot();
  const persistedProblem = snapshot?.problems?.find((problem) => problem.sourceUrl === 'https://leetcode.cn/problems/two-sum/');
  process.stdout.write(`${JSON.stringify({
    mode: 'inspect',
    mainEndpoint,
    title: await main.title(),
    problemCount: snapshot?.problems?.length ?? 0,
    persistedProblem: persistedProblem ?? null,
  }, null, 2)}\n`);
  if (process.argv.includes('--hold')) await new Promise(() => {});
  process.exit(0);
}

await main.getByRole('link', { name: '平台', exact: true }).click();
await main.getByText('三个平台使用相互隔离的登录目录', { exact: false }).waitFor();
const openButtons = main.getByRole('button', { name: '打开官网', exact: true });

const remoteBrowsers = new Map();
const platformWindows = [];
for (let index = 0; index < platformDefinitions.length; index += 1) {
  const definition = platformDefinitions[index];
  await openButtons.nth(index).click();
  await waitEnabled(openButtons.first());

  const endpoint = await endpointFromFile(platformPortFile(definition.source));
  const browser = await chromium.connectOverCDP(endpoint);
  remoteBrowsers.set(definition.source, browser);
  const page = await firstPage(browser, definition.source === 'nowcoder' ? 'nowcoder.com' : definition.source === 'leetcode-cn' ? 'leetcode.cn' : 'leetcode.com');
  platformWindows.push({
    source: definition.source,
    label: definition.label,
    endpoint,
    title: await page.title().catch(() => ''),
    url: page.url(),
  });
}

const leetcodeBrowser = remoteBrowsers.get('leetcode-cn');
if (!leetcodeBrowser) throw new Error('力扣隔离窗口未连接。');
const leetcodePage = await firstPage(leetcodeBrowser, 'leetcode.cn');
let navigationError = null;
try {
  await leetcodePage.goto('https://leetcode.cn/problems/two-sum/', { waitUntil: 'commit', timeout: 30_000 });
  await delay(2_000);
} catch (error) {
  navigationError = error instanceof Error ? error.message : String(error);
}

const currentPlatformUrl = await main.evaluate(
  (source) => window.__TAURI_INTERNALS__.invoke('get_platform_current_url', { source }),
  'leetcode-cn',
);

await main.getByRole('button', { name: '绑定力扣当前题', exact: true }).click();
await main.waitForFunction(() => document.body.innerText.includes('绑定当前题已完成'), undefined, { timeout: 20_000 });
const snapshot = await loadSnapshot();
const boundProblem = snapshot?.problems?.find((problem) => problem.sourceUrl === currentPlatformUrl) ?? null;

process.stdout.write(`${JSON.stringify({
  mode: 'full',
  mainEndpoint,
  mainTitle: await main.title(),
  platformWindows,
  navigationError,
  leetcodePageUrl: leetcodePage.url(),
  currentPlatformUrl,
  boundProblem,
  problemCount: snapshot?.problems?.length ?? 0,
}, null, 2)}\n`);
process.exit(0);
