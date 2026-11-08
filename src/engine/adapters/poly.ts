// Polyline (SubProcess_6) and Polygon (SubProcess_7) editor points.
import type { EditorPoint, ShapeAdapter, Vec } from '../model';
import { elementId } from '../model';
import { fmt } from '../num';
import { boxMap, matApply, mid, rectFromPoints } from '../geom';

/** PolyGeometry: ordered [x,y] list. */
export function parsePoints(s: string | null): Vec[] {
  const n = (s ?? '').match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
  const out: Vec[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] });
  return out;
}

export function formatPoints(pts: Vec[]): string {
  return pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
}

function makePolyAdapter(closed: boolean): ShapeAdapter {
  const min = closed ? 3 : 2;
  const read = (el: Element) => parsePoints(el.getAttribute('points'));
  const write = (pts: Vec[]) => ({ points: formatPoints(pts) });
  const segCount = (n: number) => (closed ? n : n - 1);

  return {
    tagNames: [closed ? 'polygon' : 'polyline'],
    geometryAttrs: ['points'],

    getPoints(el) {
      const pts = read(el);
      const eid = elementId(el);
      const out: EditorPoint[] = pts.map((p, i) => ({
        id: `v${i}`, elementId: eid, kind: 'anchor', role: 'vertex', x: p.x, y: p.y, attr: ['points'], segmentIndex: i, constraint: 'none',
      }));
      for (let i = 0; i < segCount(pts.length); i++) {
        const m = mid(pts[i], pts[(i + 1) % pts.length]);
        out.push({
          id: `m${i}`, elementId: eid, kind: 'ghost', role: 'insert', x: m.x, y: m.y, attr: ['points'], segmentIndex: i, constraint: 'none',
          linkedPointIds: [`v${i}`, `v${(i + 1) % pts.length}`],
        });
      }
      return out;
    },

    dragPoint(el, id, t) {
      const pts = read(el);
      const i = Number(id.slice(1));
      if (id[0] !== 'v' || !pts[i]) return {};
      pts[i] = t;
      return write(pts);
    },

    insertPoint(el, id) {
      if (id[0] !== 'm') return null;
      const pts = read(el);
      const i = Number(id.slice(1));
      const m = mid(pts[i], pts[(i + 1) % pts.length]);
      pts.splice(i + 1, 0, m); // closing segment ghost (i = n-1) appends at the end
      return { patch: write(pts), pointId: `v${i + 1}` };
    },

    deletePoint(el, ids) {
      const pts = read(el);
      const idx = ids.filter((id) => id[0] === 'v').map((id) => Number(id.slice(1)));
      if (!idx.length || pts.length - idx.length < min) return null;
      return write(pts.filter((_, i) => !idx.includes(i)));
    },

    movePoints(el, ids, d) {
      const pts = read(el);
      const idx = new Set(ids.filter((id) => id[0] === 'v').map((id) => Number(id.slice(1))));
      return write(pts.map((p, i) => (idx.has(i) ? { x: p.x + d.x, y: p.y + d.y } : p)));
    },

    translate(el, d) { return write(read(el).map((p) => ({ x: p.x + d.x, y: p.y + d.y }))); },

    getBBox(el) { return rectFromPoints(read(el)); },

    resize(el, from, to) {
      const m = boxMap(from, to);
      return write(read(el).map((p) => matApply(m, p)));
    },

    segments(el) {
      const pts = read(el);
      const out: Vec[][] = [];
      for (let i = 0; i < segCount(pts.length); i++) out.push([pts[i], pts[(i + 1) % pts.length]]);
      return out;
    },

    toPath(el) {
      const pts = read(el);
      if (!pts.length) return '';
      return pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join('') + (closed ? 'Z' : '');
    },
  };
}

export const polylineAdapter = makePolyAdapter(false);
export const polygonAdapter = makePolyAdapter(true);
