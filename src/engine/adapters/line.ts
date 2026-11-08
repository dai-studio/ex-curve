// Line editor points (SubProcess_5).
import type { ShapeAdapter, Vec } from '../model';
import { elementId } from '../model';
import { fmt, num } from '../num';
import { matApply, boxMap, rectFromPoints, snapAngle } from '../geom';
import { changed } from './common';

const ends = (el: Element): [Vec, Vec] => [
  { x: num(el, 'x1'), y: num(el, 'y1') },
  { x: num(el, 'x2'), y: num(el, 'y2') },
];

export const lineAdapter: ShapeAdapter = {
  tagNames: ['line'],
  geometryAttrs: ['x1', 'y1', 'x2', 'y2'],

  getPoints(el) {
    const [a, b] = ends(el);
    const eid = elementId(el);
    return [
      { id: 'p1', elementId: eid, kind: 'anchor', role: 'endpoint', ...a, attr: ['x1', 'y1'], constraint: 'none' },
      { id: 'p2', elementId: eid, kind: 'anchor', role: 'endpoint', ...b, attr: ['x2', 'y2'], constraint: 'none' },
      { id: 'mid', elementId: eid, kind: 'move', role: 'translate', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, attr: ['x1', 'y1', 'x2', 'y2'], constraint: 'none' },
    ];
  },

  dragPoint(el, id, t, mods) {
    const [a, b] = ends(el);
    if (id === 'p1') { const p = mods.shift ? snapAngle(t, b) : t; return changed(el, { x1: p.x, y1: p.y }); }
    if (id === 'p2') { const p = mods.shift ? snapAngle(t, a) : t; return changed(el, { x2: p.x, y2: p.y }); }
    if (id === 'mid') {
      const d = { x: t.x - (a.x + b.x) / 2, y: t.y - (a.y + b.y) / 2 };
      return this.translate!(el, d)!;
    }
    return {};
  },

  movePoints(el, ids, d) {
    const [a, b] = ends(el);
    const both = ids.includes('mid') || (ids.includes('p1') && ids.includes('p2'));
    const vals: Record<string, number> = {};
    if (both || ids.includes('p1')) Object.assign(vals, { x1: a.x + d.x, y1: a.y + d.y });
    if (both || ids.includes('p2')) Object.assign(vals, { x2: b.x + d.x, y2: b.y + d.y });
    return changed(el, vals);
  },

  translate(el, d) {
    const [a, b] = ends(el);
    return changed(el, { x1: a.x + d.x, y1: a.y + d.y, x2: b.x + d.x, y2: b.y + d.y });
  },

  getBBox(el) { return rectFromPoints(ends(el)); },

  resize(el, from, to) {
    const m = boxMap(from, to);
    const [a, b] = ends(el).map((p) => matApply(m, p));
    return changed(el, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  },

  segments(el) { return [ends(el)]; },

  toPath(el) {
    const [a, b] = ends(el);
    return `M${fmt(a.x)} ${fmt(a.y)}L${fmt(b.x)} ${fmt(b.y)}`;
  },
};
