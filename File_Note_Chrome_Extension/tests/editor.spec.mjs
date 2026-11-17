import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const PDFLib = require('../file-note/vendor/pdf-lib.min.js');

// A 2-page PDF: page 1 has a text field, checkbox, radio group and dropdown.
async function makePdf({ withForm = true } = {}) {
  const doc = await PDFLib.PDFDocument.create();
  const first = doc.addPage([400, 600]);
  doc.addPage([400, 600]);
  if (withForm) {
    const form = doc.getForm();
    form.createTextField('name').addToPage(first, { x: 50, y: 540, width: 200, height: 24 });
    form.createCheckBox('agree').addToPage(first, { x: 50, y: 500, width: 18, height: 18 });
    const radio = form.createRadioGroup('plan');
    radio.addOptionToPage('A', first, { x: 50, y: 460, width: 16, height: 16 });
    radio.addOptionToPage('B', first, { x: 100, y: 460, width: 16, height: 16 });
    const city = form.createDropdown('city');
    city.addOptions(['tokyo', 'osaka', 'nagoya']);
    city.addToPage(first, { x: 50, y: 410, width: 150, height: 24 });
  }
  return Buffer.from(await doc.save());
}

async function openPdf(page, bytes, name = 'sample.pdf') {
  // Native file dialogs cannot be driven by tests; use the <input>/download fallbacks.
  await page.addInitScript(() => {
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });
  await page.goto('/editor.html');
  await page.locator('#fileInput').setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
  await expect(page.locator('#pageNumber')).toHaveText(/^1 \/ \d+$/);
  await expect(page.locator('#pageStack .page-wrap')).toHaveCount(1);
  await page.waitForFunction(() => document.querySelector('.page-loading')?.hidden === true);
}

// Drag across the page using fractions of the overlay box.
async function drag(page, from, to, steps = 8) {
  const box = await page.locator('#overlay').boundingBox();
  const at = ([x, y]) => [box.x + box.width * x, box.y + box.height * y];
  await page.mouse.move(...at(from));
  await page.mouse.down();
  await page.mouse.move(...at(to), { steps });
  await page.mouse.up();
}

