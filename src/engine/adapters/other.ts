// Text (Task_37), image/foreignObject/use/svg (Task_38) and group (Task_39) adapters.
import type { EditorPoint, ShapeAdapter } from '../model';
import { elementId } from '../model';
import { fmt, has, num } from '../num';
import { boxMap, matApply } from '../geom';
import { boxPoints, changed, dragBox, domBBox, isBoxHandle, readRect, rectAttrs, rectPatch } from './common';

const list = (s: string | null) => (s ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
const fmtList = (a: number[]) => a.map((n) => fmt(n)).join(' ');

function fontSize(el: Element): number {
  const a = el.getAttribute('font-size');
  if (a && parseFloat(a)) return parseFloat(a);
  try { return parseFloat(getComputedStyle(el).fontSize) || 16; } catch { return 16; }
}

export const textAdapter: ShapeAdapter = {
  tagNames: ['text', 'tspan'],
  edgeResizeUsesTransform: true,

  getPoints(el) {
    const xs = list(el.getAttribute('x')), ys = list(el.getAttribute('y'));
    const eid = elementId(el);
    const out: EditorPoint[] = [{
      id: 'o', elementId: eid, kind: 'anchor', role: 'baseline-origin', x: xs[0] ?? 0, y: ys[0] ?? 0, attr: ['x', 'y'], constraint: 'none',
    }];
    // Per-glyph x/y lists: read-only markers in v1.
    for (let k = 1; k < Math.max(xs.length, ys.length); k++) {
      out.push({
        id: `g${k}`, elementId: eid, kind: 'ghost', role: 'glyph', x: xs[k] ?? xs[xs.length - 1] ?? 0, y: ys[k] ?? ys[ys.length - 1] ?? 0,
        attr: [], constraint: 'none', action: 'click',
      });
    }
    return out;
  },

  dragPoint(el, id, t) {
    if (id !== 'o') return {};
    const xs = list(el.getAttribute('x')), ys = list(el.getAttribute('y'));
    return this.translate!(el, { x: t.x - (xs[0] ?? 0), y: t.y - (ys[0] ?? 0) })!;
  },

  movePoints(el, ids, d) { return ids.includes('o') ? this.translate!(el, d)! : {}; },

  translate(el, d) {
    const xs = list(el.getAttribute('x')), ys = list(el.getAttribute('y'));
    return changed(el, {
      x: fmtList((xs.length ? xs : [0]).map((v) => v + d.x)),
      y: fmtList((ys.length ? ys : [0]).map((v) => v + d.y)),
    });
  },

  getBBox: domBBox,

  /** Corner handles scale font-size proportionally (uniform); x/y follow the scaling. */
  resize(el, from, to) {
    const s = from.width ? to.width / from.width : from.height ? to.height / from.height : 1;
    const m = boxMap(from, { ...to, width: from.width * s, height: from.height * s });
    const xs = list(el.getAttribute('x')), ys = list(el.getAttribute('y'));
    const n = Math.max(xs.length, ys.length, 1);
    const pts = Array.from({ length: n }, (_, k) => matApply(m, { x: xs[k] ?? xs[0] ?? 0, y: ys[k] ?? ys[0] ?? 0 }));
    return changed(el, {
      x: fmtList(pts.slice(0, Math.max(xs.length, 1)).map((p) => p.x)),
      y: fmtList(pts.slice(0, Math.max(ys.length, 1)).map((p) => p.y)),
      'font-size': fontSize(el) * s,
    });
  },
};

export const boxAdapter: ShapeAdapter = {
  tagNames: ['image', 'foreignObject', 'use', 'svg'],
  geometryAttrs: ['x', 'y', 'width', 'height'],
  // <use> without width/height has only an x,y anchor, so it keeps the box resize handles.
  hasOwnResize: (el) => !(el.tagName === 'use' && !(has(el, 'width') && has(el, 'height'))),

  getPoints(el) {
    // <use> without width/height: only an x,y anchor.
    if (el.tagName === 'use' && !(has(el, 'width') && has(el, 'height'))) {
      return [{ id: 'o', elementId: elementId(el), kind: 'anchor', role: 'origin', x: num(el, 'x'), y: num(el, 'y'), attr: ['x', 'y'], constraint: 'none' }];
    }
    return boxPoints(el, readRect(el), rectAttrs);
  },

  dragPoint(el, id, t, mods) {
    if (id === 'o') return changed(el, { x: t.x, y: t.y });
    if (isBoxHandle(id)) return rectPatch(el, dragBox(readRect(el), id, t, mods), rectAttrs(id));
    return {};
  },

  movePoints(el, _ids, d) { return this.translate!(el, d)!; },

  translate(el, d) { return changed(el, { x: num(el, 'x') + d.x, y: num(el, 'y') + d.y }); },

  getBBox(el) {
    if (el.tagName === 'use' && !(has(el, 'width') && has(el, 'height'))) return domBBox(el);
    return readRect(el);
  },

  resize(el, _from, to) {
    if (el.tagName === 'use' && !(has(el, 'width') && has(el, 'height'))) return null;
    return rectPatch(el, to);
  },
};

export const groupAdapter: ShapeAdapter = {
  tagNames: ['g', 'a', 'switch'],
  getPoints() { return []; },
  dragPoint() { return {}; },
  translate() { return null; },
  getBBox: domBBox,
  resize() { return null; },
};
