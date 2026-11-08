import { describe, expect, it } from 'vitest';
import { NO_MODS } from '../src/model';
import { pathAdapter } from '../src/adapters/path';
import { applyPatch } from '../src/history';
import { arcCenter, deleteAnchor, ends, parsePath, pointAt, serializePath, splitSegment } from '../src/path/path';
import { dist, rotate, sub } from '../src/geom';

const NS = 'http://www.w3.org/2000/svg';
const path = (d: string) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); return p; };

const ALL = 'M10 10 L20 20 H30 V40 C40 40 50 50 60 60 S80 80 90 90 Q100 100 110 110 T130 130 A10 20 30 0 1 150 150 Z '
  + 'm5 5 l10 10 h10 v10 c10 0 10 10 20 10 s10 10 20 0 q10 10 20 0 t20 0 a10 10 0 1 0 20 0 z';

/** Sample the whole path for shape comparisons. */
function sample(d: string): { x: number; y: number }[] {
  const { segs } = parsePath(d);
  const e = ends(segs);
  const out: { x: number; y: number }[] = [];
  segs.forEach((s, i) => { if (s.command !== 'M') for (let t = 0; t <= 1.0001; t += 0.01) out.push(pointAt(segs, i, t, e)); });
  return out;
}
/** Max distance from each sample of a to the polyline of b. */
function hausdorff(a: string, b: string): number {
  const sb = sample(b);
  return Math.max(...sample(a).map((p) => Math.min(...sb.map((q) => dist(p, q)))));
}

describe('Path parser / serializer', () => {
  it('round-trips every command in relative and absolute form byte for byte', () => {
    for (const d of [ALL, 'M0,0L10-5.5.5.5z', 'm1 2 3 4 5 6', 'M0 0a5 5 0 1010 0', '  M 1 1 L 2 2  ']) {
      expect(serializePath(parsePath(d))).toBe(d);
    }
  });

  it('parses implicit repeats, packed numbers and arc flags', () => {
    const { segs } = parsePath('m1 2 3 4 5 6 M0 0a5 5 0 1010 0');
    expect(segs.map((s) => s.command + (s.relative ? 'r' : ''))).toEqual(['Mr', 'Lr', 'Lr', 'M', 'Ar']);
    expect(segs[2].points[0]).toEqual({ x: 9, y: 12 });
    expect([segs[4].largeArc, segs[4].sweep, segs[4].points[0]]).toEqual([true, false, { x: 10, y: 0 }]);
  });

  it('editing one absolute point changes only that segment text', () => {
    const p = path(ALL);
    const a = pathAdapter;
    // drag cp1 of the C segment (index 4)
    const pt = a.getPoints(p).find((q) => q.id === 'c1:4')!;
    applyPatch(p, a.dragPoint(p, 'c1:4', { x: pt.x + 1, y: pt.y }, { ...NO_MODS, alt: true }));
    expect(p.getAttribute('d')).toBe(ALL.replace('C40 40', 'C41 40'));
  });

  it('moving an anchor before a relative segment re-emits only the neighbours', () => {
    const p = path('M0 0 l10 0 l10 0 l10 0');
    const a1 = pathAdapter.getPoints(p).find((q) => q.id === 'a1')!;
    applyPatch(p, pathAdapter.dragPoint(p, 'a1', { x: a1.x, y: a1.y + 5 }, NO_MODS));
    expect(p.getAttribute('d')).toBe('M0 0 l10 5 l10 -5 l10 0');
  });

  it('H anchors are constrained to the x axis', () => {
    const p = path('M0 0 H10 L20 20');
    applyPatch(p, pathAdapter.dragPoint(p, 'a1', { x: 15, y: 50 }, NO_MODS));
    expect(p.getAttribute('d')).toBe('M0 0 H15 L20 20');
  });
});

