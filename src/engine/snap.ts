// src/engine/snap.ts
// Snapping maths (Task_43), in screen (overlay) space so radii are screen-sized at any zoom.
// Object targets (anchors, segment midpoints, bbox points) within SNAP_RADIUS win; otherwise,
// when a grid is given, positions round to the grid in document user space.
import { dist, matApply, type Mat } from './geom';
import type { Vec } from './model';

export const SNAP_RADIUS = 6;

export type SnapKind = 'object' | 'grid';

export interface GridOpts {
  /** Document user space → screen. */
  toScreen: Mat;
  /** Screen → document user space. */
  toDoc: Mat;
  /** Grid spacing in document user units. */
  size: number;
}

export interface SnapOpts { grid?: GridOpts | null; radius?: number }

export interface SnapResult { p: Vec; kind: SnapKind | null }

/** Nearest object target within the radius. */
function nearest(s: Vec, targets: Vec[], radius: number): { t: Vec; d: number } | null {
  let best: { t: Vec; d: number } | null = null;
  for (const t of targets) {
    const d = dist(s, t);
    if (d <= radius && (!best || d < best.d)) best = { t, d };
  }
  return best;
}

export function snapToGrid(s: Vec, g: GridOpts): Vec {
  const p = matApply(g.toDoc, s);
  return matApply(g.toScreen, { x: Math.round(p.x / g.size) * g.size, y: Math.round(p.y / g.size) * g.size });
}

/** Snap one screen point: object targets first, then the grid. */
export function snapPoint(s: Vec, targets: Vec[], opts: SnapOpts = {}): SnapResult {
  const hit = nearest(s, targets, opts.radius ?? SNAP_RADIUS);
  if (hit) return { p: hit.t, kind: 'object' };
  if (opts.grid && opts.grid.size > 0) return { p: snapToGrid(s, opts.grid), kind: 'grid' };
  return { p: s, kind: null };
}

export interface MoveSnap { dS: Vec; mark: Vec | null; kind: SnapKind | null }

/**
 * Snap a move of a selection by `dS`. `candidates` are the selection's reference points at drag
 * start (box corners, edge midpoints, centre; the first is the top-left). The candidate that lands
 * closest to an object target wins; otherwise the top-left is put on the grid, so the selection
 * moves in grid steps.
 */
export function snapMove(candidates: Vec[], dS: Vec, targets: Vec[], opts: SnapOpts = {}): MoveSnap {
  const radius = opts.radius ?? SNAP_RADIUS;
  let best: { c: Vec; t: Vec; d: number } | null = null;
  for (const c of candidates) {
    const moved = { x: c.x + dS.x, y: c.y + dS.y };
    const hit = nearest(moved, targets, radius);
    if (hit && (!best || hit.d < best.d)) best = { c, t: hit.t, d: hit.d };
  }
  if (best) return { dS: { x: best.t.x - best.c.x, y: best.t.y - best.c.y }, mark: best.t, kind: 'object' };
  if (opts.grid && opts.grid.size > 0 && candidates.length) {
    const c = candidates[0];
    const g = snapToGrid({ x: c.x + dS.x, y: c.y + dS.y }, opts.grid);
    return { dS: { x: g.x - c.x, y: g.y - c.y }, mark: g, kind: 'grid' };
  }
  return { dS, mark: null, kind: null };
}

/** The 9 reference points of a box (top-left first), mapped to screen by `M`. */
export function boxCandidates(box: { x: number; y: number; width: number; height: number }, M: Mat): Vec[] {
  const out: Vec[] = [];
  for (const fy of [0, 0.5, 1]) for (const fx of [0, 0.5, 1]) out.push(matApply(M, { x: box.x + box.width * fx, y: box.y + box.height * fy }));
  return out;
}