test('annotations, forms, page tools and PDF export', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openPdf(page, await makePdf());

  // Form widgets: text, checkbox, radio and dropdown.
  await page.locator('input[data-field-name="name"]').fill('山田太郎');
  await page.locator('input[type=checkbox][data-field-name="agree"]').check();
  await page.locator('input[type=radio][data-button-value="1"]').check();
  await page.locator('select[data-field-name="city"]').selectOption('osaka');

  // Text (Japanese), then every drawing tool.
  await page.click('[data-tool=text]');
  const box = await page.locator('#overlay').boundingBox();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.33);
  await page.fill('#textValue', '日本語テスト ABC');
  await page.click('#textConfirm');
  await expect(page.locator('#overlay g[data-id]')).toHaveCount(1);

  const shapes = {
    rect: [0.1, 0.65],
    ellipse: [0.5, 0.65],
    arrow: [0.1, 0.8],
    line: [0.1, 0.9],
    highlight: [0.5, 0.9],
  };
  for (const [tool, [x, y]] of Object.entries(shapes)) {
    await page.click(`[data-tool=${tool}]`);
    await expect(page.locator('#fillRow')).toBeVisible({ visible: tool === 'rect' || tool === 'ellipse' });
    if (tool === 'ellipse') await page.check('#fill');
    await drag(page, [x, y], [x + 0.25, y + 0.07]);
  }
  await expect(page.locator('#overlay ellipse[fill="#e15244"]')).toHaveCount(1); // only the filled one
  await page.click('[data-tool=pen]');
  await drag(page, [0.1, 0.96], [0.7, 0.97], 60);
  await expect(page.locator('#overlay g[data-id]')).toHaveCount(7);

  // Photo: stays a JPEG when the source is a JPEG.
  const jpeg = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 120;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3366cc';
    ctx.fillRect(0, 0, 200, 120);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await page.locator('#imageInput').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
  await expect(page.locator('#overlay image')).toHaveCount(1);
  expect(await page.locator('#overlay image').getAttribute('href')).toMatch(/^data:image\/jpeg/);

  // Arrow keys move the selection; one burst is one undo step.
  const x0 = Number(await page.locator('#overlay image').getAttribute('x'));
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  expect(Number(await page.locator('#overlay image').getAttribute('x'))).toBeCloseTo(x0 + 3, 1);
  await page.keyboard.press('Control+z');
  expect(Number(await page.locator('#overlay image').getAttribute('x'))).toBeCloseTo(x0, 1);

  // Copy / paste of a selected note (undo clears the selection, so select it again).
  await page.locator('#overlay image').click();
  await page.keyboard.press('Control+c');
  await page.evaluate(() =>
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true })),
  );
  await expect(page.locator('#overlay image')).toHaveCount(2);

  // Rotation is refused on a page with notes, allowed on a clean page.
  await page.click('#railRotate');
  await expect(page.locator('#status')).toContainText('回転できません');
  await page.locator('.thumb-card').nth(1).click();
  await expect(page.locator('#pageNumber')).toHaveText('2 / 2');
  await page.click('#railRotate');
  await expect(page.locator('#status')).toContainText('回転しました');
  await page.click('#railBlank');
  await expect(page.locator('#pageNumber')).toHaveText('3 / 3');

  // Save and inspect the output.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  const bytes = await readFile(await download.path());
  expect(download.suggestedFilename()).toBe('sample_edited.pdf');
  expect(bytes.length).toBeLessThan(400_000); // the fonts for notes and form fields keep only the glyphs in use
  expect(bytes.includes(Buffer.from('/DCTDecode'))).toBe(true);

  const out = await PDFLib.PDFDocument.load(bytes);
  expect(out.getPageCount()).toBe(3);
  expect(out.getPage(1).getRotation().angle).toBe(90);
  const form = out.getForm();
  expect(form.getTextField('name').getText()).toBe('山田太郎');
  expect(form.getCheckBox('agree').isChecked()).toBe(true);
  expect(form.getRadioGroup('plan').getSelected()).toBe('B');
  expect(form.getDropdown('city').getSelected()).toEqual(['osaka']);

  // Japanese text survives subsetting and actually draws glyphs.
  const result = await page.evaluate(async (b64) => {
    const pdfjs = await import('/vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({
      data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      cMapUrl: '/vendor/cmaps/',
      cMapPacked: true,
    }).promise;
    const p = await doc.getPage(1);
    const text = (await p.getTextContent()).items.map((i) => i.str).join('');
    const viewport = p.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const { data } = canvas.getContext('2d').getImageData(100, 198, 150, 20);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 100 && data[i + 1] < 100 && data[i + 2] < 100) dark++;
    // Rightmost dark pixel inside the text field: all four characters must be drawn.
    const field = canvas.getContext('2d').getImageData(54, 40, 190, 18);
    let nameRight = 0;
    for (let y = 0; y < field.height; y++)
      for (let x = 0; x < field.width; x++) if (field.data[(y * field.width + x) * 4] < 100) nameRight = Math.max(nameRight, 54 + x);
    return { text, dark, nameRight };
  }, bytes.toString('base64'));
  expect(result.text).toContain('日本語テスト');
  expect(result.dark).toBeGreaterThan(50);
  expect(result.nameRight).toBeGreaterThan(115);
  expect(errors).toEqual([]);
});

test('project file keeps notes and simplifies pen strokes', async ({ page }) => {
  await openPdf(page, await makePdf({ withForm: false }));
  await page.click('[data-tool=pen]');
  await drag(page, [0.1, 0.5], [0.8, 0.52], 80);
  await page.click('[data-tool=rect]');
  await drag(page, [0.2, 0.2], [0.5, 0.3]);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#projectSave')]);
  expect(download.suggestedFilename()).toBe('sample.filenote');
  await expect(page.locator('#projectInput')).toHaveAttribute('accept', /\.filenote/);
  const text = await readFile(await download.path(), 'utf8');
  const project = JSON.parse(text);
  const pen = project.annotations[0].find((o) => o.type === 'pen');
  expect(pen.points.length).toBeLessThan(20); // 80 near-collinear moves collapse
  expect(project.annotations[0].some((o) => o.type === 'rect')).toBe(true);

  await page.reload();
  expect(project.format).toBe('file-note');
  await expect(page.locator('#projectInput')).not.toHaveAttribute('accept', /pdfnote/);
  await page.locator('#projectInput').setInputFiles({ name: 'sample.filenote', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('#overlay g[data-id]')).toHaveCount(2);
});

test('dropping several PDFs joins them, dropping an image adds a photo', async ({ page }) => {
  const bytes = await makePdf({ withForm: false });
  await openPdf(page, bytes);
  await page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], 'a.pdf', { type: 'application/pdf' }));
    transfer.items.add(new File([data], 'b.pdf', { type: 'application/pdf' }));
    document.getElementById('workspace').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, bytes.toString('base64'));
  await expect(page.locator('.thumb-card')).toHaveCount(4);

  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 40;
    c.getContext('2d').fillRect(0, 0, 40, 40);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.evaluate(async (b64) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'x.png', { type: 'image/png' }));
    document.getElementById('workspace').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, png);
  await expect(page.locator('#overlay image')).toHaveCount(1);
});

