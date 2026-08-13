import { chromium } from '@playwright/test';

const endpoint = process.env.XITI_CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

const browser = await chromium.connectOverCDP(endpoint);
const allPages = () => browser.contexts().flatMap((context) => context.pages());
const main = allPages().find((page) => page.url().startsWith('http://localhost:1420'));

if (!main) {
  throw new Error('CDP 中未找到析题主窗口。');
}

await main.waitForLoadState('domcontentloaded');
const initial = {
  title: await main.title(),
  url: main.url(),
  headings: await main.getByRole('heading').allTextContents(),
  navigation: await main.getByRole('navigation', { name: '主导航' }).getByRole('link').allTextContents(),
};

await main.getByRole('link', { name: '平台', exact: true }).click();
await main.waitForURL(/\/platforms$/);
await main.getByText('三个平台使用相互隔离的登录目录', { exact: false }).waitFor();

const platform = {
  url: main.url(),
  headings: await main.getByRole('heading').allTextContents(),
  openButtons: await main.getByRole('button', { name: '打开官网', exact: true }).count(),
  bindButtons: await main.getByRole('button', { name: /^绑定.+当前题$/ }).count(),
};

const targetsBefore = allPages().map((page) => ({ title: '', url: page.url() }));
await main.getByRole('button', { name: '打开官网', exact: true }).first().click();

await new Promise((resolve) => setTimeout(resolve, 3_000));

const targetsAfter = await Promise.all(
  allPages().map(async (page) => ({ title: await page.title().catch(() => ''), url: page.url() })),
);

const statusText = await main.locator('body').innerText();
const result = {
  cdpEndpoint: endpoint,
  initial,
  platform,
  targetsBefore,
  targetsAfter,
  pageTargetDelta: targetsAfter.length - targetsBefore.length,
  statusMentionsOpened: statusText.includes('已打开') || statusText.includes('打开力扣'),
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(0);
