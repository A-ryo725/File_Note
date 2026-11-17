import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const PDFLib = require('../file-note/vendor/pdf-lib.min.js');

// Characters that the earlier, reduced Japanese font could not show.
const SAMPLES = {
  記号: '※①⑳㈱〒♪☆★→⇒○●□■△▽◇～℃№㎡㍻≠≦∞',
  半角カナ・旧字: 'ｱｲｳｴｵ 髙﨑德濵𠮷',
  ギリシャ・キリル・数学: 'αβγΩ ЖЯ ⅠⅡⅫ ∑∫√∈',
  チェック: '✓✔✕✖☐☑☒✗✘',
  絵文字: '😀👍🎉💯✅',
  韓国語: '한국어 안녕하세요',
  中国語: '这个们说 简体字',
  ラテン文字・通貨: 'Việt Nam ₹₽€',
};

async function openPdf(page, { field = false } = {}) {
  const doc = await PDFLib.PDFDocument.create();
  const first = doc.addPage([500, 700]);
  if (field) doc.getForm().createTextField('name').addToPage(first, { x: 40, y: 620, width: 420, height: 30 });
  await page.addInitScript(() => delete window.showOpenFilePicker);
  await page.goto('/editor.html');
  await page.locator('#fileInput').setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('#pageNumber')).toHaveText('1 / 1');
}

async function addText(page, text, y) {
  await page.click('[data-tool=text]');
  const box = await page.locator('#overlay').boundingBox();
  await page.mouse.click(box.x + box.width * 0.08, box.y + box.height * y);
  await page.fill('#textValue', text);
  await page.click('#textConfirm');
}

async function save(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  return readFile(await download.path());
}

// Characters whose glyph is missing (or has no outline) in the fonts embedded in the PDF.
function missingGlyphs(page, bytes, text) {
  return page.evaluate(
    async ({ b64, text }) => {
      const { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } = PDFLib;
      const doc = await PDFDocument.load(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      const full = fontkit.create(new Uint8Array(await (await fetch('fonts/FileNoteSans-Regular.ttf')).arrayBuffer()));
      const missing = new Set();
      let fonts = 0;
      for (const [, object] of doc.context.enumerateIndirectObjects()) {
        const file = object instanceof PDFDict && object.lookup(PDFName.of('FontFile2'));
        if (!(file instanceof PDFRawStream)) continue;
        fonts++;
        const font = decodePDFRawStream(file).decode();
        const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
        let loca;
        for (let i = 0; i < view.getUint16(4); i++)
          if (String.fromCharCode(...font.subarray(12 + i * 16, 16 + i * 16)) === 'loca') loca = view.getUint32(12 + i * 16 + 8);
        for (const ch of text.replace(/\s/g, '')) {
          const id = full.glyphForCodePoint(ch.codePointAt(0)).id;
          if (!id || view.getUint32(loca + id * 4 + 4) === view.getUint32(loca + id * 4)) missing.add(ch);
        }
      }
      return fonts ? [...missing] : ['no font'];
    },
    { b64: bytes.toString('base64'), text },
  );
}

test('記号・絵文字・韓国語・中国語などを書き込んで、PDFに保存できる', async ({ page }) => {
  await openPdf(page);
  const lines = Object.values(SAMPLES);
  for (const [i, line] of lines.entries()) await addText(page, line, 0.08 + i * 0.1);
  await expect(page.locator('#status')).not.toHaveClass(/error/);
  const bytes = await save(page);
  expect(bytes.length).toBeLessThan(150_000);
  expect(await missingGlyphs(page, bytes, lines.join(''))).toEqual([]);

  // The text can still be copied out of the saved PDF.
  const text = await page.evaluate(async (b64) => {
    const pdfjs = await import('/vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), cMapUrl: '/vendor/cmaps/', cMapPacked: true })
      .promise;
    return (await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join('\n');
  }, bytes.toString('base64'));
  for (const line of lines) expect(text.replace(/\s/g, '')).toContain(line.replace(/\s/g, ''));
});

test('PDFの入力欄にも、韓国語・中国語・記号・絵文字が混ざった文を入力して保存できる', async ({ page }) => {
  await openPdf(page, { field: true });
  const value = '山田 한국 这个 ※① ✔☑ 😀';
  const field = page.locator('input[data-field-name="name"]');
  await field.fill(value);
  await field.blur();
  const bytes = await save(page);
  expect(bytes.length).toBeLessThan(150_000);
  const saved = await PDFLib.PDFDocument.load(bytes);
  expect(saved.getForm().getTextField('name').getText()).toBe(value);
  expect(await missingGlyphs(page, bytes, value)).toEqual([]);
});

test('PDFに保存できない文字を入力すると、その場で知らせる', async ({ page }) => {
  await openPdf(page);
  await addText(page, 'タイ語 ภาษาไทย', 0.2);
  await expect(page.locator('#status')).toHaveText(/次の文字はPDFで表示できません.*ภ/);
  await expect(page.locator('#status')).toHaveClass(/error/);
});
