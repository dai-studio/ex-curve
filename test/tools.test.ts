import { dragRect, polygonPoints, snapAngle } from '../src/engine/tools/shapes';
import { penPath } from '../src/engine/tools/pen';
import { simplify, smoothPath } from '../src/engine/tools/pencil';

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe('dragRect', () => {
  it('normalises any drag direction', () => {
    expect(dragRect({ x: 10, y: 10 }, { x: 0, y: 4 }, { shift: false, alt: false })).toEqual({ x: 0, y: 4, width: 10, height: 6 });
  });
  it('Shift makes a square, Alt draws from the centre', () => {
    expect(dragRect({ x: 0, y: 0 }, { x: 10, y: 4 }, { shift: true, alt: false })).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(dragRect({ x: 50, y: 50 }, { x: 60, y: 55 }, { shift: false, alt: true })).toEqual({ x: 40, y: 45, width: 20, height: 10 });
  });
});

describe('snapAngle', () => {
  it('rounds to 15° steps and keeps the length', () => {
    const p = snapAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
    close(p.x, 10.04987562112089);
    close(p.y, 0);
    const q = snapAngle({ x: 0, y: 0 }, { x: 10, y: 9 });
    close(Math.atan2(q.y, q.x), Math.PI / 4);
  });
});

describe('polygonPoints', () => {
  it('regular polygon vertices lie on the radius', () => {
    const pts = polygonPoints({ x: 0, y: 0 }, 10, 6, 0);
    expect(pts).toHaveLength(6);
    for (const p of pts) close(Math.hypot(p.x, p.y), 10);
  });
  it('stars alternate outer and inner radius', () => {
    const pts = polygonPoints({ x: 0, y: 0 }, 10, 5, -Math.PI / 2, 0.5);
    expect(pts).toHaveLength(10);
    close(Math.hypot(pts[0].x, pts[0].y), 10);
    close(Math.hypot(pts[1].x, pts[1].y), 5);
  });
});

describe('penPath', () => {
  it('writes L for corners and C for smooth nodes', () => {
    expect(penPath([{ p: { x: 0, y: 0 } }, { p: { x: 10, y: 0 } }], false)).toBe('M0 0L10 0');
    const d = penPath([{ p: { x: 0, y: 0 }, cout: { x: 5, y: -5 } }, { p: { x: 10, y: 0 } }], false);
    expect(d).toBe('M0 0C5 -5 10 0 10 0');
  });
  it('closes with Z, adding a curve only when the closing segment is curved', () => {
    const tri = [{ p: { x: 0, y: 0 } }, { p: { x: 10, y: 0 } }, { p: { x: 5, y: 8 } }];
    expect(penPath(tri, true)).toBe('M0 0L10 0L5 8Z');
    const curved = [{ p: { x: 0, y: 0 }, cin: { x: -3, y: 3 } }, { p: { x: 10, y: 0 } }];
    expect(penPath(curved, true)).toBe('M0 0L10 0C10 0 -3 3 0 0Z');
  });
});

describe('pencil', () => {
  it('simplify drops collinear points but keeps corners', () => {
    const pts = [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 })).concat([{ x: 4, y: 4 }]);
    expect(simplify(pts, 0.1)).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }]);
  });
  it('smoothPath passes through every point', () => {
    const d = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }], false);
    expect(d.startsWith('M0 0C')).toBe(true);
    expect(d).toMatch(/ 10 10C/);
    expect(d.endsWith(' 20 0')).toBe(true);
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], true).endsWith('Z')).toBe(true);
  });
});
