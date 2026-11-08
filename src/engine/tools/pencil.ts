// src/engine/tools/pencil.ts
// Pencil tool: freehand stroke, simplified with Ramer–Douglas–Peucker and smoothed into cubic
// Bézier segments (Catmull–Rom → Bézier). Ending near the start closes the path.
import type { Vec } from '../model';
import { fmt } from '../num';
import { distToSegment } from '../geom';
import type { Tool, ToolEvent, ToolHost } from './types';

const CLOSE_PX = 8;

/** Ramer–Douglas–Peucker polyline simplification. */
export function simplify(pts: Vec[], tol: number): Vec[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let idx = -1, max = tol;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i], pts[a], pts[b]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const pt = (v: Vec) => `${fmt(v.x)} ${fmt(v.y)}`;

/** Smooth path through `pts` (uniform Catmull–Rom converted to cubic Béziers). */
export function smoothPath(pts: Vec[], closed: boolean): string {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pt(pts[0])}`;
  if (pts.length === 2 && !closed) return `M${pt(pts[0])}L${pt(pts[1])}`;
  const n = pts.length;
  const at = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${pt(pts[0])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return closed ? d + 'Z' : d;
}

export class PencilTool implements Tool {
  readonly id = 'pencil' as const;
  readonly cursor = 'crosshair';
  private pts: Vec[] = [];
  private startS: Vec | null = null;
  private el: SVGElement | null = null;

  constructor(private host: ToolHost) {}

  pointerDown(e: ToolEvent): void {
    this.pts = [e.raw];
    this.startS = e.s;
    this.el = this.host.create('path', { d: `M${pt(e.raw)}` }, 'stroke');
    this.host.attachPreview(this.el);
  }

  pointerMove(e: ToolEvent, dragging: boolean): void {
    if (!dragging || !this.el) return;
    const last = this.pts[this.pts.length - 1];
    if (Math.hypot(e.raw.x - last.x, e.raw.y - last.y) < 0.5 * this.host.unitsPerPx()) return;
    this.pts.push(e.raw);
    this.el.setAttribute('d', `M${this.pts.map(pt).join('L')}`);
  }

  pointerUp(e: ToolEvent): void {
    const el = this.el, pts = this.pts;
    const closed = !!this.startS && pts.length > 4 && Math.hypot(e.s.x - this.startS.x, e.s.y - this.startS.y) <= CLOSE_PX;
    this.reset();
    if (!el) return;
    this.host.detachPreview(el);
    const simple = simplify(pts, this.host.options.pencilTolerance * this.host.unitsPerPx());
    if (closed && simple.length > 2) simple.pop(); // the closing segment returns to the start
    if (simple.length < 2) { this.host.render(); return; }
    const out = closed ? this.host.create('path', {}, 'shape') : el;
    out.setAttribute('d', smoothPath(simple, closed));
    this.host.commit(out, 'Draw freehand');
  }

  cancel(): void {
    if (this.el) this.host.detachPreview(this.el);
    this.reset();
  }

  private reset(): void { this.pts = []; this.el = null; this.startS = null; }
}
