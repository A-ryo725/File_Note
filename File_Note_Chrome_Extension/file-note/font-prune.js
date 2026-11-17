// Shrinks a TrueType font for PDF embedding: outlines of unused glyphs are dropped.
// Glyph ids and metrics are untouched, so text encoded against the full font still
// shows the same. (pdf-lib's own subsetting drops glyphs of Noto Sans JP.)
// cmap lets a viewer that redraws form fields find the glyph of a character.
const KEPT_TABLES = ['OS/2', 'cmap', 'cvt ', 'fpgm', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post', 'prep'];

// Records the glyph ids pdf-lib writes with this font, from now on.
export function trackGlyphs(font) {
  const used = new Set();
  const encode = font.encodeText.bind(font);
  font.encodeText = (text) => {
    const hex = encode(text);
    // Four hex digits per glyph.
    for (const [id] of hex.toString().matchAll(/[0-9a-f]{4}/gi)) used.add(parseInt(id, 16));
    // Text shaping swaps in alternate glyphs (digits between Latin letters, for one).
    // A viewer that redraws a form field itself uses the plain glyph of each character.
    for (const ch of text) used.add(font.embedder.font.glyphForCodePoint(ch.codePointAt(0)).id);
    return hex;
  };
  return used;
}

// Replaces the embedded file of this font. Call after doc.flush(), which writes the font.
export function pruneEmbeddedFont(doc, font, fontBytes, glyphIds) {
  const { PDFName, PDFDict, PDFArray } = globalThis.PDFLib;
  const descendants = doc.context.lookup(font.ref, PDFDict).lookup(PDFName.of('DescendantFonts'), PDFArray);
  const descriptor = descendants.lookup(0, PDFDict).lookup(PDFName.of('FontDescriptor'), PDFDict);
  const file = descriptor.get(PDFName.of('FontFile2'));
  if (file) doc.context.assign(file, doc.context.flateStream(pruneFont(fontBytes, glyphIds)));
}

export function pruneFont(source, glyphIds) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map();
  for (let i = 0, count = view.getUint16(4); i < count; i++) {
    const at = 12 + i * 16;
    tables.set(String.fromCharCode(...bytes.subarray(at, at + 4)), { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) });
  }
  const head = tables.get('head'),
    maxp = tables.get('maxp'),
    loca = tables.get('loca'),
    glyf = tables.get('glyf');
  // Fonts with CFF outlines are embedded whole.
  if (!head || !maxp || !loca || !glyf) return bytes;

  const glyphCount = view.getUint16(maxp.offset + 4);
  const long = view.getInt16(head.offset + 50) === 1;
  const start = (id) => (long ? view.getUint32(loca.offset + id * 4) : view.getUint16(loca.offset + id * 2) * 2);

  // Composite glyphs draw other glyphs: those must stay too.
  const keep = new Set();
  const pending = [0, ...glyphIds];
  while (pending.length) {
    const id = pending.pop();
    if (!(id >= 0 && id < glyphCount) || keep.has(id)) continue;
    keep.add(id);
    const from = glyf.offset + start(id),
      to = glyf.offset + start(id + 1);
    if (to - from < 10 || view.getInt16(from) >= 0) continue;
    for (let at = from + 10, more = true; more && at + 4 <= to;) {
      const flags = view.getUint16(at);
      pending.push(view.getUint16(at + 2));
      at += 4 + (flags & 0x1 ? 4 : 2) + (flags & 0x8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
      more = Boolean(flags & 0x20);
    }
  }

  const parts = [],
    newLoca = new Uint8Array((glyphCount + 1) * 4),
    locaView = new DataView(newLoca.buffer);
  let size = 0;
  for (let id = 0; id < glyphCount; id++) {
    locaView.setUint32(id * 4, size);
    if (!keep.has(id)) continue;
    const data = bytes.subarray(glyf.offset + start(id), glyf.offset + start(id + 1));
    parts.push([size, data]);
    size += (data.length + 3) & ~3;
  }
  locaView.setUint32(glyphCount * 4, size);
  const newGlyf = new Uint8Array(size);
  for (const [at, data] of parts) newGlyf.set(data, at);
  const newHead = bytes.slice(head.offset, head.offset + head.length);
  new DataView(newHead.buffer).setUint32(8, 0); // checkSumAdjustment, filled in below
  new DataView(newHead.buffer).setInt16(50, 1); // long loca offsets

  const output = KEPT_TABLES.filter((tag) => tables.has(tag)).map((tag) => {
    const table = tables.get(tag);
    const data =
      tag === 'glyf'
        ? newGlyf
        : tag === 'loca'
          ? newLoca
          : tag === 'head'
            ? newHead
            : bytes.subarray(table.offset, table.offset + table.length);
    return { tag, data };
  });
  let offset = 12 + output.length * 16;
  for (const table of output) {
    table.offset = offset;
    offset += (table.data.length + 3) & ~3;
  }
  const result = new Uint8Array(offset),
    out = new DataView(result.buffer);
  const checksum = (from, length) => {
    let sum = 0;
    for (let at = from, end = from + ((length + 3) & ~3); at < end; at += 4) sum = (sum + out.getUint32(at)) >>> 0;
    return sum;
  };
  const power = 2 ** Math.floor(Math.log2(output.length));
  out.setUint32(0, 0x00010000);
  out.setUint16(4, output.length);
  out.setUint16(6, power * 16);
  out.setUint16(8, Math.log2(power));
  out.setUint16(10, output.length * 16 - power * 16);
  for (const [i, table] of output.entries()) {
    result.set(table.data, table.offset);
    const at = 12 + i * 16;
    for (let c = 0; c < 4; c++) result[at + c] = table.tag.charCodeAt(c);
    out.setUint32(at + 4, checksum(table.offset, table.data.length));
    out.setUint32(at + 8, table.offset);
    out.setUint32(at + 12, table.data.length);
  }
  out.setUint32(output.find((table) => table.tag === 'head').offset + 8, (0xb1b0afba - checksum(0, result.length)) >>> 0);
  return result;
}
