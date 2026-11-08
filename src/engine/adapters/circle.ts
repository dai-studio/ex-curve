// Circle (SubProcess_3) and Ellipse (SubProcess_4) editor points.
import type { EditorPoint, ShapeAdapter } from '../model';
import { elementId } from '../model';
import { fmt, num } from '../num';
import { dist } from '../geom';
import { changed } from './common';

const DIRS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];

export const circleAdapter: ShapeAdapter = {
  tagNames: ['circle'],
  geometryAttrs: ['cx', 'cy', 'r'],
  uniformOnly: true,

  getPoints(el) {
    const cx = num(el, 'cx'), cy = num(el, 'cy'), r = Math.max(0, num(el, 'r'));
    const eid = elementId(el);
    const pts: EditorPoint[] = [{ id: 'c', elementId: eid, kind: 'anchor', role: 'centre', x: cx, y: cy, attr: ['cx', 'cy'], constraint: 'none' }];
    DIRS.forEach((d, k) => pts.push({
      id: `r${k}`, elementId: eid, kind: 'parameter', role: 'radius', x: cx + d.x * r, y: cy + d.y * r, attr: ['r'], constraint: 'radial',
      // Minimum radius: collapsed handles are offset 8px in screen space so they stay grabbable.
      screenOffset: r === 0 ? { x: d.x * 8, y: d.y * 8 } : undefined,
    }));
    return pts;
  },

  dragPoint(el, id, t) {
    const c = { x: num(el, 'cx'), y: num(el, 'cy') };
    if (id === 'c') return changed(el, { cx: t.x, cy: t.y });
    return changed(el, { r: Math.max(0, dist(t, c)) });
  },

  movePoints(el, ids, d) {
    if (ids.includes('c')) return this.translate!(el, d)!;
    const p = this.getPoints(el).find((q) => q.id === ids[0]);
    return p ? this.dragPoint(el, p.id, { x: p.x + d.x, y: p.y + d.y }, { shift: false, alt: false, ctrl: false, meta: false }) : {};
  },

  translate(el, d) { return changed(el, { cx: num(el, 'cx') + d.x, cy: num(el, 'cy') + d.y }); },

  getBBox(el) {
    const r = num(el, 'r');
    return { x: num(el, 'cx') - r, y: num(el, 'cy') - r, width: 2 * r, height: 2 * r };
  },

  resize(el, _f, to) {
    return changed(el, { cx: to.x + to.width / 2, cy: to.y + to.height / 2, r: Math.min(to.width, to.height) / 2 });
  },

  toPath(el) { return ellipsePath(num(el, 'cx'), num(el, 'cy'), num(el, 'r'), num(el, 'r')); },
};

export const ellipseAdapter: ShapeAdapter = {
  tagNames: ['ellipse'],
  geometryAttrs: ['cx', 'cy', 'rx', 'ry'],

  getPoints(el) {
    const cx = num(el, 'cx'), cy = num(el, 'cy'), rx = num(el, 'rx'), ry = num(el, 'ry');
    const eid = elementId(el);
    const P = (id: string, x: number, y: number, attr: string[], constraint: EditorPoint['constraint'], off?: { x: number; y: number }): EditorPoint =>
      ({ id, elementId: eid, kind: id === 'c' ? 'anchor' : 'parameter', role: id === 'c' ? 'centre' : 'radius', x, y, attr, constraint, screenOffset: off });
    return [
      P('c', cx, cy, ['cx', 'cy'], 'none'),
      P('rx-e', cx + rx, cy, ['rx', 'ry'], 'x-axis', rx === 0 ? { x: 8, y: 0 } : undefined),
      P('rx-w', cx - rx, cy, ['rx', 'ry'], 'x-axis', rx === 0 ? { x: -8, y: 0 } : undefined),
      P('ry-s', cx, cy + ry, ['ry', 'rx'], 'y-axis', ry === 0 ? { x: 0, y: 8 } : undefined),
      P('ry-n', cx, cy - ry, ['ry', 'rx'], 'y-axis', ry === 0 ? { x: 0, y: -8 } : undefined),
    ];
  },

  dragPoint(el, id, t, mods) {
    const cx = num(el, 'cx'), cy = num(el, 'cy'), rx = num(el, 'rx'), ry = num(el, 'ry');
    if (id === 'c') return changed(el, { cx: t.x, cy: t.y });
    if (id.startsWith('rx')) {
      const v = Math.abs(t.x - cx);
      if (mods.alt) return changed(el, { rx: v, ry: v });
      if (mods.shift && rx) return changed(el, { rx: v, ry: (ry * v) / rx });
      return changed(el, { rx: v });
    }
    const v = Math.abs(t.y - cy);
    if (mods.alt) return changed(el, { ry: v, rx: v });
    if (mods.shift && ry) return changed(el, { ry: v, rx: (rx * v) / ry });
    return changed(el, { ry: v });
  },

  movePoints(el, ids, d) {
    if (ids.includes('c')) return this.translate!(el, d)!;
    const p = this.getPoints(el).find((q) => q.id === ids[0]);
    return p ? this.dragPoint(el, p.id, { x: p.x + d.x, y: p.y + d.y }, { shift: false, alt: false, ctrl: false, meta: false }) : {};
  },

  translate(el, d) { return changed(el, { cx: num(el, 'cx') + d.x, cy: num(el, 'cy') + d.y }); },

  getBBox(el) {
    const rx = num(el, 'rx'), ry = num(el, 'ry');
    return { x: num(el, 'cx') - rx, y: num(el, 'cy') - ry, width: 2 * rx, height: 2 * ry };
  },

  resize(el, _f, to) {
    return changed(el, { cx: to.x + to.width / 2, cy: to.y + to.height / 2, rx: to.width / 2, ry: to.height / 2 });
  },

  toPath(el) { return ellipsePath(num(el, 'cx'), num(el, 'cy'), num(el, 'rx'), num(el, 'ry')); },
};

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const f = fmt;
  return `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
}
