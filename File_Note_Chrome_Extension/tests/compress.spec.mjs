import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const PDFLib = require('../file-note/vendor/pdf-lib.min.js');
const { PDFDocument, PDFName: N, PDFRawStream, PDFArray, StandardFonts } = PDFLib;

test.beforeEach(async ({ page }) => {
  // Native file dialogs cannot be driven by tests; use the <input>/download fallbacks.
  await page.addInitScript(() => {
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });
  await page.goto('/editor.html');
});

// Random pixels: an image that stays large however it is compressed.
async function noise(page, w, h, type, { quality = 0.9, alpha = false } = {}) {
  const b64 = await page.evaluate(
    ({ w, h, type, quality, alpha }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d'),
        img = ctx.createImageData(w, h),
        d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.random() * 256;
        d[i + 1] = Math.random() * 256;
        d[i + 2] = Math.random() * 256;
        d[i + 3] = alpha ? 64 + Math.random() * 128 : 255;
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL(type, quality).split(',')[1];
    },
    { w, h, type, quality, alpha },
  );
  return Buffer.from(b64, 'base64');
}

// Runs buildPdf inside the page and returns the output bytes.
async function build(page, pdfBytes, compress, annotation) {
  const out = await page.evaluate(
    async ({ b64, compress, annotation }) => {
      const { buildPdf } = await import(new URL('export.js', location.href).href);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const doc = await PDFLib.PDFDocument.load(bytes);
      const pages = doc.getPages().map((_, i) => ({ source: 0, page: i }));
      const annotations = pages.map(() => []);
      if (annotation) annotations[0].push(annotation);
      const result = await buildPdf({
        sources: [{ bytes }],
        pages,
        annotations,
        dimensions: [{ width: 400, height: 600 }],
        fontBytes: null,
        compress,
      });
      let s = '';
      for (let i = 0; i < result.length; i += 32768) s += String.fromCharCode(...result.subarray(i, i + 32768));
      return btoa(s);
    },
    { b64: pdfBytes.toString('base64'), compress, annotation },
  );
  return Buffer.from(out, 'base64');
}

// Image XObjects of a PDF. Soft masks are reported on their owner, not as images of their own.
async function images(bytes) {
  const doc = await PDFDocument.load(bytes);
  const all = doc.context
    .enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFRawStream && o.dict.get(N.of('Subtype')) === N.of('Image'));
  const masks = new Set(all.map(([, o]) => o.dict.get(N.of('SMask'))).filter(Boolean));
  const text = (v) => (v instanceof PDFArray && v.size() === 1 ? v.get(0) : v)?.toString();
  return all
    .filter(([ref]) => !masks.has(ref))
    .map(([ref, o]) => {
      const mask = o.dict.lookup(N.of('SMask'));
      return {
        ref: ref.toString(),
        width: o.dict.lookup(N.of('Width')).asNumber(),
        height: o.dict.lookup(N.of('Height')).asNumber(),
        bits: o.dict.lookup(N.of('BitsPerComponent')).asNumber(),
        filter: text(o.dict.lookup(N.of('Filter'))),
        colorSpace: o.dict.lookup(N.of('ColorSpace')).toString(),
        data: Buffer.from(o.contents),
        mask: mask ? Buffer.from(mask.contents) : null,
      };
    });
}

async function pageContent(bytes, index = 0) {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(index).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  return Buffer.concat(streams.map((s) => Buffer.from(PDFLib.decodePDFRawStream(s).decode())));
}

async function jpegPdf(page, { pageCount = 1 } = {}) {
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(await noise(page, 3000, 2000, 'image/jpeg', { quality: 0.95 }));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const p = doc.addPage([400, 600]);
    p.drawImage(image, { x: 20, y: 300, width: 360, height: 240 });
    p.drawText('Hello', { x: 20, y: 100, size: 24, font });
  }
  return Buffer.from(await doc.save());
}

async function pngPdf(page, w, h, alpha) {
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(await noise(page, w, h, 'image/png', { alpha }));
  doc.addPage([400, 600]).drawImage(image, { x: 20, y: 300, width: 360, height: 240 });
  return Buffer.from(await doc.save());
}

// A PDF holding one hand-made image XObject.
async function rawImagePdf(dict, data) {
  const doc = await PDFDocument.create();
  const ref = doc.context.register(doc.context.stream(data, { Type: 'XObject', Subtype: 'Image', ...dict }));
  doc.addPage([400, 600]).node.newXObject('Im', ref);
  return Buffer.from(await doc.save());
}

test('JPEG画像を縮小・再圧縮する', async ({ page }) => {
  const input = await jpegPdf(page);
  const output = await build(page, input, true);
  expect(output.length).toBeLessThan(input.length * 0.5);
  const [image, ...rest] = await images(output);
  expect(rest).toHaveLength(0);
  expect(image).toMatchObject({ width: 2000, height: 1333, filter: '/DCTDecode', colorSpace: '/DeviceRGB' });
  expect((await PDFDocument.load(output)).getPageCount()).toBe(1);
  expect((await pageContent(output)).equals(await pageContent(input))).toBe(true);
});

test('Flate画像をJPEGにする', async ({ page }) => {
  const input = await pngPdf(page, 1200, 800, false);
  expect((await images(input))[0].filter).toBe('/FlateDecode');
  const output = await build(page, input, true);
  expect(output.length).toBeLessThan(input.length);
  const [image] = await images(output);
  expect(image).toMatchObject({ width: 1200, height: 800, filter: '/DCTDecode', colorSpace: '/DeviceRGB', mask: null });
});

