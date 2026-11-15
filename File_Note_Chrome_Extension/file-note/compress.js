// Optional size reduction on save: only raster images are re-encoded.
// Text, vector drawings and forms are never touched.
export const JPEG_QUALITY = 0.6;
export const MAX_SIDE = 2000;

// Draws at most MAX_SIDE pixels on the long side.
function toCanvas(bitmap) {
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}
const toJpeg = (canvas) => canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });

// Re-encodes the image XObjects of the document in place. Images in formats that
// cannot be redrawn faithfully (masks, CMYK, indexed, 1-bit, JPEG 2000…) are kept.
export async function compressImages(doc) {
  const { PDFName: N, PDFRawStream, PDFArray, PDFDict, PDFNumber, PDFBool, decodePDFRawStream } = globalThis.PDFLib;
  const context = doc.context;
  const name = (key) => N.of(key);
  const number = (dict, key) => {
    const value = dict.lookup(name(key));
    return value instanceof PDFNumber ? value.asNumber() : undefined;
  };
  const single = (value) => (value instanceof PDFArray && value.size() === 1 ? value.lookup(0) : value);
  const channelsOf = (dict) => {
    const space = dict.lookup(name('ColorSpace'));
    if (space === name('DeviceRGB')) return 3;
    if (space === name('DeviceGray')) return 1;
    if (space instanceof PDFArray && space.size() === 2 && space.lookup(0) === name('ICCBased')) {
      const profile = space.lookup(1);
      const n = profile?.dict ? number(profile.dict, 'N') : 0;
      return n === 1 || n === 3 ? n : 0;
    }
    return 0;
  };
  const decode = (stream, filter, channels) => {
    if (filter === name('DCTDecode')) return createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' }));
    const width = number(stream.dict, 'Width'),
      height = number(stream.dict, 'Height'),
      raw = decodePDFRawStream(stream).decode();
    if (!width || !height || raw.length < width * height * channels) throw new Error('画像データの長さが合いません');
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let from = 0, to = 0; to < rgba.length; from += channels, to += 4) {
      rgba[to] = raw[from];
      rgba[to + 1] = raw[channels === 3 ? from + 1 : from];
      rgba[to + 2] = raw[channels === 3 ? from + 2 : from];
      rgba[to + 3] = 255;
    }
    return createImageBitmap(new ImageData(rgba, width, height));
  };

  const images = context
    .enumerateIndirectObjects()
    .filter(([, object]) => object instanceof PDFRawStream && object.dict.get(name('Subtype')) === name('Image'));
  // A soft mask is an image too, but JPEG artifacts in it would show as dirty edges.
  const softMasks = new Set(images.map(([, stream]) => stream.dict.get(name('SMask'))).filter(Boolean));
  for (const [ref, stream] of images) {
    try {
      const dict = stream.dict;
      if (softMasks.has(ref) || number(dict, 'BitsPerComponent') !== 8) continue;
      if (dict.lookup(name('ImageMask')) === PDFBool.True || dict.has(name('Mask')) || dict.has(name('Decode'))) continue;
      const channels = channelsOf(dict);
      if (!channels) continue;
      const filter = single(dict.lookup(name('Filter')));
      if (filter === name('FlateDecode')) {
        const parms = single(dict.lookup(name('DecodeParms')));
        if (parms instanceof PDFArray || (parms instanceof PDFDict && (number(parms, 'Predictor') ?? 1) > 1)) continue;
      } else if (filter !== name('DCTDecode')) continue;

      const canvas = toCanvas(await decode(stream, filter, channels));
      const bytes = new Uint8Array(await (await toJpeg(canvas)).arrayBuffer());
      if (bytes.length >= stream.contents.length) continue;
      // The canvas always writes a 3-component JPEG, whatever the source was.
      dict.set(name('Width'), context.obj(canvas.width));
      dict.set(name('Height'), context.obj(canvas.height));
      dict.set(name('ColorSpace'), name('DeviceRGB'));
      dict.set(name('BitsPerComponent'), context.obj(8));
      dict.set(name('Filter'), name('DCTDecode'));
      dict.delete(name('DecodeParms'));
      context.assign(ref, PDFRawStream.of(dict, bytes));
    } catch (e) {
      // One unusual image must not make the whole save fail.
      console.warn(`画像 ${ref} を圧縮できませんでした：`, e);
    }
  }
}

function hasAlpha(canvas) {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}
const readAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// For photos added in the editor. Returns the argument when nothing is gained.
export async function recompressDataUrl(dataUrl) {
  try {
    const comma = dataUrl.indexOf(',');
    const type = dataUrl.slice(5, dataUrl.indexOf(';'));
    const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type }));
    const shrunk = Math.max(bitmap.width, bitmap.height) > MAX_SIDE;
    const canvas = toCanvas(bitmap);
    // Transparency cannot survive JPEG: such images are only made smaller in pixels.
    const transparent = type === 'image/png' && hasAlpha(canvas);
    if (transparent && !shrunk) return dataUrl;
    const result = await readAsDataUrl(transparent ? await canvas.convertToBlob({ type: 'image/png' }) : await toJpeg(canvas));
    return result.length < dataUrl.length ? result : dataUrl;
  } catch (e) {
    console.warn('写真を圧縮できませんでした：', e);
    return dataUrl;
  }
}