describe('Arc endpoint parameterisation', () => {
  it('rx/ry handles land on the rendered ellipse for rotated and non-rotated arcs', () => {
    for (const d of ['M0 0 A50 30 0 0 1 80 20', 'M0 0 A50 30 35 1 0 80 20', 'M0 0 A5 3 20 0 1 80 20']) {
      const p = path(d);
      const { segs } = parsePath(d);
      const ac = arcCenter(segs, 1)!;
      // Arc passes through both endpoints (radii scaled up if too small).
      expect(dist(pointAt(segs, 1, 0), { x: 0, y: 0 })).toBeLessThan(0.01);
      expect(dist(pointAt(segs, 1, 1), { x: 80, y: 20 })).toBeLessThan(0.01);
      for (const id of ['rx:1', 'ry:1', 'rot:1']) {
        const h = pathAdapter.getPoints(p).find((q) => q.id === id)!;
        const l = rotate(sub(h, ac.c), -ac.phi);
        expect(Math.abs((l.x / ac.rx) ** 2 + (l.y / ac.ry) ** 2 - 1)).toBeLessThan(0.01);
      }
    }
  });

  it('dragging a radius handle writes the effective radii and does not jump', () => {
    const p = path('M0 0 A5 3 0 0 1 80 0');
    const h = pathAdapter.getPoints(p).find((q) => q.id === 'rx:1')!;
    applyPatch(p, pathAdapter.dragPoint(p, 'rx:1', h, NO_MODS));
    expect(p.getAttribute('d')).toBe('M0 0 A40 24 0 0 1 80 0');
  });

  it('rotation handle is stable and flip ghosts never sit on radius handles', () => {
    for (const d of ['M0 0 A50 30 20 0 1 80 0', 'M0 0 A50 30 20 1 0 80 0', 'M160 420 A40 30 0 0 1 240 420']) {
      const p = path(d);
      const pts = pathAdapter.getPoints(p);
      const rot = pts.find((q) => q.id === 'rot:1')!;
      expect(pathAdapter.dragPoint(p, 'rot:1', rot, NO_MODS).d).toBe(d);
      for (const f of pts.filter((q) => q.role === 'flip')) {
        for (const h of pts.filter((q) => q.kind === 'parameter')) expect(dist(f, h)).toBeGreaterThan(1);
      }
    }
  });

  it('moving the endpoint keeps authored radii; flip ghosts toggle flags', () => {
    const p = path('M0 0 A5 3 0 0 1 80 0');
    applyPatch(p, pathAdapter.dragPoint(p, 'a1', { x: 90, y: 0 }, NO_MODS));
    expect(p.getAttribute('d')).toBe('M0 0 A5 3 0 0 1 90 0');
    // Radii scaled up to fit exactly: large and small arcs coincide, so only the sweep flip is distinct.
    const flips = pathAdapter.getPoints(p).filter((q) => q.role === 'flip');
    expect(flips.map((f) => f.id)).toEqual(['flip00:1']);
    applyPatch(p, pathAdapter.clickPoint!(p, 'flip00:1')!);
    expect(p.getAttribute('d')).toBe('M0 0 A5 3 0 0 0 90 0');
    // A non-degenerate arc offers all three alternatives.
    const q = path('M0 0 A50 50 0 0 1 80 0');
    expect(pathAdapter.getPoints(q).filter((x) => x.role === 'flip').map((f) => f.id).sort()).toEqual(['flip00:1', 'flip10:1', 'flip11:1']);
    applyPatch(q, pathAdapter.clickPoint!(q, 'flip10:1')!);
    expect(q.getAttribute('d')).toBe('M0 0 A50 50 0 1 0 80 0');
  });
});

