import { describe, expect, it } from 'vitest';
import { NO_MODS, type AttrPatch, type Modifiers } from '../src/model';
import { adapterFor } from '../src/adapters/registry';
import { applyPatch, History, snapshot } from '../src/history';
import { convertToEllipse, convertToPath } from '../src/commands';
import { dist } from '../src/geom';

const NS = 'http://www.w3.org/2000/svg';
function el(tag: string, attrs: Record<string, string | number>): Element {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
const mods = (m: Partial<Modifiers> = {}): Modifiers => ({ ...NO_MODS, ...m });

/** Drag a point by delta and apply; asserts the rule "Write native attributes". */
function drag(e: Element, id: string, dx: number, dy: number, m: Partial<Modifiers> = {}): AttrPatch {
  const a = adapterFor(e)!;
  const p = a.getPoints(e).find((q) => q.id === id)!;
  expect(p, `point ${id}`).toBeTruthy();
  const patch = a.dragPoint(e, id, { x: p.x + dx, y: p.y + dy }, mods(m));
  for (const k of Object.keys(patch)) expect(p.attr, `${id} wrote ${k}`).toContain(k);
  applyPatch(e, patch);
  return patch;
}

const roundTrip = (e: Element) => {
  const s = new XMLSerializer().serializeToString(e);
  return new DOMParser().parseFromString(s, 'image/svg+xml').documentElement;
};

describe('Rect editor points', () => {
  it('exposes 10 handles and each writes only its attributes (round-trip)', () => {
    const ids = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rx', 'ry'];
    expect(adapterFor(el('rect', {}))!.getPoints(el('rect', { width: 10, height: 10 })).map((p) => p.id).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const r = el('rect', { x: 10, y: 20, width: 100, height: 50, rx: 5, fill: 'red' });
      drag(r, id, 7, 3);
      expect(r.getAttribute('fill')).toBe('red');
      const back = roundTrip(r);
      for (const a of Array.from(r.attributes)) expect(back.getAttribute(a.name)).toBe(a.value);
    }
  });

  it('edge handle writes a single axis', () => {
    const r = el('rect', { x: 0, y: 0, width: 100, height: 50 });
    expect(drag(r, 'e', 10, 30)).toEqual({ width: '110' });
  });

  it('dragging past the opposite edge flips x and keeps width positive', () => {
    const r = el('rect', { x: 0, y: 0, width: 100, height: 50 });
    drag(r, 'e', -150, 0);
    expect([r.getAttribute('x'), r.getAttribute('width')]).toEqual(['-50', '50']);
  });

  it('Shift keeps aspect ratio and Alt resizes from the centre', () => {
    const r = el('rect', { x: 0, y: 0, width: 100, height: 50 });
    drag(r, 'se', 100, 0, { shift: true });
    expect([r.getAttribute('width'), r.getAttribute('height')]).toEqual(['200', '100']);
    const c = el('rect', { x: 0, y: 0, width: 100, height: 50 });
    drag(c, 'se', 10, 10, { alt: true });
    expect([c.getAttribute('x'), c.getAttribute('y'), c.getAttribute('width'), c.getAttribute('height')]).toEqual(['-10', '-10', '120', '70']);
  });

  it('clamps corner radius, mirrors rx onto ry, and Alt sets rx = ry', () => {
    const r = el('rect', { x: 0, y: 0, width: 100, height: 40, rx: 10 });
    const ry = adapterFor(r)!.getPoints(r).find((p) => p.id === 'ry')!;
    expect(ry.y).toBe(10); // auto rule: ry mirrors rx
    drag(r, 'rx', -500, 0);
    expect(r.getAttribute('rx')).toBe('50');
    expect(r.hasAttribute('ry')).toBe(false);
    drag(r, 'ry', 0, 5, { alt: true });
    expect([r.getAttribute('rx'), r.getAttribute('ry')]).toEqual(['20', '20']);
  });
});

describe('Circle and ellipse', () => {
  it('radius handle keeps the centre and sets r = pointer distance', () => {
    const c = el('circle', { cx: 50, cy: 50, r: 10 });
    const p = drag(c, 'r0', 20, 30);
    expect(Object.keys(p)).toEqual(['r']);
    expect(Number(c.getAttribute('r'))).toBeCloseTo(Math.hypot(30, 30), 2);
  });

  it('r = 0 offsets collapsed handles in screen space', () => {
    const pts = adapterFor(el('circle', {}))!.getPoints(el('circle', { cx: 0, cy: 0, r: 0 }));
    expect(pts.filter((p) => p.screenOffset).length).toBe(4);
  });

  it('ellipse rx handle ignores vertical movement', () => {
    const e = el('ellipse', { cx: 0, cy: 0, rx: 20, ry: 10 });
    drag(e, 'rx-e', 5, 40);
    expect([e.getAttribute('rx'), e.getAttribute('ry'), e.getAttribute('cy')]).toEqual(['25', '10', '0']);
    drag(e, 'rx-e', 25, 0, { shift: true });
    expect([e.getAttribute('rx'), e.getAttribute('ry')]).toEqual(['50', '20']);
  });
});

describe('Line', () => {
  it('Shift snaps the endpoint angle to 15 degrees', () => {
    const l = el('line', { x1: 0, y1: 0, x2: 100, y2: 0 });
    drag(l, 'p2', -20, 37, { shift: true });
    const a = (Math.atan2(Number(l.getAttribute('y2')), Number(l.getAttribute('x2'))) * 180) / Math.PI;
    expect(Math.abs(a / 15 - Math.round(a / 15))).toBeLessThan(1e-3);
  });

  it('midpoint move handle translates the whole line', () => {
    const l = el('line', { x1: 0, y1: 0, x2: 10, y2: 0 });
    drag(l, 'mid', 5, 5);
    expect(['x1', 'y1', 'x2', 'y2'].map((k) => l.getAttribute(k))).toEqual(['5', '5', '15', '5']);
  });
});

describe('Polyline / polygon', () => {
  it('ghost insert adds a vertex at the right index; delete refuses below minimum', () => {
    const p = el('polyline', { points: '0,0 10,0 20,0' });
    const a = adapterFor(p)!;
    const m = a.insertPoint!(p, 'm1')!;
    expect(m.pointId).toBe('v2');
    applyPatch(p, m.patch);
    expect(p.getAttribute('points')).toBe('0,0 10,0 15,0 20,0');
    applyPatch(p, a.deletePoint!(p, ['v1'])!);
    applyPatch(p, a.deletePoint!(p, ['v1'])!);
    expect(p.getAttribute('points')).toBe('0,0 20,0');
    expect(a.deletePoint!(p, ['v0'])).toBeNull();
  });

  it('polygon closing ghost appends at the end', () => {
    const p = el('polygon', { points: '0,0 10,0 10,10' });
    const a = adapterFor(p)!;
    const m = a.insertPoint!(p, 'm2')!;
    applyPatch(p, m.patch);
    expect(p.getAttribute('points')).toBe('0,0 10,0 10,10 5,5');
    expect(m.pointId).toBe('v3');
    expect(a.deletePoint!(p, ['v0', 'v1'])).toBeNull();
  });
});

describe('Convert commands and history', () => {
  it('convert to path keeps non-geometry attributes in order', () => {
    const r = el('rect', { id: 'a', x: 0, y: 0, width: 10, height: 10, style: 'fill:red', transform: 'rotate(5)' });
    const p = convertToPath(r)!;
    expect(Array.from(p.attributes).map((a) => a.name)).toEqual(['id', 'd', 'style', 'transform']);
    expect(p.getAttribute('d')).toBe('M0 0H10V10H0Z');
  });

  it('convert to ellipse sets rx = ry = r', () => {
    const e = convertToEllipse(el('circle', { id: 'c', cx: 1, cy: 2, r: 3, fill: 'blue' }))!;
    expect(Array.from(e.attributes).map((a) => `${a.name}=${a.value}`)).toEqual(['id=c', 'cx=1', 'cy=2', 'rx=3', 'ry=3', 'fill=blue']);
  });

  it('undo/redo attribute patches and element replacement', () => {
    const svg = el('svg', {});
    const r = el('rect', { x: 0, y: 0, width: 10, height: 10 });
    svg.appendChild(r);
    const h = new History();
    const before = snapshot(r, ['width']);
    applyPatch(r, { width: '20' });
    h.pushAttr('drag', [{ el: r, before, after: { width: '20' } }]);
    const p = convertToPath(r)!;
    h.replace('convert', [[r, p]]);
    expect(svg.firstElementChild).toBe(p);
    h.undo();
    expect(svg.firstElementChild).toBe(r);
    h.undo();
    expect(r.getAttribute('width')).toBe('10');
    h.redo(); h.redo();
    expect(svg.firstElementChild).toBe(p);
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('Bounding box resize handles', () => {
  it('shapes with their own resize anchors opt out of box resize handles', () => {
    const own = (tag: string, a: Record<string, string | number> = {}) => !!adapterFor(el(tag, a))!.hasOwnResize?.(el(tag, a));
    expect(own('rect')).toBe(true);
    expect(own('image', { width: 10, height: 10 })).toBe(true);
    expect(own('use', { width: 10, height: 10 })).toBe(true);
    expect(own('use')).toBe(false);
    for (const t of ['circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'g']) expect(own(t), t).toBe(false);
  });
});
