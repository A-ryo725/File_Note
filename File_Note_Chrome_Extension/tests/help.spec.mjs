import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PDFLib = require('../file-note/vendor/pdf-lib.min.js');

async function openPdf(page) {
  const doc = await PDFLib.PDFDocument.create();
  doc.addPage([400, 600]);
  await page.addInitScript(() => delete window.showOpenFilePicker);
  await page.goto('/editor.html');
  await page.locator('#fileInput').setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('#pageNumber')).toHaveText('1 / 1');
}

test('「使い方」は「ファイルを開く」の左にあり、PDFの上に説明の窓を開く', async ({ page }) => {
  await openPdf(page);
  const help = await page.locator('#help').boundingBox();
  const open = await page.locator('#open').boundingBox();
  expect(help.x + help.width).toBeLessThan(open.x);
  await expect(page.locator('#helpDialog')).toBeHidden();
  await page.locator('#help').click();
  const dialog = page.locator('#helpDialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('「PDFを保存」と「編集データを保存」の違い');
  await expect(dialog).toContainText('便利な機能');
  // The editor's shortcuts do not act behind the window.
  await page.keyboard.press('Control+s');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // The ✕ button and a click outside the window both close it.
  await page.locator('#help').click();
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await expect(dialog).toBeHidden();
  await page.locator('#help').click();
  await page.mouse.click(5, 300);
  await expect(dialog).toBeHidden();
});

test('PDFを開く前でも使い方を開ける', async ({ page }) => {
  await page.goto('/editor.html');
  await page.locator('#help').click();
  await expect(page.locator('#helpDialog')).toBeVisible();
});
