import * as pdfjs from './vendor/pdf.min.mjs';
import { buildPdf } from './export.js';
import { consumePdf } from './transfer.js';
import { PageSidebar } from './sidebar.js';
import { pickPhoto, pickPdf } from './pickers.js';
import { cloneNotes, rectOf, arrowTips, simplify, fieldKind, radioStateOf, dropdownValueOf } from './helpers.js';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
const $ = (id) => document.getElementById(id);
// The version comes from the manifest, so it never goes stale.
fetch(new URL('./manifest.json', import.meta.url))
  .then((r) => r.json())
  .then((m) => ($('version').textContent = 'v' + m.version))
  .catch(() => {});
const NS = 'http://www.w3.org/2000/svg';
let overlay = $('overlay');
let formLayer = $('formLayer');
let viewMode = 'single',
  viewSignature = '',
  viewGeneration = 0,
  pageObserver = null,
  scrollFrame = null;
let navigationScrollTop = null;
const views = new Map();
let documentRevision = 0;
const toolColors = {
  text: '#000000',
  line: '#e15244',
  pen: '#e15244',
  highlight: '#e15244',
  rect: '#e15244',
  ellipse: '#e15244',
  arrow: '#e15244',
};
const shareLineColor = ['line', 'pen', 'rect', 'ellipse', 'arrow'];
const twoPointShapes = ['line', 'highlight', 'rect', 'ellipse', 'arrow'];
const noteLabels = {
  text: '文字',
  image: '写真',
  line: '直線',
  pen: '手書き',
  highlight: 'マーカー',
  rect: '四角',
  ellipse: '楕円',
  arrow: '矢印',
};
let clipboardNotes = [],
  group = [],
  nudge = { id: null, time: 0 };
// `selected` is the primary note; `group` holds a multi-selection made by dragging a range.
const selection = () => (selected && group.length > 1 && group.includes(selected) ? group : selected ? [selected] : []);
const selectedNotes = () => {
  const ids = selection();
  return objects().filter((o) => ids.includes(o.id));
};
function setSelection(ids) {
  selected = ids[0] ?? null;
  group = ids.slice();
}
function unionBounds(list) {
  const boxes = list.map(bounds);
  return {
    minX: Math.min(...boxes.map((b) => b.x)),
    minY: Math.min(...boxes.map((b) => b.y)),
    maxX: Math.max(...boxes.map((b) => b.x + b.w)),
    maxY: Math.max(...boxes.map((b) => b.y + b.h)),
  };
}
// Move notes together without letting the group leave the page.
function clampedShift(list, dx, dy) {
  const u = unionBounds(list),
    d = dimensions[pageIndex];
  return [Math.max(-u.minX, Math.min(d.width - u.maxX, dx)), Math.max(-u.minY, Math.min(d.height - u.maxY, dy))];
}
const measureContext = document.createElement('canvas').getContext('2d');
const viewportOf = (page, index, s) => page.getViewport({ scale: s, rotation: (page.rotate + (pageOrder[index]?.rotate || 0)) % 360 });
const cloneState = (s) => ({
  annotations: s.annotations.map(cloneNotes),
  formValues: { ...s.formValues },
  pageOrder: s.pageOrder.map((p) => ({ ...p })),
  pageIndex: s.pageIndex,
});
let formValues = {},
  initialFormValues = {},
  sources = [],
  pageOrder = [];
const fieldKey = (name, index = pageIndex) => `${pageOrder[index].source}:${name}`;
const getPageAt = (index) => sources[pageOrder[index].source].preview.getPage(pageOrder[index].page + 1);
const snapshot = () => cloneState({ annotations, formValues, pageOrder, pageIndex });
const changedForms = () => Object.fromEntries(Object.entries(formValues).filter(([name, value]) => value !== initialFormValues[name]));
let pdf = null,
  filename = 'document.pdf',
  pageIndex = 0,
  scale = 1;
let annotations = [],
  dimensions = [],
  selected = null,
  tool = 'select';
let history = [],
  historyIndex = -1,
  dirty = false,
  busy = false,
  gesture = null;
let textTarget = null,
  fontPromise = null;
