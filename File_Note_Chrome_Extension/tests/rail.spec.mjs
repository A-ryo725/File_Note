import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const PDFLib = createRequire(import.meta.url)('../file-note/vendor/pdf-lib.min.js');

async function openPdf(page) {
  const doc = await PDFLib.PDFDocument.create();
  doc.addPage([400, 600]);
  doc.addPage([400, 600]);
  await page.addInitScript(() => delete window.showOpenFilePicker);
  await page.goto('/editor.html');
  await page.locator('#fileInput').setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('#pageNumber')).toHaveText('1 / 2');
}

test('ページ一覧を閉じて開ける。閉じると編集画面が広くなり、次に開いたときも閉じたまま', async ({ page }) => {
  await openPdf(page);
  const thumbs = page.locator('#pageThumbs');
  const toggle = page.locator('#railToggle');
  await expect(thumbs).toBeVisible();
  await expect(page.locator('#pageThumbs .thumb-card')).toHaveCount(2);
  const before = (await page.locator('#workspace').boundingBox()).width;

  await toggle.click();
  await expect(thumbs).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-label', 'ページ一覧を開く');
  expect((await page.locator('#workspace').boundingBox()).width).toBeGreaterThan(before + 150);

  // Other tools still show their settings; the select tool shows the folded list again.
  await page.click('[data-tool=pen]');
  await expect(page.locator('#settingsPanel')).toBeVisible();
  await page.click('[data-tool=select]');
  await expect(thumbs).toBeHidden();

  await page.reload();
  await expect(page.locator('#sidebar')).toHaveClass(/collapsed/);
  await page.locator('#railToggle').click();
  await expect(page.locator('#sidebar')).not.toHaveClass(/collapsed/);
  await page.reload();
  await expect(page.locator('#sidebar')).not.toHaveClass(/collapsed/);
});

test('閉じている間に開いたPDFも、一覧を開けばページが並ぶ', async ({ page }) => {
  await page.goto('/editor.html');
  await page.locator('#railToggle').click();
  await openPdf(page);
  await expect(page.locator('#sidebar')).toHaveClass(/collapsed/);
  await page.locator('#railToggle').click();
  await expect(page.locator('#pageThumbs .thumb-card')).toHaveCount(2);
  await expect(page.locator('#pageThumbs canvas').first()).toBeVisible();
});
