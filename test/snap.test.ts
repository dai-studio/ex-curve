import { boxCandidates, snapMove, snapPoint, type GridOpts } from '../src/engine/snap';
import type { Mat } from '../src/engine/geom';

const I: Mat = [1, 0, 0, 1, 0, 0];
// Document shown at 2× zoom, scrolled by (100, 50).
const S2: Mat = [2, 0, 0, 2, 100, 50];
const S2inv: Mat = [0.5, 0, 0, 0.5, -50, -25];
const grid = (size: number, toScreen = I, toDoc = I): GridOpts => ({ toScreen, toDoc, size });

describe('snapPoint', () => {
  it('prefers object targets within the radius over the grid', () => {
    expect(snapPoint({ x: 13, y: 13 }, [{ x: 15, y: 15 }], { grid: grid(10) })).toEqual({ p: { x: 15, y: 15 }, kind: 'object' });
  });
  it('falls back to the grid outside the radius', () => {
    expect(snapPoint({ x: 13, y: 26 }, [{ x: 40, y: 40 }], { grid: grid(10) })).toEqual({ p: { x: 10, y: 30 }, kind: 'grid' });
  });
  it('rounds to the grid in document space under zoom and scroll', () => {
    // screen (127, 77) → doc (13.5, 13.5) → grid 10 → doc (10, 10) → screen (120, 70)
    expect(snapPoint({ x: 127, y: 77 }, [], { grid: grid(10, S2, S2inv) })).toEqual({ p: { x: 120, y: 70 }, kind: 'grid' });
  });
  it('leaves the point alone with no grid and no target in range', () => {
    expect(snapPoint({ x: 3, y: 4 }, [{ x: 100, y: 100 }])).toEqual({ p: { x: 3, y: 4 }, kind: null });
  });
});

describe('snapMove', () => {
  const box = { x: 0, y: 0, width: 20, height: 10 };
  const cands = boxCandidates(box, I);

  it('builds 9 candidates, top-left first', () => {
    expect(cands).toHaveLength(9);
    expect(cands[0]).toEqual({ x: 0, y: 0 });
    expect(cands[4]).toEqual({ x: 10, y: 5 });
    expect(cands[8]).toEqual({ x: 20, y: 10 });
  });
  it('snaps the candidate nearest to a target', () => {
    // Moving by (48, 3): bottom-right lands at (68, 13), 2.24 px from (70, 12).
    const r = snapMove(cands, { x: 48, y: 3 }, [{ x: 70, y: 12 }, { x: 200, y: 200 }]);
    expect(r).toEqual({ dS: { x: 50, y: 2 }, mark: { x: 70, y: 12 }, kind: 'object' });
  });
  it('moves the top-left onto the grid when no target is in range', () => {
    const r = snapMove(boxCandidates({ x: 3, y: 4, width: 20, height: 10 }, I), { x: 14, y: 22 }, [], { grid: grid(10) });
    // top-left (3,4) + (14,22) = (17,26) → (20,30)
    expect(r.dS).toEqual({ x: 17, y: 26 });
    expect(r.kind).toBe('grid');
  });
  it('passes the delta through when nothing applies', () => {
    expect(snapMove(cands, { x: 7, y: 7 }, [])).toEqual({ dS: { x: 7, y: 7 }, mark: null, kind: null });
  });
});