const clone = (value) => structuredClone(value);
const num = (id, min, max) => Math.min(max, Math.max(min, Number($(id).value) || min));
const objects = () => annotations[pageIndex] || [];
function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function setBusy(value, message) {
  busy = value;
  for (const id of ['save', 'compress', 'projectSave', 'photo', 'railAppend', 'railRotate', 'railBlank']) $(id).disabled = value || !pdf;
  for (const id of ['open', 'start']) $(id).disabled = value;
  for (const view of views.values()) {
    view.overlay.style.pointerEvents = value ? 'none' : 'auto';
    view.forms.inert = value;
  }
  $('viewMode').disabled = value || !pdf;
  if (message) status(message);
  updateHistoryButtons();
  updatePaging();
  syncSelection();
}
function updatePaging() {
  $('pageNumber').textContent = pdf ? `${pageIndex + 1} / ${pageOrder.length}` : '0 / 0';
  $('zoomLabel').textContent = `${Math.round(scale * 100)}%`;
  $('prev').disabled = busy || !pdf || pageIndex === 0;
  $('next').disabled = busy || !pdf || pageIndex === pageOrder.length - 1;
  for (const id of ['zoomIn', 'zoomOut', 'fit']) $(id).disabled = busy || !pdf;
  pageSidebar.sync();
}
function updateHistoryButtons() {
  $('undo').disabled = busy || historyIndex <= 0;
  $('redo').disabled = busy || historyIndex >= history.length - 1;
}
function record() {
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot());
  if (history.length > 41) history.shift();
  historyIndex = history.length - 1;
  dirty = true;
  updateHistoryButtons();
  pageSidebar.invalidate();
}
async function restore(delta) {
  if (busy || !pdf || gesture) return;
  const index = historyIndex + delta;
  if (index < 0 || index >= history.length) return;
  const layout = () => pageOrder.map((p) => `${p.id}:${p.rotate || 0}`).join(',');
  const active = pageOrder[pageIndex].id,
    oldOrder = layout();
  historyIndex = index;
  const state = cloneState(history[index]);
  ({ annotations, formValues, pageOrder } = state);
  const current = pageOrder.findIndex((p) => p.id === active);
  pageIndex = current < 0 ? Math.min(state.pageIndex, pageOrder.length - 1) : current;
  selected = null;
  dirty = true;
  if (oldOrder !== layout()) {
    dimensions = [];
    await render();
  } else {
    draw();
    syncFormValues();
  }
  updateHistoryButtons();
  updatePaging();
  status(delta < 0 ? '編集を戻しました。' : '編集をやり直しました。');
  pageSidebar.invalidate();
}
function setTool(value) {
  tool = value;
  selected = null;
  document.querySelectorAll('button[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === value));
  for (const view of views.values()) view.overlay.dataset.tool = value;
  if (toolColors[value]) $('color').value = toolColors[value];
  $('fillRow').hidden = value !== 'rect' && value !== 'ellipse';
  $('toolHint').textContent = {
    select: 'ドラッグで範囲選択。Shift+クリックで追加選択',
    text: 'クリックで文字を配置',
    line: 'ドラッグ中にShiftキーで水平・垂直。Shift+ドラッグで書き込みを範囲選択',
    pen: 'ドラッグで手書き。クリックで点。Shift+ドラッグで書き込みを範囲選択',
    highlight: 'ドラッグ中にShiftキーで水平・垂直。Shift+ドラッグで書き込みを範囲選択',
    rect: 'ドラッグ中にShiftキーで正方形。Shift+ドラッグで書き込みを範囲選択',
    ellipse: 'ドラッグ中にShiftキーで正円。Shift+ドラッグで書き込みを範囲選択',
    arrow: 'ドラッグ中にShiftキーで水平・垂直。Shift+ドラッグで書き込みを範囲選択',
  }[value];
  draw();
  $('sidebar').classList.toggle('select-mode', value === 'select');
  $('pageSidebar').hidden = value !== 'select';
  pageSidebar.sync();
}
function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  if (text !== undefined) el.textContent = text;
  return el;
}
function bounds(o) {
  if (o.type === 'text') {
    const ctx = measureContext;
    ctx.font = `${o.size}px NoteJP`;
    return {
      x: o.x,
      y: o.y,
      w: Math.max(10, ...o.text.split('\n').map((l) => ctx.measureText(l).width)),
      h: o.size * (1.35 * (o.text.split('\n').length - 1) + 1.3),
    };
  }
  if (o.type === 'image') return { x: o.x, y: o.y, w: o.w, h: o.h };
  const xs = o.points.map((p) => p.x),
    ys = o.points.map((p) => p.y);
  return {
    x: Math.min(...xs) - o.width / 2,
    y: Math.min(...ys) - o.width / 2,
    w: Math.max(...xs) - Math.min(...xs) + o.width,
    h: Math.max(...ys) - Math.min(...ys) + o.width,
  };
}
function drawPage(view) {
  const overlay = view.overlay,
    index = view.index;
  overlay.replaceChildren();
  if (!pdf || !view.ready) return;
  for (const o of annotations[index] || []) {
    const g = svg('g', { 'data-id': o.id });
    if (o.type === 'text') {
      const b = bounds(o);
      g.append(svg('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent' }));
      const txt = svg('text', {
        x: o.x,
        y: o.y + o.size,
        fill: o.color,
        'font-family': 'NoteJP, sans-serif',
        'font-size': o.size,
        'xml:space': 'preserve',
      });
      o.text.split('\n').forEach((line, i) => txt.append(svg('tspan', { x: o.x, y: o.y + o.size + i * o.size * 1.35 }, line)));
      g.append(txt);
    } else if (o.type === 'image') g.append(svg('image', { x: o.x, y: o.y, width: o.w, height: o.h, href: o.data }));
    else if (o.type === 'rect' || o.type === 'ellipse') {
      const r = rectOf(o);
      const shape = (attrs) =>
        o.type === 'ellipse'
          ? svg('ellipse', { cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2, ...attrs })
          : svg('rect', { x: r.x, y: r.y, width: r.w, height: r.h, ...attrs });
      g.append(shape({ fill: o.fill ? o.color : 'none', stroke: o.color, 'stroke-width': o.width, 'stroke-linejoin': 'round' }));
      g.append(
        shape({
          fill: 'transparent',
          stroke: 'transparent',
          'stroke-width': Math.max(o.width, 12 / scale),
          'pointer-events': o.fill ? 'all' : 'stroke',
        }),
      );
    } else {
      const points = o.points.map((p) => `${p.x},${p.y}`).join(' ');
      g.append(
        svg('polyline', {
          points,
          fill: 'none',
          stroke: o.color,
          'stroke-width': o.width,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          opacity: o.type === 'highlight' ? 0.3 : 1,
        }),
      );
      if (o.type === 'arrow') {
        const tips = arrowTips(o),
          end = o.points[1];
        g.append(
          svg('polyline', {
            points: `${tips[0].x},${tips[0].y} ${end.x},${end.y} ${tips[1].x},${tips[1].y}`,
            fill: 'none',
            stroke: o.color,
            'stroke-width': o.width,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          }),
        );
      }
      g.append(
        svg('polyline', {
          points,
          fill: 'none',
          stroke: 'transparent',
          'stroke-width': Math.max(o.width, 12 / scale),
          'pointer-events': 'stroke',
        }),
      );
    }
    overlay.append(g);
  }
  const ids = index === pageIndex ? selection() : [];
  const chosen = (annotations[index] || []).filter((o) => ids.includes(o.id));
  if (gesture?.kind === 'marquee' && index === pageIndex) {
    const r = marqueeRect(gesture);
    overlay.append(
      svg('rect', {
        x: r.x,
        y: r.y,
        width: r.w,
        height: r.h,
        fill: '#245de914',
        stroke: '#245de9',
        'stroke-width': 1 / scale,
        'pointer-events': 'none',
      }),
    );
  }
  for (const obj of chosen) {
    const b = bounds(obj),
      pad = 4 / scale;
    overlay.append(
      svg('rect', {
        x: b.x - pad,
        y: b.y - pad,
        width: b.w + pad * 2,
        height: b.h + pad * 2,
        fill: 'none',
        stroke: '#245de9',
        'stroke-width': 1 / scale,
        'stroke-dasharray': `${4 / scale} ${3 / scale}`,
        'pointer-events': 'none',
      }),
    );
    if (obj.type === 'image' && chosen.length === 1)
      overlay.append(
        svg('rect', {
          x: b.x + b.w - 5 / scale,
          y: b.y + b.h - 5 / scale,
          width: 10 / scale,
          height: 10 / scale,
          fill: '#245de9',
          'data-resize': obj.id,
          style: 'cursor:nwse-resize',
        }),
      );
  }
}
function draw() {
  for (const view of views.values()) drawPage(view);
  syncSelection();
}
// While dragging only the active page changes, so skip the others.
function drawActive() {
  const view = views.get(pageIndex);
  if (view) drawPage(view);
}
function syncSelection() {
  const chosen = selectedNotes(),
    o = chosen.length === 1 ? chosen[0] : null;
  $('settingsPanel').hidden = tool === 'select';
  $('fillRow').hidden = tool !== 'rect' && tool !== 'ellipse';
  $('delete').disabled = !chosen.length || busy;
  $('editText').disabled = !o || o.type !== 'text' || busy;
  const info = $('selectionInfo');
  info.hidden = !chosen.length;
  info.textContent = chosen.length > 1 ? `${chosen.length}個選択中` : o ? noteLabels[o.type] : '';
  $('sizeControls').hidden = !o || o.type !== 'image';
  if (o?.type === 'image') {
    $('objectWidth').value = Math.round(o.w);
    $('objectHeight').value = Math.round(o.h);
  }
  if (o?.color) $('color').value = o.color;
  if (o?.type === 'text') $('fontSize').value = o.size;
  if (o?.width) $('lineWidth').value = o.width;
  if (o?.type === 'rect' || o?.type === 'ellipse') $('fill').checked = !!o.fill;
}
function point(event) {
  const r = overlay.getBoundingClientRect(),
    d = dimensions[pageIndex];
  return {
    x: Math.max(0, Math.min(d.width, ((event.clientX - r.left) / r.width) * d.width)),
    y: Math.max(0, Math.min(d.height, ((event.clientY - r.top) / r.height) * d.height)),
  };
}
function translate(o, dx, dy) {
  if (o.points)
    o.points.forEach((p) => {
      p.x += dx;
      p.y += dy;
    });
  else {
    o.x += dx;
    o.y += dy;
  }
}
function marqueeRect(g) {
  return {
    x: Math.min(g.start.x, g.current.x),
    y: Math.min(g.start.y, g.current.y),
    w: Math.abs(g.start.x - g.current.x),
    h: Math.abs(g.start.y - g.current.y),
  };
}
// Notes touched by the dragged rectangle are selected; Shift adds to the current selection.
function finishMarquee(g, cancel) {
  if (cancel) {
    draw();
    return;
  }
  let ids = g.base;
  if (g.moved) {
    const r = marqueeRect(g);
    const hits = objects()
      .filter((o) => {
        const b = bounds(o);
        return b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y;
      })
      .map((o) => o.id);
    ids = [...new Set([...g.base, ...hits])];
  } else if (g.toggleId) ids = g.base.includes(g.toggleId) ? g.base.filter((id) => id !== g.toggleId) : [...g.base, g.toggleId];
  // The current tool is kept, so a selection made with Shift+drag does not leave the drawing tool.
  setSelection(ids);
  draw();
  if (ids.length > 1)
    status(
      tool === 'select'
        ? `${ids.length}個の書き込みを選択しました。ドラッグで移動、Deleteで削除できます。`
        : `${ids.length}個の書き込みを選択しました。矢印キーで移動、Deleteで削除、Ctrl+Cでコピーできます。`,
    );
}
function bindOverlay(surface, index) {
  surface.addEventListener('focus', () => activatePage(index));
  surface.addEventListener('pointerdown', (event) => {
    if (busy || !pdf || gesture || event.button !== 0) return;
    activatePage(index);
    overlay.focus();
    const p = point(event);
    if (tool === 'text') {
      showText(p);
      return;
    }
    // Shift+drag selects a range from any tool (text excepted, handled above).
    if (tool === 'select' || event.shiftKey) {
      const id = event.target.closest('[data-id]')?.getAttribute('data-id');
      const resize = event.target.getAttribute('data-resize');
      const current = selection();
      if (resize) {
        setSelection([resize]);
        const o = objects().find((item) => item.id === resize);
        if (o) gesture = { kind: 'resize', start: p, original: cloneNotes([o])[0], id: o.id, moved: false, pointer: event.pointerId };
      } else if (event.shiftKey) {
        gesture = { kind: 'marquee', start: p, current: p, base: current, toggleId: id, moved: false, pointer: event.pointerId };
      } else if (id) {
        const ids = current.includes(id) ? current : [id];
        setSelection(ids);
        const items = selectedNotes().map((o) => ({ id: o.id, original: cloneNotes([o])[0] }));
        gesture = { kind: 'move', start: p, items, moved: false, pointer: event.pointerId };
      } else {
        setSelection([]);
        gesture = { kind: 'marquee', start: p, current: p, base: [], toggleId: null, moved: false, pointer: event.pointerId };
      }
      draw();
    } else {
      const o = {
        id: crypto.randomUUID(),
        type: tool,
        color: $('color').value,
        width: tool === 'highlight' ? Math.max(12, num('lineWidth', 0.5, 50)) : num('lineWidth', 0.5, 50),
        points: [p, { ...p }],
      };
      if (tool === 'rect' || tool === 'ellipse') o.fill = $('fill').checked;
      objects().push(o);
      gesture = { kind: 'draw', id: o.id, start: p, moved: false, pointer: event.pointerId };
      draw();
    }
    if (gesture) overlay.setPointerCapture(event.pointerId);
  });
  surface.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    const p = point(event);
    const dx = p.x - gesture.start.x,
      dy = p.y - gesture.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.3) gesture.moved = true;
    if (gesture.kind === 'marquee') {
      gesture.current = p;
      drawActive();
      return;
    }
    if (gesture.kind === 'move') {
      const [mx, my] = clampedShift(
        gesture.items.map((item) => item.original),
        dx,
        dy,
      );
      for (const item of gesture.items) {
        const o = objects().find((x) => x.id === item.id);
        if (!o) continue;
        Object.assign(o, cloneNotes([item.original])[0]);
        translate(o, mx, my);
      }
      drawActive();
      return;
    }
    const o = objects().find((x) => x.id === gesture.id);
    if (!o) return;
    if (gesture.kind === 'resize') {
      const base = gesture.original,
        d = dimensions[pageIndex];
      const ratio = base.w / base.h;
      let width = Math.max(10, base.w + dx),
        height = width / ratio;
      if (event.shiftKey) height = Math.max(10, base.h + dy);
      const fit = Math.min(1, (d.width - base.x) / width, (d.height - base.y) / height);
      o.w = width * fit;
      o.h = height * fit;
    } else if (o.type === 'pen') {
      const last = o.points.at(-1);
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.4) o.points.push(p);
    } else {
      if (event.shiftKey && (o.type === 'line' || o.type === 'arrow' || o.type === 'highlight')) {
        if (Math.abs(dx) > Math.abs(dy)) p.y = gesture.start.y;
        else p.x = gesture.start.x;
      }
      if (event.shiftKey && (o.type === 'rect' || o.type === 'ellipse')) {
        // Square / true circle, kept inside the page.
        const d = dimensions[pageIndex],
          sx = dx < 0 ? -1 : 1,
          sy = dy < 0 ? -1 : 1;
        const size = Math.min(
          Math.max(Math.abs(dx), Math.abs(dy)),
          sx < 0 ? gesture.start.x : d.width - gesture.start.x,
          sy < 0 ? gesture.start.y : d.height - gesture.start.y,
        );
        p.x = gesture.start.x + sx * size;
        p.y = gesture.start.y + sy * size;
      }
      o.points[1] = p;
    }
    drawActive();
  });
  function finishGesture(event, cancel = false) {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    const g = gesture;
    gesture = null;
    if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
    if (g.kind === 'marquee') {
      finishMarquee(g, cancel);
      return;
    }
    if (cancel) {
      if (g.kind === 'draw') annotations[pageIndex] = objects().filter((o) => o.id !== g.id);
      else if (g.kind === 'move')
        for (const item of g.items)
          Object.assign(
            objects().find((o) => o.id === item.id),
            item.original,
          );
      else
        Object.assign(
          objects().find((o) => o.id === g.id),
          g.original,
        );
    } else if (g.moved) {
      const o = objects().find((o) => o.id === g.id);
      if (g.kind === 'draw' && o?.type === 'pen') o.points = simplify(o.points, 0.15);
      record();
    } else if (g.kind === 'draw') {
      // A plain click with the pen leaves a dot as wide as the pen; other tools discard it.
      if (objects().find((o) => o.id === g.id)?.type === 'pen') record();
      else annotations[pageIndex] = objects().filter((o) => o.id !== g.id);
    }
    draw();
  }
  surface.addEventListener('pointerup', (e) => finishGesture(e));
  surface.addEventListener('pointercancel', (e) => finishGesture(e, true));
  surface.addEventListener('dblclick', (e) => {
    if (tool !== 'select' || busy) return;
    const id = e.target.closest('[data-id]')?.getAttribute('data-id'),
      o = objects().find((o) => o.id === id);
    if (o?.type === 'text') {
      selected = id;
      showText(null, o);
    }
  });
}
function showText(p, o = null) {
  textTarget = { point: p, id: o?.id };
  $('textValue').value = o?.text || '';
  $('textDialog').returnValue = 'cancel';
  $('textConfirm').textContent = o ? '変更する' : '配置する';
  $('textDialog').showModal();
  $('textValue').focus();
}
// The editor's own shortcuts and paste stay inactive while a window (text input, help) is open.
const dialogOpen = () => $('textDialog').open || $('helpDialog').open;
$('help').onclick = () => $('helpDialog').showModal();
$('helpDialog').addEventListener('click', (e) => {
  if (e.target === $('helpDialog')) $('helpDialog').close(); // click outside the window
});
$('textDialog').addEventListener('close', () => {
  if ($('textDialog').returnValue !== 'ok' || !textTarget) {
    textTarget = null;
    return;
  }
  const text = $('textValue').value.replace(/\r/g, '').replace(/\t/g, '    ');
  if (!text.trim()) {
    textTarget = null;
    return;
  }
  if (text.length > 10000) {
    status('文字は1回につき10,000文字以内で入力してください。', true);
    textTarget = null;
    return;
  }
  let o = objects().find((o) => o.id === textTarget.id);
  if (o) o.text = text;
  else {
    const size = num('fontSize', 6, 180),
      d = dimensions[pageIndex];
    o = {
      id: crypto.randomUUID(),
      type: 'text',
      x: textTarget.point.x,
      y: Math.min(textTarget.point.y, Math.max(0, d.height - size * 1.3)),
      text,
      size,
      color: $('color').value,
    };
    objects().push(o);
  }
  record();
  setTool('select');
  selected = o.id;
  draw();
  textTarget = null;
  status('文字を追加しました。ドラッグで位置を調整できます。');
});
function setInputValue(input, value) {
  if (input.type === 'checkbox') input.checked = value === 'true';
  else if (input.type === 'radio') input.checked = value === input.dataset.buttonValue;
  else input.value = value;
}
function syncFormValues() {
  for (const input of $('workspace').querySelectorAll('[data-field-key]')) setInputValue(input, formValues[input.dataset.fieldKey] ?? '');
}
function drawFormFields(viewport, view) {
  const formLayer = view.forms;
  formLayer.replaceChildren();
  for (const field of view.fields) {
    const key = fieldKey(field.fieldName, view.index);
    const kind = fieldKind(field);
    if (!kind || !Object.hasOwn(formValues, key)) continue;
    const rect = viewport.convertToViewportRectangle(field.rect);
    const left = Math.min(rect[0], rect[2]),
      top = Math.min(rect[1], rect[3]);
    const width = Math.abs(rect[2] - rect[0]),
      height = Math.abs(rect[3] - rect[1]);
    if (!width || !height) continue;
    const rotation = (((viewport.rotation - (field.rotation || 0)) % 360) + 360) % 360,
      swap = rotation % 180 !== 0;
    const w = swap ? height : width,
      h = swap ? width : height;
    const input = document.createElement(kind === 'select' ? 'select' : kind === 'text' && field.multiLine ? 'textarea' : 'input');
    if (kind === 'text' && !field.multiLine) input.type = field.password ? 'password' : 'text';
    if (kind === 'check') input.type = 'checkbox';
    if (kind === 'radio') {
      input.type = 'radio';
      input.name = key;
      input.dataset.buttonValue = field.buttonValue;
    }
    if (kind === 'select') {
      input.append(new Option('', ''));
      for (const option of field.options || []) input.append(new Option(option.displayValue || option.exportValue, option.exportValue));
    }
    input.className =
      kind === 'text' ? 'pdf-text-field' : kind === 'select' ? 'pdf-text-field pdf-select-field' : 'pdf-text-field pdf-check-field';
    input.dataset.fieldName = field.fieldName;
    input.dataset.fieldKey = key;
    input.setAttribute('aria-label', field.alternativeText || field.fieldName || 'PDFの入力欄');
    input.title = field.alternativeText || field.fieldName;
    setInputValue(input, formValues[key]);
    if (kind === 'text') {
      input.spellcheck = false;
      input.autocomplete = 'off';
    }
    if (kind === 'text' && field.maxLen > 0) input.maxLength = field.maxLen;
    if (field.required && kind === 'text') input.required = true;
    const fontSize = field.defaultAppearanceData?.fontSize || Math.min(18, (h / scale) * 0.65);
    const fontColor = field.defaultAppearanceData?.fontColor || [0, 0, 0];
    Object.assign(input.style, {
      left: `${left + (width - w) / 2}px`,
      top: `${top + (height - h) / 2}px`,
      width: `${w}px`,
      height: `${h}px`,
      transform: `rotate(${rotation}deg)`,
      fontSize: `${Math.max(1, fontSize * scale)}px`,
      textAlign: ['left', 'center', 'right'][field.textAlignment] || 'left',
      color: `rgb(${Array.from(fontColor).join(',')})`,
      padding: `${scale}px ${2 * scale}px`,
    });
    // Form widgets are above page content in saved PDFs. Mirror their fill and
    // border here so a pasted image behind an editable field previews correctly.
    input.style.backgroundColor = field.backgroundColor ? `rgb(${Array.from(field.backgroundColor).join(',')})` : 'transparent';
    input.style.borderColor = field.borderColor ? `rgb(${Array.from(field.borderColor).join(',')})` : 'transparent';
    input.style.borderWidth = `${field.borderColor ? (field.borderStyle?.width || 0) * scale : 0}px`;
    input.style.borderStyle = field.borderStyle?.style === 2 ? 'dashed' : 'solid';
    if (field.borderStyle?.style === 5) {
      input.style.borderTopWidth = '0';
      input.style.borderRightWidth = '0';
      input.style.borderLeftWidth = '0';
    }
    if (kind === 'text' && field.comb && field.maxLen)
      input.style.letterSpacing = `${Math.max(0, w / field.maxLen - fontSize * scale * 0.6)}px`;
    // Non-text widgets are opaque so the original appearance underneath is hidden.
    if (kind !== 'text' && !field.backgroundColor) input.style.backgroundColor = '#ffffff';
    if (kind === 'check' || kind === 'radio') {
      input.style.padding = '0';
      if (!field.borderColor) Object.assign(input.style, { borderColor: '#777777', borderWidth: '1px', borderStyle: 'solid' });
    }
    const read = () =>
      kind === 'check'
        ? String(input.checked)
        : kind === 'radio'
          ? input.checked
            ? input.dataset.buttonValue
            : formValues[key]
          : input.value;
    let before = input.value;
    input.addEventListener('focus', () => {
      activatePage(view.index);
      before = input.value;
    });
    input.addEventListener('input', () => {
      formValues[key] = read();
      dirty = true;
      for (const peer of $('workspace').querySelectorAll('[data-field-key]'))
        if (peer !== input && peer.dataset.fieldKey === key) setInputValue(peer, formValues[key]);
    });
    input.addEventListener('change', () => {
      if (kind === 'text') {
        if (input.value !== before) {
          record();
          before = input.value;
        }
      } else {
        formValues[key] = read();
        record();
      }
    });
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        input.blur();
        $('save').click();
      }
    });
    formLayer.append(input);
  }
}
function activatePage(index) {
  const view = views.get(index);
  if (!view) return;
  const changed = index !== pageIndex;
  pageIndex = index;
  if (changed) selected = null;
  for (const id of ['pageWrap', 'pdfCanvas', 'overlay', 'formLayer']) $(id)?.removeAttribute('id');
  view.root.id = 'pageWrap';
  view.canvas.id = 'pdfCanvas';
  view.overlay.id = 'overlay';
  view.forms.id = 'formLayer';
  overlay = view.overlay;
  formLayer = view.forms;
  for (const item of views.values()) item.root.classList.toggle('current-page', item === view);
  if (changed) {
    draw();
    updatePaging();
  }
}
function scrollToPage(index) {
  const view = views.get(index);
  if (!view) return;
  const workspace = $('workspace'),
    top = view.root.getBoundingClientRect().top - workspace.getBoundingClientRect().top + workspace.scrollTop - 26;
  workspace.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  navigationScrollTop = workspace.scrollTop;
}
function evictDistantViews() {
  if (viewMode !== 'continuous') return;
  const area = $('workspace').getBoundingClientRect();
  let pixels = [...views.values()].reduce((sum, v) => sum + v.canvas.width * v.canvas.height, 0);
  const distant = [...views.values()]
    .filter((v) => v.ready && v.index !== pageIndex && !v.root.contains(document.activeElement))
    .sort((a, b) => Math.abs(b.root.getBoundingClientRect().top - area.top) - Math.abs(a.root.getBoundingClientRect().top - area.top));
  for (const view of distant) {
    const rect = view.root.getBoundingClientRect(),
      offscreen = rect.bottom < area.top || rect.top > area.bottom;
    if (!offscreen || (pixels <= 24000000 && rect.bottom >= area.top - 3000 && rect.top <= area.bottom + 3000)) continue;
    pixels -= view.canvas.width * view.canvas.height;
    view.canvas.width = 0;
    view.canvas.height = 0;
    view.ready = false;
    view.overlay.replaceChildren();
    view.forms.replaceChildren();
    view.loading.hidden = false;
  }
}
async function ensureRendered(view) {
  if (view.ready) return;
  if (view.promise) return view.promise;
  const generation = viewGeneration;
  view.promise = (async () => {
    try {
      const page = await getPageAt(view.index);
      view.fields = await page.getAnnotations({ intent: 'display' });
      if (generation !== viewGeneration) return;
      const viewport = viewportOf(page, view.index, scale);
      view.viewport = viewport;
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
      view.canvas.width = Math.ceil(viewport.width * ratio);
      view.canvas.height = Math.ceil(viewport.height * ratio);
      view.task = page.render({ canvasContext: view.canvas.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await view.task.promise;
      if (generation !== viewGeneration) return;
      view.ready = true;
      view.loading.hidden = true;
      drawPage(view);
      drawFormFields(viewport, view);
      evictDistantViews();
    } catch (e) {
      if (generation === viewGeneration && e.name !== 'RenderingCancelledException') {
        view.loading.textContent = 'このページを表示できませんでした。';
        throw e;
      }
    } finally {
      view.task = null;
      view.promise = null;
    }
  })();
  return view.promise;
}
function createView(index) {
  const d = dimensions[index],
    root = document.createElement('div');
  root.className = 'page-wrap';
  root.dataset.index = index;
  root.dataset.label = `${index + 1} / ${pageOrder.length}`;
  root.style.width = `${d.width * scale}px`;
  root.style.height = `${d.height * scale}px`;
  const canvas = document.createElement('canvas');
  canvas.className = 'pdf-canvas';
  canvas.width = 0;
  canvas.height = 0;
  const surface = svg('svg', {
    class: 'page-overlay',
    viewBox: `0 0 ${d.width} ${d.height}`,
    tabindex: 0,
    'aria-label': `${index + 1}ページのPDF書き込み領域`,
  });
  surface.dataset.tool = tool;
  const forms = document.createElement('div');
  forms.className = 'form-layer';
  forms.inert = busy;
  forms.setAttribute('aria-label', `${index + 1}ページのPDF内の文字入力欄`);
  const loading = document.createElement('div');
  loading.className = 'page-loading';
  loading.textContent = `${index + 1}ページを表示しています…`;
  root.append(canvas, surface, forms, loading);
  bindOverlay(surface, index);
  const view = { index, root, canvas, overlay: surface, forms, loading, fields: [], ready: false, task: null, promise: null };
  views.set(index, view);
  $('pageStack').append(root);
  return view;
}
async function render() {
  if (!pdf) return;
  setBusy(true, 'ページを表示しています…');
  try {
    const signature = `${viewMode}:${scale}:${pageOrder.map((p) => `${p.id}:${p.rotate || 0}`).join(',')}${viewMode === 'single' ? ':' + pageIndex : ''}`;
    if (signature !== viewSignature) {
      viewGeneration++;
      pageObserver?.disconnect();
      for (const view of views.values()) {
        view.task?.cancel();
        view.canvas.width = 0;
        view.canvas.height = 0;
      }
      views.clear();
      $('pageStack').replaceChildren();
      viewSignature = signature;
      const indices = viewMode === 'continuous' ? pageOrder.map((_, i) => i) : [pageIndex];
      for (const index of indices) {
        if (!dimensions[index]) {
          const v = viewportOf(await getPageAt(index), index, 1);
          dimensions[index] = { width: v.width, height: v.height };
        }
        createView(index);
      }
      $('pageStack').classList.toggle('continuous', viewMode === 'continuous');
      if (viewMode === 'continuous') {
        pageObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              if (entry.isIntersecting) {
                const view = views.get(Number(entry.target.dataset.index));
                if (view) ensureRendered(view).catch(() => {});
              }
          },
          { root: $('workspace'), rootMargin: '800px 0px' },
        );
        for (const view of views.values()) pageObserver.observe(view.root);
      }
    }
    $('empty').hidden = true;
    $('pageStack').hidden = false;
    activatePage(pageIndex);
    scrollToPage(pageIndex);
    await ensureRendered(views.get(pageIndex));
    draw();
    status(
      viewMode === 'continuous'
        ? '縦にスクロールして各ページを編集できます。画像はCtrl+Vで貼り付けできます。'
        : 'PDF内の入力欄をクリックして入力できます。画像はCtrl+Vで貼り付けできます。',
    );
  } catch (e) {
    status('ページを表示できませんでした：' + e.message, true);
    viewSignature = '';
  } finally {
    setBusy(false);
  }
}
$('workspace').addEventListener('scroll', () => {
  if (scrollFrame !== null) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null;
    if (busy || gesture || $('textDialog').open || viewMode !== 'continuous') return;
    if (navigationScrollTop !== null && Math.abs($('workspace').scrollTop - navigationScrollTop) < 1) return;
    navigationScrollTop = null;
    const area = $('workspace').getBoundingClientRect(),
      focus = area.top + Math.min(200, area.height * 0.35);
    let nearest = null,
      distance = Infinity;
    for (const view of views.values()) {
      const rect = view.root.getBoundingClientRect();
      const gap = rect.top > focus ? rect.top - focus : rect.bottom < focus ? focus - rect.bottom : 0;
      if (gap < distance) {
        nearest = view;
        distance = gap;
      }
    }
    if (nearest) {
      activatePage(nearest.index);
      ensureRendered(nearest).catch(() => {});
    }
    evictDistantViews();
  });
});
$('workspace').addEventListener(
  'wheel',
  () => {
    navigationScrollTop = null;
  },
  { passive: true },
);
$('workspace').addEventListener('pointerdown', () => {
  navigationScrollTop = null;
});
$('workspace').addEventListener('keydown', (event) => {
  if (
    !event.target.matches('input,textarea,select') &&
    ['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(event.key)
  )
    navigationScrollTop = null;
});
$('viewMode').onchange = async () => {
  if (busy || !pdf) return;
  viewMode = $('viewMode').value;
  selected = null;
  await render();
};
async function prepareSource(bytes, name) {
  if (bytes.byteLength > 200 * 1024 * 1024) throw new Error('200MB以下のPDFを選んでください。');
  const preview = await PDFLib.PDFDocument.load(bytes.slice());
  const nextInitial = {};
  let cleared = false,
    previewFont = null;
  // Blank editable text appearances only in the preview. Keep the original PDF
  // bytes and all other widgets intact, and display live inputs in their place.
  for (const field of preview.getForm().getFields()) {
    if (field.isReadOnly()) continue;
    const name = field.getName();
    let value;
    try {
      if (field instanceof PDFLib.PDFTextField) {
        value = field.getText() || '';
        previewFont ||= await preview.embedFont(PDFLib.StandardFonts.Helvetica);
        field.setText('');
        field.updateAppearances(previewFont);
        cleared = true;
      } else if (field instanceof PDFLib.PDFCheckBox) value = String(field.isChecked());
      else if (field instanceof PDFLib.PDFRadioGroup) value = radioStateOf(field);
      else if (field instanceof PDFLib.PDFDropdown) value = dropdownValueOf(field);
      else continue;
    } catch {
      continue;
    }
    Object.defineProperty(nextInitial, name, { value, enumerable: true, configurable: true, writable: true });
  }
  const previewBytes = cleared ? await preview.save({ updateFieldAppearances: false }) : bytes.slice();
  const next = await pdfjs.getDocument({
    data: previewBytes,
    isEvalSupported: false,
    cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
    wasmUrl: new URL('./vendor/wasm/', import.meta.url).href,
  }).promise;
  return { bytes: bytes.slice(), name, preview: next, initial: nextInitial };
}
async function loadPdf(bytes, name, restored = null, restoredForms = {}) {
  const values = Object.fromEntries(Object.entries(restoredForms).map(([key, value]) => [`0:${key}`, value]));
  return loadBundle([{ bytes, name }], name, null, restored, values);
}
async function loadBundle(files, name, pages = null, restored = null, restoredForms = {}) {
  if (busy) return;
  if (dirty && !confirm('保存していない編集があります。別のPDFを開きますか？')) return;
  setBusy(true, 'PDFを読み込んでいます…');
  const prepared = [];
  let committed = false;
  try {
    if (files.reduce((sum, file) => sum + file.bytes.byteLength, 0) > 200 * 1024 * 1024)
      throw new Error('PDFの合計サイズは200MB以下にしてください。');
    for (const file of files) prepared.push(await prepareSource(file.bytes, file.name));
    const order =
      pages ||
      prepared.flatMap((s, source) => Array.from({ length: s.preview.numPages }, (_, page) => ({ source, page, id: crypto.randomUUID() })));
    if (!order.length || order.some((p) => !prepared[p.source] || p.page >= prepared[p.source].preview.numPages))
      throw new Error('ページデータが不正です。');
    viewGeneration++;
    pageObserver?.disconnect();
    for (const view of views.values()) view.task?.cancel();
    viewSignature = '';
    pageSidebar.reset();
    documentRevision++;
    for (const source of sources) await source.preview.destroy();
    sources = prepared;
    pageOrder = clone(order);
    pdf = sources[0].preview;
    filename = name.replace(/[^\p{L}\p{N}_. ()-]/gu, '_') || 'document.pdf';
    annotations = Array.from({ length: pageOrder.length }, (_, i) => clone(restored?.[i] || []));
    dimensions = [];
    pageIndex = 0;
    selected = null;
    scale = 1;
    dirty = false;
    initialFormValues = Object.fromEntries(
      sources.flatMap((s, i) => Object.entries(s.initial).map(([key, value]) => [`${i}:${key}`, value])),
    );
    formValues = Object.fromEntries(
      Object.entries(initialFormValues).map(([key, value]) => [key, Object.hasOwn(restoredForms, key) ? restoredForms[key] : value]),
    );
    formLayer.replaceChildren();
    committed = true;
    history = [snapshot()];
    historyIndex = 0;
    setTool('select');
    $('filename').textContent = filename;
    document.title = `${filename} — File Note`;
    await document.fonts.load('18px NoteJP');
    const page = await getPageAt(0);
    const width = viewportOf(page, 0, 1).width;
    scale = Math.min(1.25, Math.max(0.25, ($('workspace').clientWidth - 52) / width));
    await render();
  } catch (e) {
    status(
      /encrypt|password/i.test(e.message)
        ? 'パスワード付きPDFには対応していません。保護のないPDFを選んでください。'
        : 'PDFを開けませんでした。ダウンロードしたPDFを「ファイルを開く」で選んでください。 ' + e.message,
      true,
    );
  } finally {
    if (!committed) for (const source of prepared) await source.preview.destroy();
    setBusy(false);
  }
}
const isProject = (name) => /\.filenote$/i.test(name);
async function loadFile(file) {
  if (!file || busy) return;
  if (isProject(file.name)) return openProject(file);
  if (file.size > 200 * 1024 * 1024) {
    status('200MB以下のPDFを選んでください。', true);
    return;
  }
  setBusy(true, 'ファイルを読み込んでいます…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    setBusy(false);
    await loadPdf(bytes, file.name);
  } catch (e) {
    setBusy(false);
    status(e.message, true);
  }
}
async function openPdf() {
  if (busy) return;
  const picked = await pickPdf();
  if (picked === undefined) $('fileInput').click();
  else if (picked) await loadFile(picked.file);
}
for (const id of ['open', 'start']) $(id).onclick = openPdf;
$('fileInput').onchange = async () => {
  const f = $('fileInput').files[0];
  $('fileInput').value = '';
  await loadFile(f);
};
async function appendFiles(files) {
  if (!files.length || busy || !pdf) return;
  setBusy(true, '追加するPDFを読み込んでいます…');
  const prepared = [];
  let committed = false;
  try {
    const used = new Set(pageOrder.map((p) => p.source));
    const total = [...used].reduce((sum, i) => sum + sources[i].bytes.byteLength, 0) + files.reduce((sum, f) => sum + f.size, 0);
    if (total > 200 * 1024 * 1024) throw new Error('PDFの合計サイズは200MB以下にしてください。');
    for (const file of files) prepared.push(await prepareSource(new Uint8Array(await file.arrayBuffer()), file.name));
    const position = pageOrder.length;
    const start = sources.length;
    const added = prepared.flatMap((s, i) =>
      Array.from({ length: s.preview.numPages }, (_, page) => ({ source: start + i, page, id: crypto.randomUUID() })),
    );
    for (const [i, s] of prepared.entries())
      for (const [name, value] of Object.entries(s.initial)) {
        const key = `${start + i}:${name}`;
        initialFormValues[key] = value;
        formValues[key] = value;
      }
    sources.push(...prepared);
    pageOrder.splice(position, 0, ...added);
    annotations.splice(position, 0, ...added.map(() => []));
    pageIndex = position;
    selected = null;
    dimensions = [];
    committed = true;
    record();
    await render();
    status(`${files.length}個のPDFから${added.length}ページを追加しました。「戻す」で取り消せます。`);
  } catch (e) {
    status('PDFを追加できませんでした：' + e.message, true);
  } finally {
    if (!committed) for (const source of prepared) await source.preview.destroy();
    setBusy(false);
  }
}
$('appendInput').onchange = async () => {
  const files = Array.from($('appendInput').files);
  $('appendInput').value = '';
  await appendFiles(files);
};
async function moveCurrentPage(target) {
  if (busy || !pdf) return;
  if (!Number.isInteger(target) || target < 0 || target >= pageOrder.length) {
    status(`移動先は1〜${pageOrder.length}ページで指定してください。`, true);
    return;
  }
  if (target === pageIndex) return;
  const from = pageIndex;
  const [page] = pageOrder.splice(from, 1),
    [notes] = annotations.splice(from, 1);
  pageOrder.splice(target, 0, page);
  annotations.splice(target, 0, notes);
  pageIndex = target;
  selected = null;
  dimensions = [];
  record();
  await render();
  status(`${from + 1}ページを${target + 1}ページへ移動しました。`);
}
async function deletePageAt(index) {
  if (busy || !pdf || pageOrder.length <= 1) return;
  pageIndex = index;
  const removed = pageIndex + 1;
  pageOrder.splice(pageIndex, 1);
  annotations.splice(pageIndex, 1);
  pageIndex = Math.min(pageIndex, pageOrder.length - 1);
  selected = null;
  dimensions = [];
  record();
  await render();
  status(`${removed}ページを削除しました。「戻す」で復元できます。`);
}
async function rotateCurrentPage() {
  if (busy || !pdf) return;
  if (objects().length) {
    status('書き込みのあるページは回転できません。先に回転してから書き込むか、書き込みを削除してください。', true);
    return;
  }
  const entry = pageOrder[pageIndex];
  entry.rotate = ((entry.rotate || 0) + 90) % 360;
  selected = null;
  dimensions = [];
  record();
  await render();
  status(`${pageIndex + 1}ページを右に90度回転しました。「戻す」で取り消せます。`);
}
async function insertBlankPage() {
  if (busy || !pdf) return;
  setBusy(true, '白紙ページを追加しています…');
  let prepared = null,
    committed = false;
  try {
    const d = dimensions[pageIndex] || { width: 595.28, height: 841.89 };
    // A blank page is a tiny one-page source, so export and project saving need no special case.
    const doc = await PDFLib.PDFDocument.create();
    doc.addPage([d.width, d.height]);
    prepared = await prepareSource(await doc.save(), '白紙');
    const position = pageIndex + 1;
    pageOrder.splice(position, 0, { source: sources.length, page: 0, id: crypto.randomUUID() });
    sources.push(prepared);
    annotations.splice(position, 0, []);
    pageIndex = position;
    selected = null;
    dimensions = [];
    committed = true;
    record();
    await render();
    status(`${position}ページの後ろに白紙ページを追加しました。「戻す」で取り消せます。`);
  } catch (e) {
    status('白紙ページを追加できませんでした：' + e.message, true);
  } finally {
    if (!committed && prepared) await prepared.preview.destroy();
    setBusy(false);
  }
}
async function dropFiles(files) {
  if (!files.length) return;
  const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const images = files.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
  const project = files.find((f) => isProject(f.name));
  if (!pdfs.length && project) await openProject(project);
  else if (pdfs.length > 1) {
    if (pdfs.reduce((sum, f) => sum + f.size, 0) > 200 * 1024 * 1024) {
      status('PDFの合計サイズは200MB以下にしてください。', true);
      return;
    }
    try {
      const items = [];
      for (const f of pdfs) items.push({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name });
      await loadBundle(items, pdfs[0].name);
    } catch (e) {
      status(e.message, true);
    }
  } else if (pdfs.length === 1) await loadFile(pdfs[0]);
  else if (images.length) {
    if (pdf) await addImages(images);
    else status('先にPDFを開いてから、画像をドロップしてください。', true);
  } else status('PDF・編集データ、または画像（PNG・JPEG・WebP）をドロップしてください。', true);
}
$('workspace').addEventListener('dragover', (e) => {
  e.preventDefault();
  $('workspace').classList.add('dragover');
});
$('workspace').addEventListener('dragleave', () => $('workspace').classList.remove('dragover'));
$('workspace').addEventListener('drop', async (e) => {
  e.preventDefault();
  $('workspace').classList.remove('dragover');
  await dropFiles(Array.from(e.dataTransfer.files));
});
document.querySelectorAll('button[data-tool]').forEach(
  (b) =>
    (b.onclick = () => {
      if (!busy) setTool(b.dataset.tool);
    }),
);
$('prev').onclick = async () => {
  if (!busy && pageIndex > 0) {
    pageIndex--;
    selected = null;
    await render();
  }
};
$('next').onclick = async () => {
  if (!busy && pdf && pageIndex < pageOrder.length - 1) {
    pageIndex++;
    selected = null;
    await render();
  }
};
async function zoom(value) {
  if (!busy && pdf) {
    scale = Math.min(3, Math.max(0.25, value));
    await render();
  }
}
$('zoomIn').onclick = () => zoom(scale + 0.25);
$('zoomOut').onclick = () => zoom(scale - 0.25);
$('fit').onclick = () => zoom(($('workspace').clientWidth - 52) / dimensions[pageIndex].width);
$('undo').onclick = () => restore(-1);
$('redo').onclick = () => restore(1);
$('delete').onclick = () => {
  const ids = selection();
  if (!ids.length || busy) return;
  annotations[pageIndex] = objects().filter((o) => !ids.includes(o.id));
  setSelection([]);
  record();
  draw();
};
$('editText').onclick = () => {
  const o = objects().find((o) => o.id === selected);
  if (o?.type === 'text' && !busy) showText(null, o);
};
for (const id of ['color', 'fill', 'fontSize', 'lineWidth', 'objectWidth', 'objectHeight'])
  $(id).addEventListener('change', () => {
    if (busy) return;
    const o = objects().find((o) => o.id === selected);
    if (id === 'color') {
      const type = o?.type || tool;
      if (shareLineColor.includes(type)) for (const name of shareLineColor) toolColors[name] = $('color').value;
      else if (toolColors[type]) toolColors[type] = $('color').value;
    }
    if (!o) return;
    if (id === 'color' && o.color) o.color = $('color').value;
    else if (id === 'fill' && (o.type === 'rect' || o.type === 'ellipse')) o.fill = $('fill').checked;
    else if (id === 'fontSize' && o.type === 'text') o.size = num(id, 6, 180);
    else if (id === 'lineWidth' && o.width) o.width = num(id, 0.5, 50);
    else if ((id === 'objectWidth' || id === 'objectHeight') && o.type === 'image') {
      const d = dimensions[pageIndex],
        ratio = o.w / o.h;
      let width = id === 'objectWidth' ? num(id, 1, 50000) : num(id, 1, 50000) * ratio,
        height = width / ratio;
      const fit = Math.min(1, (d.width - o.x) / width, (d.height - o.y) / height);
      o.w = width * fit;
      o.h = height * fit;
    } else return;
    record();
    draw();
  });
$('photo').onclick = async () => {
  if (busy || !pdf) return;
  const file = await pickPhoto();
  if (file === undefined) $('imageInput').click();
  else if (file) await addImages([file]);
};
function hasAlpha(canvas) {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}
// Photos become JPEG; PNG is kept for transparency and for flat graphics that PNG compresses well.
function encodeImage(canvas, type) {
  if (type === 'image/jpeg') return canvas.toDataURL('image/jpeg', 0.9);
  const png = canvas.toDataURL('image/png');
  if (hasAlpha(canvas)) return png;
  const jpeg = canvas.toDataURL('image/jpeg', 0.9);
  return jpeg.length < png.length * 0.5 ? jpeg : png;
}
async function addImages(files, pasted = false) {
  if (!files.length || !pdf || busy) return;
  if (files.some((file) => file.size > 30 * 1024 * 1024)) {
    status('画像は1枚30MB以下にしてください。', true);
    return;
  }
  setBusy(true, pasted ? 'クリップボードの画像を読み込んでいます…' : '写真を読み込んでいます…');
  try {
    const prepared = [];
    for (const file of files) {
      const img = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const pixelScale = Math.min(1, 2400 / Math.max(img.width, img.height)),
        canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * pixelScale));
      canvas.height = Math.max(1, Math.round(img.height * pixelScale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      img.close();
      const data = encodeImage(canvas, file.type),
        d = dimensions[pageIndex];
      const w = Math.min(240, d.width * 0.65),
        h = (w * canvas.height) / canvas.width,
        fit = Math.min(1, (d.height * 0.7) / h);
      const o = {
        id: crypto.randomUUID(),
        type: 'image',
        x: (d.width - w * fit) / 2,
        y: (d.height - h * fit) / 2,
        w: w * fit,
        h: h * fit,
        data,
      };
      prepared.push(o);
    }
    objects().push(...prepared);
    record();
    setTool('select');
    selected = prepared.at(-1).id;
    draw();
    status(
      pasted
        ? '画像を貼り付けました。ドラッグで移動し、右下の四角でサイズを変更できます。'
        : '写真を追加しました。右下の四角でサイズを変更できます。',
    );
  } catch (e) {
    status('写真を開けませんでした。PNG・JPEG・WebPを選んでください。', true);
  } finally {
    setBusy(false);
    draw();
  }
}
$('imageInput').onchange = async () => {
  const file = $('imageInput').files[0];
  $('imageInput').value = '';
  if (file) await addImages([file]);
};
document.addEventListener('paste', (event) => {
  if (!pdf || busy || gesture || dialogOpen() || event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  let files = Array.from(event.clipboardData?.items || [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (!files.length) files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'));
  if (!files.length) {
    if (clipboardNotes.length) {
      event.preventDefault();
      pasteNote();
    }
    return;
  }
  event.preventDefault();
  addImages(files, true);
});
function pasteNote() {
  const d = dimensions[pageIndex];
  if (!clipboardNotes.length || !d) return;
  const copies = cloneNotes(clipboardNotes);
  for (const o of copies) o.id = crypto.randomUUID();
  const [mx, my] = clampedShift(copies, 12, 12);
  for (const o of copies) translate(o, mx, my);
  objects().push(...copies);
  clipboardNotes = cloneNotes(copies);
  record();
  setTool('select');
  setSelection(copies.map((o) => o.id));
  draw();
  status('コピーした書き込みを貼り付けました。');
}
function nudgeSelected(dx, dy) {
  const targets = selectedNotes();
  if (!targets.length || !dimensions[pageIndex]) return;
  const [mx, my] = clampedShift(targets, dx, dy);
  for (const o of targets) translate(o, mx, my);
  // Holding a key should be one undo step, not one per repeat.
  const now = Date.now(),
    key = targets.map((o) => o.id).join(',');
  if (nudge.id === key && now - nudge.time < 600 && historyIndex === history.length - 1) {
    history[historyIndex] = snapshot();
    dirty = true;
    pageSidebar.invalidate();
  } else record();
  nudge = { id: key, time: now };
  draw();
}
function download(bytes, name, type) {
  const blob = new Blob([bytes], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
// Storage can be blocked by browser settings; the choice then lasts for this page only.
try {
  $('compress').checked = localStorage.getItem('file-note-compress') === '1';
} catch {
  // Not remembered.
}
$('compress').onchange = () => {
  try {
    if ($('compress').checked) localStorage.setItem('file-note-compress', '1');
    else localStorage.removeItem('file-note-compress');
  } catch {
    // Not remembered.
  }
};
$('save').onclick = async () => {
  if (!pdf || busy) return;
  // A download, like the project save: Chrome's save dialog can report "cancelled" for some folders.
  const saveName = filename.replace(/\.pdf$/i, '') + '_edited.pdf';
  setBusy(true, 'PDFを作成しています…');
  try {
    if (annotations.some((list) => list.some((o) => o.type === 'text')) || Object.keys(changedForms()).length)
      fontPromise ||= fetch(new URL('./fonts/NotoSansJP-Regular.ttf', import.meta.url)).then((r) => r.arrayBuffer());
    // Restored projects may contain notes on pages that have not been displayed.
    for (let i = 0; i < annotations.length; i++)
      if (annotations[i].length && !dimensions[i]) {
        const v = viewportOf(await getPageAt(i), i, 1);
        dimensions[i] = { width: v.width, height: v.height };
      }
    const bytes = await buildPdf({
      sources,
      pages: pageOrder,
      annotations,
      dimensions,
      formValues: changedForms(),
      fontBytes: fontPromise ? await fontPromise : null,
      compress: $('compress').checked,
    });
    download(bytes, saveName, 'application/pdf');
    dirty = false;
    status('編集済みPDFをダウンロードしました。元のファイルとは別名で保存します。');
  } catch (e) {
    status('保存できませんでした：' + e.message, true);
  } finally {
    setBusy(false);
    draw();
  }
};
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
function fromBase64(s) {
  const raw = atob(s);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
$('projectSave').onclick = () => {
  if (!pdf || busy) return;
  // Save only sources still present in the document, remapping their indices.
  const used = [...new Set(pageOrder.map((p) => p.source))].sort((a, b) => a - b),
    map = new Map(used.map((id, i) => [id, i]));
  const values = Object.fromEntries(
    Object.entries(formValues)
      .filter(([key]) => map.has(Number(key.slice(0, key.indexOf(':')))))
      .map(([key, value]) => {
        const colon = key.indexOf(':');
        return [`${map.get(Number(key.slice(0, colon)))}:${key.slice(colon + 1)}`, value];
      }),
  );
  const payload = {
    format: 'file-note',
    version: 2,
    filename,
    sources: used.map((i) => ({ filename: sources[i].name, pdf: toBase64(sources[i].bytes) })),
    pages: pageOrder.map((p) => ({ ...p, source: map.get(p.source) })),
    annotations,
    formValues: values,
  };
  download(JSON.stringify(payload), filename.replace(/\.pdf$/i, '') + '.filenote', 'application/json');
  dirty = false;
  status('編集データを保存しました。文字や写真の配置を、後から再編集できます。');
};
function validateProject(p) {
  if (p?.format !== 'file-note' || ![1, 2].includes(p.version) || typeof p.filename !== 'string' || !Array.isArray(p.annotations))
    throw new Error('File Noteの編集データではありません。');
  if (p.version === 1 && typeof p.pdf !== 'string') throw new Error('PDFデータが不正です。');
  if (p.version === 2) {
    if (
      !Array.isArray(p.sources) ||
      !p.sources.length ||
      p.sources.some((s) => typeof s?.filename !== 'string' || typeof s.pdf !== 'string')
    )
      throw new Error('連結PDFデータが不正です。');
    if (
      !Array.isArray(p.pages) ||
      !p.pages.length ||
      p.pages.length !== p.annotations.length ||
      new Set(p.pages.map((page) => page?.id)).size !== p.pages.length ||
      p.pages.some(
        (page) =>
          typeof page?.id !== 'string' ||
          (page.rotate !== undefined && ![0, 90, 180, 270].includes(page.rotate)) ||
          !Number.isInteger(page.source) ||
          page.source < 0 ||
          page.source >= p.sources.length ||
          !Number.isInteger(page.page) ||
          page.page < 0,
      )
    )
      throw new Error('ページデータが不正です。');
    const pairs = p.pages.map((page) => `${page.source}:${page.page}`);
    if (new Set(pairs).size !== pairs.length) throw new Error('ページデータが重複しています。');
  }
  if (
    p.formValues !== undefined &&
    (p.formValues === null ||
      typeof p.formValues !== 'object' ||
      Array.isArray(p.formValues) ||
      Object.entries(p.formValues).some(([name, value]) => name.length > 10000 || typeof value !== 'string' || value.length > 1000000))
  )
    throw new Error('入力欄データが不正です。');
  let count = 0;
  for (const list of p.annotations) {
    if (!Array.isArray(list)) throw new Error('書き込みデータが不正です。');
    for (const o of list) {
      if (++count > 20000 || typeof o?.id !== 'string' || !['text', 'image', 'pen', ...twoPointShapes].includes(o.type))
        throw new Error('書き込みデータが不正です。');
      if (o.type !== 'image' && !/^#[0-9a-f]{6}$/i.test(o.color)) throw new Error('色データが不正です。');
      const finite = (...values) => values.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000000);
      if (o.type === 'text' && (!finite(o.x, o.y, o.size) || o.size <= 0 || typeof o.text !== 'string' || o.text.length > 10000))
        throw new Error('文字データが不正です。');
      if (
        o.type === 'image' &&
        (!finite(o.x, o.y, o.w, o.h) ||
          o.w <= 0 ||
          o.h <= 0 ||
          typeof o.data !== 'string' ||
          !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(o.data))
      )
        throw new Error('画像データが不正です。');
      if (
        o.points &&
        (!finite(o.width) ||
          o.width <= 0 ||
          !Array.isArray(o.points) ||
          o.points.length > 100000 ||
          o.points.some((pt) => !finite(pt.x, pt.y)))
      )
        throw new Error('線データが不正です。');
      if ((o.type === 'pen' || twoPointShapes.includes(o.type)) && (!Array.isArray(o.points) || o.points.length < 2))
        throw new Error('線データが不正です。');
    }
  }
}
async function openProject(file) {
  if (!file || busy) return;
  setBusy(true, '編集データを読み込んでいます…');
  try {
    if (file.size > 350 * 1024 * 1024) throw new Error('編集データが大きすぎます。');
    const p = JSON.parse(await file.text());
    validateProject(p);
    setBusy(false);
    if (p.version === 1) await loadPdf(fromBase64(p.pdf), p.filename, p.annotations, p.formValues || {});
    else
      await loadBundle(
        p.sources.map((s) => ({ bytes: fromBase64(s.pdf), name: s.filename })),
        p.filename,
        p.pages,
        p.annotations,
        p.formValues || {},
      );
  } catch (e) {
    setBusy(false);
    status('編集データを開けませんでした：' + e.message, true);
  }
}
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,textarea,select') || dialogOpen() || busy) return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'z') {
      e.preventDefault();
      restore(e.shiftKey ? 1 : -1);
    }
    if (e.key.toLowerCase() === 'y') {
      e.preventDefault();
      restore(1);
    }
    if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      $('save').click();
    }
    if (e.key.toLowerCase() === 'c') {
      const chosen = selectedNotes();
      if (chosen.length) clipboardNotes = cloneNotes(chosen);
    }
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selection().length) {
      e.preventDefault();
      $('delete').click();
    }
  } else if (selection().length && e.key.startsWith('Arrow') && !e.target.closest?.('.thumb-card')) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    nudgeSelected(
      e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
      e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
    );
  } else if (e.key === 'Escape') {
    selected = null;
    setTool('select');
  }
});
window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
const pageSidebar = new PageSidebar({
  list: $('pageThumbs'),
  viewport: viewportOf,
  state: () => ({
    pages: pageOrder,
    sources,
    notes: annotations,
    values: formValues,
    dimensions,
    current: pageIndex,
    busy,
    tool,
    revision: documentRevision,
  }),
  getPage: getPageAt,
  navigate: async (index) => {
    if (busy || index < 0) return;
    pageIndex = index;
    selected = null;
    await render();
  },
  move: async (from, target) => {
    if (busy) return;
    pageIndex = from;
    await moveCurrentPage(target);
  },
  remove: deletePageAt,
});
$('railAppend').onclick = () => {
  if (!busy && pdf) $('appendInput').click();
};
$('railRotate').onclick = rotateCurrentPage;
$('railBlank').onclick = insertBlankPage;
setTool('select');
setBusy(false);
const transfer = new URL(location.href).searchParams.get('transfer');
if (transfer) {
  try {
    setBusy(true, '選択したファイルを開いています…');
    const item = await consumePdf(transfer);
    if (!item) throw new Error('選択したファイルが見つかりません。「ファイルを開く」から選んでください。');
    setBusy(false);
    if (isProject(item.filename)) await openProject(new File([item.file], item.filename));
    else await loadPdf(new Uint8Array(await item.file.arrayBuffer()), item.filename);
  } catch (e) {
    setBusy(false);
    status('ファイルを開けませんでした：' + e.message, true);
  }
}
const source = new URL(location.href).searchParams.get('source');
if (source && !transfer) {
  try {
    const url = new URL(source);
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('このURLは読み込めません。');
    setBusy(true, 'Chromeで開いているPDFを読み込んでいます…');
    const response = await fetch(url.href, { credentials: 'include', signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get('Content-Length'));
    if (length > 200 * 1024 * 1024) throw new Error('200MB以下のPDFを選んでください。');
    const bytes = new Uint8Array(await response.arrayBuffer());
    let name = 'document.pdf';
    try {
      name = decodeURIComponent(url.pathname.split('/').pop()) || name;
    } catch {
      /* keep the default name */
    }
    if (!/\.pdf$/i.test(name)) name += '.pdf';
    setBusy(false);
    await loadPdf(bytes, name);
  } catch (e) {
    setBusy(false);
    status('自動で読み込めませんでした。「ファイルを開く」で、ダウンロードしたPDFを選んでください。 ' + e.message, true);
  }
}
