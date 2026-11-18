import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const PDFLib = require('../file-note/vendor/pdf-lib.min.js');

const JA = '本日は晴天なり。これは長い日本語の文章で、欄の幅を超えたら自動で次の行に折り返されるはずです。';
const LONG_ONE_LINE = '一行の欄に長い文章を入れるとどうなるかを確認するための文です';

// Fields like real forms: "fixed" has 12 pt, the others an automatic size (0 Tf), as Acrobat and Word write it.
async function makePdf() {
  const doc = await PDFLib.PDFDocument.create();
  const page = doc.addPage([500, 500]);
  const form = doc.getForm();
  const fixed = form.createTextField('fixed');
  fixed.enableMultiline();
  fixed.addToPage(page, { x: 30, y: 330, width: 220, height: 140 });
  fixed.setFontSize(12);
  const auto = form.createTextField('auto');
  auto.enableMultiline();
  auto.addToPage(page, { x: 260, y: 330, width: 220, height: 90 });
  const single = form.createTextField('single');
  single.addToPage(page, { x: 30, y: 270, width: 220, height: 30 });
  for (const field of [auto, single]) {
    field.acroField.setDefaultAppearance('/Helv 0 Tf 0 g');
    for (const widget of field.acroField.getWidgets()) widget.setDefaultAppearance('/Helv 0 Tf 0 g');
  }
  return Buffer.from(await doc.save({ updateFieldAppearances: false }));
}

async function open(page) {
  await page.addInitScript(() => delete window.showOpenFilePicker);
  await page.goto('/editor.html');
  await page.locator('#fileInput').setInputFiles({ name: 'form.pdf', mimeType: 'application/pdf', buffer: await makePdf() });
  await expect(page.locator('#pageNumber')).toHaveText('1 / 1');
}

// Lines drawn in a field's saved appearance, and the font size it uses.
async function appearanceOf(bytes, name) {
  const { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } = PDFLib;
  const doc = await PDFDocument.load(bytes);
  const widget = doc.getForm().getTextField(name).acroField.getWidgets()[0];
  const stream = widget.dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  const content = new TextDecoder('latin1').decode(
    stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents(),
  );
  return {
    lines: (content.match(/\bTj\b/g) || []).length,
    size: Number(/([\d.]+) Tf/.exec(content)[1]),
    text: doc.getForm().getTextField(name).getText(),
  };
}

test('PDF内の複数行の欄で、日本語が欄の幅で折り返されて保存される', async ({ page }) => {
  await open(page);
  await page.locator('[data-field-name="fixed"]').fill(JA);
  await page.locator('[data-field-name="auto"]').fill(JA + JA);
  await page.locator('[data-field-name="single"]').fill(LONG_ONE_LINE);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  const bytes = await readFile(await download.path());

  const fixed = await appearanceOf(bytes, 'fixed');
  expect(fixed.size).toBe(12);
  expect(fixed.lines).toBeGreaterThanOrEqual(3);
  expect(fixed.text).toBe(JA); // the field value itself has no added line breaks

  // Automatic size: at most 12 pt, small enough for every line to fit the field's height.
  const auto = await appearanceOf(bytes, 'auto');
  expect(auto.size).toBeLessThanOrEqual(12);
  expect(auto.lines).toBeGreaterThanOrEqual(3);
  expect(auto.lines * auto.size * 1.448 * 1.2).toBeLessThanOrEqual(88);

  // One line with an automatic size shrinks until the whole text fits the width.
  const single = await appearanceOf(bytes, 'single');
  expect(single.lines).toBe(1);
  expect(single.size).toBeLessThan(10);
});

test('自動サイズの欄は、編集画面でも欄に収まる大きさで表示する', async ({ page }) => {
  await open(page);
  const auto = page.locator('[data-field-name="auto"]');
  await auto.fill(JA + JA);
  const shown = await auto.evaluate((el) => ({
    fits: el.scrollHeight <= el.clientHeight + 1,
    size: parseFloat(el.style.fontSize),
  }));
  expect(shown.fits).toBe(true);
  const single = page.locator('[data-field-name="single"]');
  await single.fill(LONG_ONE_LINE);
  expect(await single.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test('折り返しの規則：英単語は途中で切らず、句読点は行頭に来ない', async ({ page }) => {
  await page.goto('/editor.html');
  const result = await page.evaluate(async () => {
    const { wrapText } = await import('/field-layout.js');
    const widthOf = (text) => [...text].length * 10; // every character 10 wide
    return {
      english: wrapText('hello wonderful world', 100, widthOf),
      japanese: wrapText('あいうえおかきくけこ。さしす', 100, widthOf),
      newline: wrapText('一行目\n二行目', 100, widthOf),
    };
  });
  expect(result.english).toEqual(['hello', 'wonderful', 'world']);
  expect(result.japanese).toEqual(['あいうえおかきくけ', 'こ。さしす']);
  expect(result.newline).toEqual(['一行目', '二行目']);
});