describe('Path insertion and deletion', () => {
  const shapes = ['M0 0 C10 30 40 30 50 0', 'M0 0 Q25 40 50 0', 'M0 0 A25 25 0 0 1 50 0', 'M0 0 L50 0', 'M0 0 H50', 'M0 0 C0 20 20 20 20 0 S40 -20 40 0'];
  it('splitting a segment keeps the shape', () => {
    for (const d of shapes) {
      const { segs, tail } = parsePath(d);
      const after = serializePath({ segs: splitSegment(segs, 1), tail });
      expect(parsePath(after).segs.length, d).toBe(segs.length + 1);
      expect(hausdorff(d, after), d).toBeLessThan(0.5);
    }
  });

  it('S after a split segment is frozen to C so its shape is unchanged', () => {
    const d = 'M0 0 C0 20 20 20 20 0 S40 -20 40 0';
    const after = serializePath({ ...parsePath(d), segs: splitSegment(parsePath(d).segs, 1) });
    expect(after).toMatch(/C.*C.*C/);
    expect(hausdorff(after, d)).toBeLessThan(0.5);
  });

  it('closing segment ghost inserts L before Z', () => {
    const p = path('M0 0 L10 0 L10 10 Z');
    const m = pathAdapter.insertPoint!(p, 'm:3')!;
    expect(m.patch.d).toBe('M0 0 L10 0 L10 10 L5 5 Z');
    expect(m.pointId).toBe('a3');
  });

  it('S ghost materialises as C without changing the shape', () => {
    const d = 'M0 0 C0 20 20 20 20 0 S40 -20 40 0';
    const m = pathAdapter.insertPoint!(path(d), 'g1:2')!;
    expect(m.pointId).toBe('c1:2');
    expect(m.patch.d).toBe('M0 0 C0 20 20 20 20 0 C20 -20 40 -20 40 0');
  });

  it('deleting merges by neighbour type', () => {
    const t = (d: string, i: number) => serializePath({ segs: deleteAnchor(parsePath(d).segs, i)!, tail: '' });
    expect(t('M0 0 L10 0 H20', 1)).toBe('M0 0 L20 0');
    expect(t('M0 0 A10 10 0 0 0 10 10 A10 10 0 0 0 20 0', 1)).toBe('M0 0 A10 10 0 0 0 20 0');
    const c = t('M0 0 C0 10 10 20 20 20 C30 20 40 10 40 0', 1);
    expect(c).toMatch(/^M0 0 C/);
    expect(parsePath(c).segs.length).toBe(2);
    expect(hausdorff('M0 0 C0 10 10 20 20 20 C30 20 40 10 40 0', c)).toBeLessThan(2);
    expect(deleteAnchor(parsePath('M0 0 L10 0').segs, 1)).toBeNull();
  });

  it('dragging M also moves a coincident closing anchor', () => {
    const p = path('M0 0 L10 0 L10 10 L0 0 Z');
    applyPatch(p, pathAdapter.dragPoint(p, 'a0', { x: -5, y: 0 }, NO_MODS));
    expect(p.getAttribute('d')).toBe('M-5 0 L10 0 L10 10 L-5 0 Z');
  });
});

describe('Anchor node types', () => {
  it('smooth nodes keep handles collinear; Alt breaks smoothness', () => {
    const p = path('M0 0 C0 10 10 10 20 10 C30 10 40 0 40 0');
    // node at a1 is smooth & symmetric by geometry (handles (10,10) and (30,10) around (20,10))
    applyPatch(p, pathAdapter.dragPoint(p, 'c2:1', { x: 10, y: 0 }, NO_MODS));
    expect(p.getAttribute('d')).toBe('M0 0 C0 10 10 0 20 10 C30 20 40 0 40 0');
    applyPatch(p, pathAdapter.dragPoint(p, 'c2:1', { x: 15, y: 0 }, { ...NO_MODS, alt: true }));
    expect(p.getAttribute('d')).toBe('M0 0 C0 10 15 0 20 10 C30 20 40 0 40 0');
  });

  it('double-click cycles corner -> smooth -> symmetric', () => {
    const p = path('M0 0 C0 10 10 10 20 10 C20 20 40 0 40 0');
    applyPatch(p, pathAdapter.doubleClickPoint!(p, 'a1')!);
    expect(p.getAttribute('d')).toBe('M0 0 C0 10 10 10 20 10 C30 10 40 0 40 0');
    applyPatch(p, pathAdapter.doubleClickPoint!(p, 'a1')!);
    expect(p.getAttribute('d')).toBe('M0 0 C0 10 10 10 20 10 C30 10 40 0 40 0');
  });
});

describe('Node types next to S segments', () => {
  it('an anchor before S is symmetric; choosing corner converts S to C', () => {
    const d = 'M0 0 C0 10 10 10 20 10 S40 0 40 0';
    const p = path(d);
    const items = pathAdapter.pointMenu!(p, 'a1');
    expect(items.map((i) => `${i.label}${i.checked ? '*' : ''}`)).toEqual(['Node: corner', 'Node: smooth', 'Node: symmetric*']);
    applyPatch(p, items[0].run()!);
    expect(p.getAttribute('d')).toBe('M0 0 C0 10 10 10 20 10 C30 10 40 0 40 0');
  });
});