test('透過画像はSMaskを保つ', async ({ page }) => {
  const input = await pngPdf(page, 800, 600, true);
  const [before] = await images(input);
  expect(before.mask).not.toBeNull();
  const [after] = await images(await build(page, input, true));
  expect(after.filter).toBe('/DCTDecode');
  expect(after.mask.equals(before.mask)).toBe(true);
});

test('対象外の画像は触らない', async ({ page }) => {
  const input = await rawImagePdf({ Width: 16, Height: 16, ColorSpace: 'DeviceGray', BitsPerComponent: 1 }, new Uint8Array(32).fill(0xaa));
  const [before] = await images(input);
  const [after] = await images(await build(page, input, true));
  expect(after).toEqual(before);
});

test('壊れたJPEGは元のまま残す', async ({ page }) => {
  const junk = Uint8Array.from({ length: 5000 }, (_, i) => (i * 37) % 251);
  const input = await rawImagePdf({ Width: 100, Height: 100, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode' }, junk);
  const [before] = await images(input);
  const [after] = await images(await build(page, input, true));
  expect(after).toEqual(before);
});

test('Filterが1要素配列でも圧縮する', async ({ page }) => {
  const doc = await PDFDocument.load(await jpegPdf(page));
  const [, stream] = doc.context.enumerateIndirectObjects().find(([, o]) => o instanceof PDFRawStream && o.dict.get(N.of('Subtype')) === N.of('Image'));
  stream.dict.set(N.of('Filter'), doc.context.obj(['DCTDecode']));
  const [image] = await images(await build(page, Buffer.from(await doc.save()), true));
  expect(image).toMatchObject({ width: 2000, height: 1333, filter: '/DCTDecode' });
});

test('共有画像は全ページで残る', async ({ page }) => {
  const output = await build(page, await jpegPdf(page, { pageCount: 2 }), true);
  const found = await images(output);
  expect(found).toHaveLength(1);
  expect(found[0].width).toBe(2000);
  const doc = await PDFDocument.load(output);
  const used = doc.getPages().map((p) => p.node.Resources().lookup(N.of('XObject')).values().map(String));
  expect(used[0]).toContain(found[0].ref);
  expect(used[1]).toContain(found[0].ref);
});

test('compress=false は何も変えない', async ({ page }) => {
  const input = await jpegPdf(page);
  const [before] = await images(input);
  const [after] = await images(await build(page, input, false));
  expect(after).toEqual(before);
});

// ---- Photos added in the editor ----

async function blankPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  return Buffer.from(await doc.save());
}
const photo = (bytes, type) => ({ type: 'image', x: 0, y: 0, w: 200, h: 133, data: `data:${type};base64,${bytes.toString('base64')}` });

test('追加写真を再圧縮する', async ({ page }) => {
  const note = photo(await noise(page, 2400, 1600, 'image/jpeg'), 'image/jpeg');
  const plain = await build(page, await blankPdf(), false, note);
  const small = await build(page, await blankPdf(), true, note);
  expect((await images(plain))[0]).toMatchObject({ width: 2400, height: 1600 });
  expect((await images(small))[0]).toMatchObject({ width: 2000, height: 1333, filter: '/DCTDecode' });
  expect(small.length).toBeLessThan(plain.length);
});

test('透過PNGは透過を保ち縮小だけする', async ({ page }) => {
  const note = photo(await noise(page, 2400, 1600, 'image/png', { alpha: true }), 'image/png');
  const [image] = await images(await build(page, await blankPdf(), true, note));
  expect(image).toMatchObject({ width: 2000, height: 1333, filter: '/FlateDecode' });
  expect(image.mask).not.toBeNull();
});

test('小さい透過PNGはそのまま', async ({ page }) => {
  const note = photo(await noise(page, 300, 200, 'image/png', { alpha: true }), 'image/png');
  const [plain] = await images(await build(page, await blankPdf(), false, note));
  const [small] = await images(await build(page, await blankPdf(), true, note));
  expect(small.data.equals(plain.data)).toBe(true);
  expect(small.mask.equals(plain.mask)).toBe(true);
});

// ---- Editor UI ----

async function openPdf(page, bytes) {
  await page.locator('#fileInput').setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(page.locator('#pageNumber')).toHaveText(/^1 \/ \d+$/);
  await page.waitForFunction(() => document.querySelector('.page-loading')?.hidden === true);
}
async function save(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  return readFile(await download.path());
}

test('チェックありで保存すると小さくなる', async ({ page }) => {
  const input = await jpegPdf(page);
  await openPdf(page, input);
  await page.check('#compress');
  const output = await save(page);
  expect(output.length).toBeLessThan(input.length * 0.5);
  await expect(page.locator('#status')).toHaveText(/^編集済みPDFをダウンロードしました/);
});

test('チェックなしは従来どおり', async ({ page }) => {
  await openPdf(page, await jpegPdf(page));
  await expect(page.locator('#compress')).not.toBeChecked();
  expect((await images(await save(page)))[0]).toMatchObject({ width: 3000, height: 2000 });
});

test('チェック状態を記憶する', async ({ page }) => {
  await openPdf(page, await blankPdf());
  await page.check('#compress');
  await page.reload();
  await expect(page.locator('#compress')).toBeChecked();
});

test('PDFを開く前は無効', async ({ page }) => {
  await expect(page.locator('#compress')).toBeDisabled();
});

test('localStorageが使えなくても動く', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const fail = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    Storage.prototype.getItem = fail;
    Storage.prototype.setItem = fail;
    Storage.prototype.removeItem = fail;
  });
  await page.reload();
  await openPdf(page, await jpegPdf(page));
  await page.check('#compress');
  expect((await images(await save(page)))[0].width).toBe(2000);
  expect(errors).toEqual([]);
});
