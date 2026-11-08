// src/engine/tools/pen.ts
// Pen tool: click = corner node, drag = smooth node (symmetric handles; Alt moves only the
// outgoing handle), click the first anchor to close, click the last anchor / Enter / Esc to
// finish an open path, Backspace removes the last node. Writes one <path> on finish.
import type { Vec } from '../model';
import { fmt } from '../num';
import type { Tool, ToolEvent, ToolHost } from './types';

const SVGNS = 'http://www.w3.org/2000/svg';
const CLOSE_RADIUS_PX = 8;

export interface PenNode { p: Vec; cin?: Vec; cout?: Vec }

const pt = (v: Vec) => `${fmt(v.x)} ${fmt(v.y)}`;
const same = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

function segment(a: PenNode, b: PenNode): string {
  if ((a.cout && !same(a.cout, a.p)) || (b.cin && !same(b.cin, b.p))) {
    return `C${pt(a.cout ?? a.p)} ${pt(b.cin ?? b.p)} ${pt(b.p)}`;
  }
  return `L${pt(b.p)}`;
}

/** Path data for a pen node list. A straight closing segment is left to Z. */
export function penPath(nodes: PenNode[], closed: boolean): string {
  if (!nodes.length) return '';
  let d = `M${pt(nodes[0].p)}`;
  for (let i = 1; i < nodes.length; i++) d += segment(nodes[i - 1], nodes[i]);
  if (closed && nodes.length > 1) {
    const close = segment(nodes[nodes.length - 1], nodes[0]);
    if (close.startsWith('C')) d += close;
    d += 'Z';
  }
  return d;
}

export class PenTool implements Tool {
  readonly id = 'pen' as const;
  readonly cursor = 'crosshair';
  private nodes: PenNode[] = [];
  private el: SVGElement | null = null;
  /** Node whose handles the current drag shapes. */
  private dragNode: PenNode | null = null;
  private closing = false;
  private hover: Vec | null = null;

  constructor(private host: ToolHost) {}

  busy(): boolean { return this.nodes.length > 0; }

  commitPending(): void { if (this.nodes.length) this.finish(false); }

  private nearScreen(p: Vec, s: Vec): boolean {
    const q = this.host.toScreen(p);
    return Math.hypot(q.x - s.x, q.y - s.y) <= CLOSE_RADIUS_PX;
  }

  pointerDown(e: ToolEvent): void {
    const n = this.nodes;
    if (n.length >= 2 && this.nearScreen(n[0].p, e.s)) {
      this.closing = true;
      this.dragNode = n[0];
      return;
    }
    if (n.length >= 2 && this.nearScreen(n[n.length - 1].p, e.s)) {
      this.finish(false);
      return;
    }
    const node: PenNode = { p: e.p };
    n.push(node);
    this.dragNode = node;
    if (!this.el) {
      this.el = this.host.create('path', { d: '' }, 'stroke');
      this.host.attachPreview(this.el);
    }
    this.update();
  }

  pointerMove(e: ToolEvent, dragging: boolean): void {
    this.hover = e.p;
    const node = this.dragNode;
    if (dragging && node) {
      const h = e.raw;
      const mirror = { x: 2 * node.p.x - h.x, y: 2 * node.p.y - h.y };
      if (this.closing) node.cin = mirror; // dragging on the first anchor shapes the closing curve
      else {
        node.cout = h;
        if (!e.mods.alt) node.cin = mirror;
      }
      this.update();
    }
    this.host.render();
  }

  pointerUp(): void {
    this.dragNode = null;
    if (this.closing) { this.closing = false; this.finish(true); }
  }

  keyDown(e: KeyboardEvent): boolean {
    if (!this.nodes.length) return false;
    if (e.key === 'Enter' || e.key === 'Escape') { this.finish(false); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      this.nodes.pop();
      if (!this.nodes.length) this.cancel(); else this.update();
      this.host.render();
      return true;
    }
    return false;
  }

  private update(): void {
    this.el?.setAttribute('d', penPath(this.nodes, false));
  }

  finish(closed: boolean): void {
    const el = this.el, nodes = this.nodes;
    this.reset();
    if (!el) return;
    this.host.detachPreview(el);
    if (nodes.length < 2) { this.host.render(); return; }
    // Closed paths get the shape style (fill), open ones keep the stroke style.
    const out = closed ? this.host.create('path', { d: penPath(nodes, true) }, 'shape') : el;
    if (!closed) out.setAttribute('d', penPath(nodes, false));
    this.host.commit(out, 'Draw path');
  }

  cancel(): void {
    if (this.el) this.host.detachPreview(this.el);
    this.reset();
  }

  private reset(): void {
    this.nodes = []; this.el = null; this.dragNode = null; this.closing = false;
  }

  overlay(layer: SVGGElement): void {
    const n = this.nodes;
    if (!n.length) return;
    const add = (tag: string, attrs: Record<string, string | number>) => {
      const e = document.createElementNS(SVGNS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      layer.appendChild(e);
      return e;
    };
    const S = (p: Vec) => this.host.toScreen(p);
    // Rubber band from the last node to the pointer.
    const last = n[n.length - 1];
    if (this.hover && !this.dragNode) {
      const a = S(last.p), c = S(last.cout ?? last.p), h = S(this.hover);
      add('path', { class: 'pen-rubber', d: `M${a.x} ${a.y}C${c.x} ${c.y} ${h.x} ${h.y} ${h.x} ${h.y}` });
    }
    // Handles of the last node (and the first one while closing).
    for (const node of new Set([last, this.closing ? n[0] : last])) {
      const a = S(node.p);
      for (const c of [node.cin, node.cout]) {
        if (!c) continue;
        const q = S(c);
        add('line', { class: 'tangent', x1: a.x, y1: a.y, x2: q.x, y2: q.y });
        add('circle', { class: 'pen-handle', cx: q.x, cy: q.y, r: 3 });
      }
    }
    n.forEach((node, i) => {
      const a = S(node.p);
      const closeHint = i === 0 && n.length >= 2 && this.hover && this.nearScreen(node.p, S(this.hover));
      add('rect', { class: `pen-anchor${closeHint ? ' close' : ''}`, x: a.x - 4, y: a.y - 4, width: 8, height: 8 });
    });
  }
}
