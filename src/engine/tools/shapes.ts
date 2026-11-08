// src/engine/tools/shapes.ts
// Drag-to-create tools: rectangle, ellipse (circle with Shift), line, polygon and star.
// A drag shows a live preview element; release inserts it as one undo step. A click without
// a drag creates a default-sized shape at the click point.
import type { Modifiers, Vec } from '../model';
import { fmt } from '../num';
import type { Tool, ToolEvent, ToolHost, ToolId } from './types';

const DRAG_MIN_PX = 3;
const DEFAULT_SIZE_PX = 100;

/** Box from a drag: Shift = square, Alt = from centre. */
export function dragRect(a: Vec, b: Vec, mods: Pick<Modifiers, 'shift' | 'alt'>): { x: number; y: number; width: number; height: number } {
  let dx = b.x - a.x, dy = b.y - a.y;
  if (mods.shift) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  const x0 = mods.alt ? a.x - dx : a.x, y0 = mods.alt ? a.y - dy : a.y;
  const x1 = a.x + dx, y1 = a.y + dy;
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

/** Snap the direction a→b to 15° steps, keeping its length. */
export function snapAngle(a: Vec, b: Vec): Vec {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * (Math.PI / 12);
  return { x: a.x + len * Math.cos(ang), y: a.y + len * Math.sin(ang) };
}

/** Regular polygon (inner = 0) or star (inner > 0) vertices. `angle` is the first vertex direction. */
export function polygonPoints(c: Vec, r: number, n: number, angle: number, inner = 0): Vec[] {
  const out: Vec[] = [];
  const k = inner > 0 ? 2 * n : n;
  for (let i = 0; i < k; i++) {
    const rr = inner > 0 && i % 2 ? r * inner : r;
    const a = angle + (i * 2 * Math.PI) / k;
    out.push({ x: c.x + rr * Math.cos(a), y: c.y + rr * Math.sin(a) });
  }
  return out;
}

export const pointsAttr = (pts: Vec[]) => pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');

abstract class DragTool implements Tool {
  abstract readonly id: ToolId;
  readonly cursor = 'crosshair';
  protected start: Vec | null = null;
  protected startS: Vec | null = null;
  protected el: SVGElement | null = null;
  protected moved = false;

  constructor(protected host: ToolHost) {}

  /** Create the preview element. */
  protected abstract make(): SVGElement;
  /** Update the preview for a drag from `a` to `b`. */
  protected abstract update(el: SVGElement, a: Vec, b: Vec, mods: Modifiers): void;
  /** Shape for a plain click at `p` (default size). */
  protected clickShape(p: Vec, mods: Modifiers): void {
    const d = DEFAULT_SIZE_PX * this.host.unitsPerPx();
    this.update(this.el!, p, { x: p.x + d, y: p.y + d }, { ...mods, shift: true });
  }
  /** Last chance to swap the element (ellipse → circle). */
  protected finalize(el: SVGElement): SVGElement { return el; }
  protected abstract label: string;

  pointerDown(e: ToolEvent): void {
    this.start = e.p;
    this.startS = e.s;
    this.moved = false;
    this.el = this.make();
    this.host.attachPreview(this.el);
  }

  pointerMove(e: ToolEvent, dragging: boolean): void {
    if (!dragging || !this.start || !this.el || !this.startS) return;
    if (!this.moved && Math.hypot(e.s.x - this.startS.x, e.s.y - this.startS.y) < DRAG_MIN_PX) return;
    this.moved = true;
    this.update(this.el, this.start, e.p, e.mods);
  }

  pointerUp(e: ToolEvent): void {
    const el = this.el;
    if (!el || !this.start) return;
    if (!this.moved) this.clickShape(this.start, e.mods);
    this.host.detachPreview(el);
    const out = this.finalize(el);
    this.reset();
    this.host.commit(out, this.label);
  }

  cancel(): void {
    if (this.el) this.host.detachPreview(this.el);
    this.reset();
  }

  private reset(): void { this.el = null; this.start = null; this.startS = null; this.moved = false; }
}

export class RectTool extends DragTool {
  readonly id = 'rect' as const;
  protected label = 'Draw rectangle';
  protected make() { return this.host.create('rect', { x: 0, y: 0, width: 0, height: 0 }, 'shape'); }
  protected update(el: SVGElement, a: Vec, b: Vec, mods: Modifiers) {
    const r = dragRect(a, b, mods);
    el.setAttribute('x', fmt(r.x)); el.setAttribute('y', fmt(r.y));
    el.setAttribute('width', fmt(r.width)); el.setAttribute('height', fmt(r.height));
  }
}

export class EllipseTool extends DragTool {
  readonly id = 'ellipse' as const;
  protected label = 'Draw ellipse';
  protected make() { return this.host.create('ellipse', { cx: 0, cy: 0, rx: 0, ry: 0 }, 'shape'); }
  protected update(el: SVGElement, a: Vec, b: Vec, mods: Modifiers) {
    const r = dragRect(a, b, mods);
    el.setAttribute('cx', fmt(r.x + r.width / 2)); el.setAttribute('cy', fmt(r.y + r.height / 2));
    el.setAttribute('rx', fmt(r.width / 2)); el.setAttribute('ry', fmt(r.height / 2));
  }
  /** Round ellipses are written as <circle>, keeping the attribute order cx, cy, r. */
  protected finalize(el: SVGElement): SVGElement {
    const rx = el.getAttribute('rx'), ry = el.getAttribute('ry');
    if (rx !== ry) return el;
    const c = this.host.create('circle', {}, null);
    for (const a of Array.from(el.attributes)) {
      if (a.name === 'rx') c.setAttribute('r', a.value);
      else if (a.name !== 'ry') c.setAttribute(a.name, a.value);
    }
    return c;
  }
}

export class LineTool extends DragTool {
  readonly id = 'line' as const;
  protected label = 'Draw line';
  protected make() { return this.host.create('line', { x1: 0, y1: 0, x2: 0, y2: 0 }, 'stroke'); }
  protected update(el: SVGElement, a: Vec, b: Vec, mods: Modifiers) {
    const e = mods.shift ? snapAngle(a, b) : b;
    const s = mods.alt ? { x: 2 * a.x - e.x, y: 2 * a.y - e.y } : a;
    el.setAttribute('x1', fmt(s.x)); el.setAttribute('y1', fmt(s.y));
    el.setAttribute('x2', fmt(e.x)); el.setAttribute('y2', fmt(e.y));
  }
  protected clickShape(p: Vec, mods: Modifiers) {
    const d = DEFAULT_SIZE_PX * this.host.unitsPerPx();
    this.update(this.el!, p, { x: p.x + d, y: p.y }, mods);
  }
}

/** Polygon and star: drag from the centre; the pointer sets radius and rotation (Shift: 15° steps). */
export class PolygonTool extends DragTool {
  readonly id: 'polygon' | 'star';
  protected label: string;
  constructor(host: ToolHost, readonly star: boolean) {
    super(host);
    this.id = star ? 'star' : 'polygon';
    this.label = star ? 'Draw star' : 'Draw polygon';
  }
  protected make() { return this.host.create('polygon', { points: '' }, 'shape'); }
  protected update(el: SVGElement, c: Vec, b: Vec, mods: Modifiers) {
    const e = mods.shift ? snapAngle(c, b) : b;
    const r = Math.hypot(e.x - c.x, e.y - c.y);
    const ang = r ? Math.atan2(e.y - c.y, e.x - c.x) : -Math.PI / 2;
    const o = this.host.options;
    const n = Math.max(3, Math.round(this.star ? o.starPoints : o.polygonSides));
    el.setAttribute('points', pointsAttr(polygonPoints(c, r, n, ang, this.star ? Math.min(0.95, Math.max(0.05, o.starInnerRatio)) : 0)));
  }
  protected clickShape(p: Vec, mods: Modifiers) {
    const d = (DEFAULT_SIZE_PX / 2) * this.host.unitsPerPx();
    this.update(this.el!, p, { x: p.x, y: p.y - d }, { ...mods, shift: false });
  }
}
