// Helpers shared by the editor, the thumbnail sidebar and the PDF exporter.

// Copy annotation lists without duplicating large image data URLs: strings are
// immutable, so sharing them keeps undo history small.
export const cloneNotes = (list) => list.map((o) => (o.points ? { ...o, points: o.points.map((p) => ({ ...p })) } : { ...o }));

// Two-point shapes (rect, ellipse) are stored as their drag corners.
export function rectOf(o) {
  const [a, b] = o.points;
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// The two tips of the arrow head, drawn back from the end point.
export function arrowTips(o) {
  const [a, b] = o.points;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const head = Math.min(length / 2, Math.max(8, o.width * 4));
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const spread = Math.PI / 7;
  return [angle - spread, angle + spread].map((t) => ({ x: b.x - head * Math.cos(t), y: b.y - head * Math.sin(t) }));
}

// Ramer-Douglas-Peucker without recursion: hand-drawn strokes can have 100k points.
export function simplify(points, epsilon) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    const a = points[start];
    const b = points[end];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    let max = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      const d = length ? Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / length : Math.hypot(p.x - a.x, p.y - a.y);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (max > epsilon) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// The editor stores what pdf.js reports (a radio's on-state name, a dropdown's export value),
// while pdf-lib selects by option name (Opt entry, dropdown display text). These convert between them.
export function radioStateOf(field) {
  const selected = field.getSelected();
  const index = selected === undefined ? -1 : field.getOptions().indexOf(selected);
  return index < 0 ? '' : (field.acroField.getOnValues()[index]?.decodeText() ?? '');
}
export function radioOptionOf(field, state) {
  const index = field.acroField.getOnValues().findIndex((name) => name.decodeText() === state);
  return index < 0 ? undefined : field.getOptions()[index];
}
export function dropdownValueOf(field) {
  const selected = field.getSelected()[0];
  if (selected === undefined) return '';
  const raw = field.acroField.getOptions().find((o) => (o.display ?? o.value).decodeText() === selected);
  return raw ? raw.value.decodeText() : selected;
}
export function dropdownOptionOf(field, value) {
  const raw = field.acroField.getOptions().find((o) => o.value.decodeText() === value);
  return raw ? (raw.display ?? raw.value).decodeText() : undefined;
}

// Which editable form widgets the editor supports, from a pdf.js annotation.
export function fieldKind(f) {
  if (f.subtype !== 'Widget' || f.readOnly || f.hidden || f.noView) return null;
  if (f.fieldType === 'Tx') return 'text';
  if (f.fieldType === 'Btn' && f.checkBox) return 'check';
  if (f.fieldType === 'Btn' && f.radioButton && f.buttonValue) return 'radio';
  if (f.fieldType === 'Ch' && f.combo && !f.multiSelect) return 'select';
  return null;
}