test('saved PDFs list every object number, so strict readers (MuPDF) accept them', async ({ page }) => {
  // A source with a hole in its object numbers, as left by tools that delete objects.
  const doc = await PDFLib.PDFDocument.create();
  doc.addPage([400, 600]);
  const gone = doc.context.register(doc.context.obj({}));
  doc.addPage([400, 600]);
  doc.context.delete(gone);
  await openPdf(page, Buffer.from(await doc.save({ useObjectStreams: false })));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  const bytes = await readFile(await download.path());

  // The cross-reference stream must be one unbroken run: no /Index, or /Index [0 Size].
  const text = bytes.toString('latin1');
  const start = Number(text.match(/startxref\s+(\d+)\s+%%EOF\s*$/)[1]);
  const dict = text.slice(start, text.indexOf('stream', start));
  const size = Number(dict.match(/\/Size\s+(\d+)/)[1]);
  const index = dict.match(/\/Index\s*\[([^\]]*)\]/)?.[1].trim().split(/\s+/).map(Number) ?? [0, size];
  expect(index).toEqual([0, size]);
  expect((await PDFLib.PDFDocument.load(bytes)).getPageCount()).toBe(2);
});

test('text notes embed only the glyphs in use, not the whole font', async ({ page }) => {
  await openPdf(page, await makePdf({ withForm: false }));
  const text = '課題6 main()関数 あいう ABC 123、。';
  await page.click('[data-tool=text]');
  const box = await page.locator('#overlay').boundingBox();
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.fill('#textValue', text);
  await page.click('#textConfirm');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  const bytes = await readFile(await download.path());
  expect(bytes.length).toBeLessThan(150_000); // the whole font would add 1.4 MB

  // Every character is still extractable and drawn.
  const result = await page.evaluate(async (b64) => {
    const pdfjs = await import('/vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), cMapUrl: '/vendor/cmaps/', cMapPacked: true })
      .promise;
    const p = await doc.getPage(1);
    const viewport = p.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 100 && data[i + 1] < 100 && data[i + 2] < 100) dark++;
    return { text: (await p.getTextContent()).items.map((i) => i.str).join(''), dark };
  }, bytes.toString('base64'));
  expect(result.text).toBe(text);
  expect(result.dark).toBeGreaterThan(2500);
});

test('form text keeps the plain glyph of every character, for viewers that redraw fields', async ({ page }) => {
  await openPdf(page, await makePdf());
  // Between Latin letters, digits are drawn with alternate glyphs. A viewer that
  // redraws the field (NeedAppearances) uses the plain ones instead.
  const value = 'uint8_t x2 = 9;';
  await page.locator('input[data-field-name="name"]').fill(value);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  const bytes = await readFile(await download.path());
  expect(bytes.length).toBeLessThan(200_000);

  const missing = await page.evaluate(
    async ({ b64, value }) => {
      const { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } = PDFLib;
      const doc = await PDFDocument.load(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      const full = fontkit.create(new Uint8Array(await (await fetch('fonts/NotoSansJP-Regular.ttf')).arrayBuffer()));
      const failures = [];
      for (const [, object] of doc.context.enumerateIndirectObjects()) {
        const file = object instanceof PDFDict && object.lookup(PDFName.of('FontFile2'));
        if (!(file instanceof PDFRawStream)) continue;
        const font = decodePDFRawStream(file).decode();
        const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
        let loca;
        for (let i = 0; i < view.getUint16(4); i++)
          if (String.fromCharCode(...font.subarray(12 + i * 16, 16 + i * 16)) === 'loca') loca = view.getUint32(12 + i * 16 + 8);
        for (const ch of value.replaceAll(' ', '')) {
          const id = full.glyphForCodePoint(ch.codePointAt(0)).id;
          if (view.getUint32(loca + id * 4 + 4) === view.getUint32(loca + id * 4)) failures.push(ch);
        }
        failures.push('checked');
      }
      return failures;
    },
    { b64: bytes.toString('base64'), value },
  );
  expect(missing).toEqual(['checked']);
});

test('PDF save is a download even where the save dialog exists, like the project save', async ({ page }) => {
  // A save dialog that reports "cancelled" (as Chrome does for some folders) must not swallow the save.
  await page.addInitScript(() => {
    delete window.showOpenFilePicker;
    window.showSaveFilePicker = async () => {
      window.saveDialogShown = true;
      throw new DOMException('The user aborted a request.', 'AbortError');
    };
  });
  await page.goto('/editor.html');
  await page.locator('#fileInput').setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: await makePdf() });
  await expect(page.locator('#pageNumber')).toHaveText(/^1 \/ \d+$/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  expect(download.suggestedFilename()).toBe('a_edited.pdf');
  expect(await page.evaluate(() => window.saveDialogShown)).toBeUndefined();
  await expect(page.locator('#status')).toHaveText(/ダウンロードしました/);
});
