// Shrinks a TrueType font for PDF embedding: outlines of unused glyphs are dropped.
// Glyph ids are untouched, so text encoded against the full font still shows the same.
// (pdf-lib's own subsetting drops glyphs of Noto Sans JP.)
// cmap lets a viewer that redraws form fields find the glyph of a character; it is
// rebuilt with the characters in use only, and the widths of unused glyphs are zeroed:
// the bundled font has over 50,000 glyphs, so those tables alone would add ~350 KB.
const KEPT_TABLES = ['OS/2', 'cmap', 'cvt ', 'fpgm', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post', 'prep'];

// Records the glyph ids pdf-lib writes with this font, from now on.
export function trackGlyphs(font) {
  const used = new Set();
  used.codes = new Map(); // character code -> glyph id, for the rebuilt cmap
  const encode = font.encodeText.bind(font);
  font.encodeText = (text) => {
    const hex = encode(text);
    // Four hex digits per glyph.
    for (const [id] of hex.toString().matchAll(/[0-9a-f]{4}/gi)) used.add(parseInt(id, 16));
    // Text shaping swaps in alternate glyphs (digits between Latin letters, for one).
    // A viewer that redraws a form field itself uses the plain glyph of each character.
    for (const ch of text) {
      const code = ch.codePointAt(0),
        id = font.embedder.font.glyphForCodePoint(code).id;
      used.add(id);
      if (id) used.codes.set(code, id);
    }
    return hex;
  };
  return used;
}

// Replaces the embedded file of this font. Call after doc.flush(), which writes the font.
// pdf-lib also lists the width and the text of every glyph in the font (/W and /ToUnicode):
// with the bundled font that is ~450 KB per PDF, so both are rewritten for the glyphs in use.
export function pruneEmbeddedFont(doc, font, fontBytes, glyphIds) {
  const { PDFName, PDFDict, PDFArray } = globalThis.PDFLib;
  const type0 = doc.context.lookup(font.ref, PDFDict);
  const cidFont = type0.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
  const descriptor = cidFont.lookup(PDFName.of('FontDescriptor'), PDFDict);
  const file = descriptor.get(PDFName.of('FontFile2'));
  if (file) doc.context.assign(file, doc.context.flateStream(pruneFont(fontBytes, glyphIds, glyphIds.codes)));

  const source = font.embedder.font,
    scale = 1000 / source.unitsPerEm;
  const ids = [...glyphIds].filter((id) => id > 0).sort((a, b) => a - b);
  // Same widths and texts as pdf-lib writes, for these glyphs only.
  const widths = [];
  for (const id of ids) {
    const width = source.getGlyph(id).advanceWidth * scale;
    const last = widths.at(-1);
    if (last && last.next === id) {
      last.list.push(width);
      last.next++;
    } else widths.push({ first: id, next: id + 1, list: [width] });
  }
  cidFont.set(PDFName.of('W'), doc.context.obj(widths.flatMap((run) => [run.first, run.list])));
  const toUnicode = type0.get(PDFName.of('ToUnicode'));
  if (toUnicode)
    doc.context.assign(toUnicode, doc.context.flateStream(toUnicodeCmap(ids.map((id) => [id, source.getGlyph(id).codePoints]))));
}

function toUnicodeCmap(entries) {
  const hex = (value, digits) => value.toString(16).padStart(digits, '0');
  const utf16 = (codes) =>
    codes
      .map((code) =>
        code > 0xffff ? hex(0xd800 + ((code - 0x10000) >> 10), 4) + hex(0xdc00 + ((code - 0x10000) & 0x3ff), 4) : hex(code, 4),
      )
      .join('');
  const mapped = entries.filter(([, codes]) => codes.length);
  const blocks = [];
  for (let i = 0; i < mapped.length; i += 100) {
    const block = mapped.slice(i, i + 100);
    blocks.push(`${block.length} beginbfchar`, ...block.map(([id, codes]) => `<${hex(id, 4)}> <${utf16(codes)}>`), 'endbfchar');
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000><ffff>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

// cmap with only the given characters: format 4 (BMP) and format 12 (all), both for Windows Unicode.
function buildCmap(codes) {
  const entries = [...codes].sort((a, b) => a[0] - b[0]);
  const bmp = entries.filter(([code]) => code < 0xffff);
  const subtables = [];
  const segCount = bmp.length + 1;
  if (16 + segCount * 8 < 0x10000) {
    const f4 = new DataView(new ArrayBuffer(16 + segCount * 8));
    const power = 2 ** Math.floor(Math.log2(segCount));
    f4.setUint16(0, 4);
    f4.setUint16(2, f4.byteLength);
    f4.setUint16(6, segCount * 2);
    f4.setUint16(8, power * 2);
    f4.setUint16(10, Math.log2(power));
    f4.setUint16(12, segCount * 2 - power * 2);
    const end = 14,
      start = end + segCount * 2 + 2,
      delta = start + segCount * 2,
      range = delta + segCount * 2;
    [...bmp, [0xffff, 0]].forEach(([code, id], i) => {
      f4.setUint16(end + i * 2, code);
      f4.setUint16(start + i * 2, code);
      f4.setUint16(delta + i * 2, code === 0xffff ? 1 : (id - code) & 0xffff);
      f4.setUint16(range + i * 2, 0);
    });
    subtables.push([1, new Uint8Array(f4.buffer)]);
  }
  const f12 = new DataView(new ArrayBuffer(16 + entries.length * 12));
  f12.setUint16(0, 12);
  f12.setUint32(4, f12.byteLength);
  f12.setUint32(12, entries.length);
  entries.forEach(([code, id], i) => {
    f12.setUint32(16 + i * 12, code);
    f12.setUint32(20 + i * 12, code);
    f12.setUint32(24 + i * 12, id);
  });
  subtables.push([10, new Uint8Array(f12.buffer)]);
  const headerSize = 4 + subtables.length * 8;
  const result = new Uint8Array(headerSize + subtables.reduce((sum, [, data]) => sum + data.length, 0)),
    view = new DataView(result.buffer);
  view.setUint16(2, subtables.length);
  let offset = headerSize;
  subtables.forEach(([encoding, data], i) => {
    view.setUint16(4 + i * 8, 3);
    view.setUint16(6 + i * 8, encoding);
    view.setUint32(8 + i * 8, offset);
    result.set(data, offset);
    offset += data.length;
  });
  return result;
}

export function pruneFont(source, glyphIds, codes = null) {
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
  // Widths of unused glyphs are never read: zeros compress to almost nothing.
  const hmtx = tables.get('hmtx'),
    hhea = tables.get('hhea');
  let newHmtx = null;
  if (hmtx && hhea) {
    newHmtx = bytes.slice(hmtx.offset, hmtx.offset + hmtx.length);
    const metrics = new DataView(newHmtx.buffer),
      longCount = view.getUint16(hhea.offset + 34);
    for (let id = 0; id < glyphCount; id++) {
      if (keep.has(id)) continue;
      if (id < longCount) metrics.setUint32(id * 4, 0);
      else if (longCount * 4 + (id - longCount) * 2 + 2 <= newHmtx.length) metrics.setUint16(longCount * 4 + (id - longCount) * 2, 0);
    }
  }
  const newCmap = codes ? buildCmap(codes) : null;
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
            : tag === 'hmtx' && newHmtx
              ? newHmtx
              : tag === 'cmap' && newCmap
                ? newCmap
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
