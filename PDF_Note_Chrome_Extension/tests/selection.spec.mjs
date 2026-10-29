import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PDFLib = require('../pdf-note/vendor/pdf-lib.min.js');

async function makePdf(pages) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([400, 600]);
  return Buffer.from(await doc.save());
}

async function openPdf(page, bytes) {
  await page.goto('/editor.html');
  await page.locator('#fileInput').setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(page.locator('#pageNumber')).toHaveText(/^1 \/ \d+$/);
  await page.waitForFunction(() => document.querySelector('.page-loading')?.hidden === true);
}

async function drag(page, from, to, steps = 8) {
  const box = await page.locator('#overlay').boundingBox();
  const at = ([x, y]) => [box.x + box.width * x, box.y + box.height * y];
  await page.mouse.move(...at(from));
  await page.mouse.down();
  await page.mouse.move(...at(to), { steps });
  await page.mouse.up();
}

// x of the first shape element inside each note group
const xs = (page) => page.locator('#overlay g[data-id] > :first-child').evaluateAll((els) => els.map((el) => Number(el.getAttribute('x'))));

test('drag selects a range; Shift+drag selects from a drawing tool without leaving it; groups move and delete together', async ({
  page,
}) => {
  await openPdf(page, await makePdf(2));
  await page.click('[data-tool=rect]');
  await drag(page, [0.1, 0.1], [0.2, 0.15]); // A
  await drag(page, [0.3, 0.1], [0.4, 0.15]); // B
  await drag(page, [0.1, 0.6], [0.2, 0.65]); // C
  await expect(page.locator('#overlay g[data-id]')).toHaveCount(3);

  // Range drag in the select tool picks A and B but not C.
  await page.click('[data-tool=select]');
  await drag(page, [0.05, 0.05], [0.5, 0.2]);
  await expect(page.locator('#selectionInfo')).toContainText('2個の書き込みを選択中');

  // Dragging one selected note moves the whole group by the same amount.
  const before = await xs(page);
  await drag(page, [0.1, 0.125], [0.2, 0.125]); // grab A's left edge (unfilled shapes are hit on the stroke)
  const after = await xs(page);
  expect(after[0] - before[0]).toBeGreaterThan(10);
  expect(after[1] - before[1]).toBeCloseTo(after[0] - before[0], 1);
  expect(after[2]).toBeCloseTo(before[2], 1);

  // Delete removes the whole group.
  await page.keyboard.press('Delete');
  await expect(page.locator('#overlay g[data-id]')).toHaveCount(1);

  // Shift+drag from the pen tool selects instead of drawing, and stays on the pen tool.
  await page.click('[data-tool=pen]');
  await page.keyboard.down('Shift');
  await drag(page, [0.05, 0.55], [0.3, 0.7]);
  await page.keyboard.up('Shift');
  await expect(page.locator('#overlay g[data-id]')).toHaveCount(1);
  await expect(page.locator('button[data-tool=pen]')).toHaveClass(/active/);
  await page.keyboard.press('ArrowRight'); // the selection can still be moved from the pen tool
  await expect(page.locator('#selectionInfo')).toContainText('四角を選択中');
});

test('the thumbnail list follows the page shown in the continuous view', async ({ page }) => {
  await openPdf(page, await makePdf(12));
  await page.selectOption('#viewMode', 'continuous');
  await expect(page.locator('#pageStack .page-wrap')).toHaveCount(12);
  await page.locator('#workspace').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator('#pageNumber')).toHaveText('12 / 12');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const list = document.getElementById('pageThumbs').getBoundingClientRect();
        const card = document.querySelector('.thumb-card.selected-page').getBoundingClientRect();
        return card.top >= list.top - 1 && card.bottom <= list.bottom + 1;
      }),
    )
    .toBe(true);
});

test('a click with the pen leaves a dot that is saved to the PDF', async ({ page }) => {
  await openPdf(page, await makePdf(1));
  await page.click('[data-tool=pen]');
  await page.fill('#lineWidth', '20');
  await page.locator('#lineWidth').dispatchEvent('change');
  const box = await page.locator('#overlay').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect(page.locator('#overlay g[data-id]')).toHaveCount(1);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  const bytes = await (await import('node:fs/promises')).readFile(await download.path());
  const result = await page.evaluate(async (b64) => {
    const pdfjs = await import('/vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
    const p = await doc.getPage(1);
    const viewport = p.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 1] < 150) dark++;
    return dark;
  }, bytes.toString('base64'));
  // A 20pt dot covers about pi * 10^2 = 314 pixels.
  expect(result).toBeGreaterThan(250);
  expect(result).toBeLessThan(400);
});
