import { expect, test, type Page } from '@playwright/test';

const screenshotStamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

async function installExaminer(page: Page) {
  await page.goto('/#/interviews');
  await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts');
    await useAppStore.getState().initialize();
    const settings = useAppStore.getState().settings;
    useAppStore.setState({
      settings: { ...settings, hasAiCredential: true, aiModel: 'e2e-model', privacyConfirmed: true },
      requestInterviewExaminer: async () => ({
        topic: 'Transformer',
        overview: '覆盖结构、训练、推理优化和工程落地。',
        checkpoints: ['自注意力', '位置编码', '归一化', 'KV Cache'],
        questions: Array.from({ length: 10 }, (_, index) => ({
          title: `Transformer 深入考点 ${index + 1}`, category: 'Transformer', format: 'knowledge' as const,
          difficulty: 'medium' as const, tags: ['Transformer'], keyPoints: ['原理', '复杂度', '工程权衡'],
          referenceAnswer: '完整参考答案。', followUps: ['继续追问。'],
        })),
      }),
    });
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`AI 出题官在 ${viewport.width}px 下始终显示加入个人题库按钮`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installExaminer(page);
    await page.getByRole('button', { name: 'AI 面试出题官' }).click();
    await page.getByRole('textbox', { name: '技术主题' }).fill('Transformer');
    await page.getByRole('button', { name: '生成面试考点' }).click();

    const saveButton = page.getByRole('button', { name: '加入个人题库' });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeEnabled();
    const layout = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
      const footer = document.querySelector<HTMLElement>('[class*="interviewExaminerFooter"]');
      const questions = document.querySelector<HTMLElement>('[class*="interviewExaminerQuestions"]');
      if (!dialog || !footer || !questions) return null;
      const dialogRect = dialog.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        dialogTop: dialogRect.top,
        dialogBottom: dialogRect.bottom,
        footerTop: footerRect.top,
        footerBottom: footerRect.bottom,
        footerInsideDialog: footerRect.top >= dialogRect.top && footerRect.bottom <= dialogRect.bottom,
        listCanScroll: questions.scrollHeight > questions.clientHeight,
      };
    });
    expect(layout).toMatchObject({ footerInsideDialog: true });
    expect(layout?.listCanScroll).toBe(true);
    await page.screenshot({
      path: `artifacts/proofline-examiner-${viewport.width}-${screenshotStamp}.png`,
      fullPage: false,
    });
  });
}
