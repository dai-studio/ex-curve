// src/engine/arrange.ts
// Arrange (M3): alignment and distribution maths, z-order planning and ungroup. Pure functions
// over boxes and elements; the Editor turns their results into history entries.
import type { Rect, Vec } from './model';
import { parseStyle } from './style';

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function unionRect(rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.width)), y1 = Math.max(...rs.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Translation for each box so it aligns to `edge` of `target`. */
export function alignDeltas(boxes: Rect[], edge: AlignEdge, target: Rect): Vec[] {
  return boxes.map((b) => {
    switch (edge) {
      case 'left': return { x: target.x - b.x, y: 0 };
      case 'center': return { x: target.x + target.width / 2 - (b.x + b.width / 2), y: 0 };
      case 'right': return { x: target.x + target.width - (b.x + b.width), y: 0 };
      case 'top': return { x: 0, y: target.y - b.y };
      case 'middle': return { x: 0, y: target.y + target.height / 2 - (b.y + b.height / 2) };
      case 'bottom': return { x: 0, y: target.y + target.height - (b.y + b.height) };
    }
  });
}

/**
 * Equal gaps between boxes along an axis, keeping the outermost boxes in place.
 * Boxes are ordered by their start edge; deltas are returned in the input order.
 */
export function distributeDeltas(boxes: Rect[], axis: 'x' | 'y'): Vec[] {
  const out: Vec[] = boxes.map(() => ({ x: 0, y: 0 }));
  if (boxes.length < 3) return out;
  const size = axis === 'x' ? 'width' : 'height';
  const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => p.b[axis] - q.b[axis] || p.i - q.i);
  const first = order[0].b, last = order.reduce((m, o) => (o.b[axis] + o.b[size] > m[axis] + m[size] ? o.b : m), order[0].b);
  const span = last[axis] + last[size] - first[axis];
  const total = order.reduce((s, o) => s + o.b[size], 0);
  const gap = (span - total) / (order.length - 1);
  let pos = first[axis];
  for (const { b, i } of order) {
    out[i] = axis === 'x' ? { x: pos - b.x, y: 0 } : { x: 0, y: pos - b.y };
    pos += b[size] + gap;
  }
  return out;
}

/** Element siblings only (whitespace and comments are ignored for z-order). */
const elementSiblings = (parent: Element) => Array.from(parent.children);

/**
 * Plan a z-order change for `els` (all children of one parent): returns, in order, the element to
 * move and the node to insert it before (null = append). Relative order of `els` is preserved.
 */
export function planZOrder(els: Element[], op: 'forward' | 'backward' | 'front' | 'back'): { el: Element; before: Node | null }[] {
  if (!els.length) return [];
  const parent = els[0].parentElement!;
  const sibs = elementSiblings(parent);
  const sel = new Set(els);
  const ordered = sibs.filter((e) => sel.has(e));
  const moves: { el: Element; before: Node | null }[] = [];
  if (op === 'front') {
    for (const el of ordered) moves.push({ el, before: null });
  } else if (op === 'back') {
    const firstUnselected = sibs.find((e) => !sel.has(e)) ?? null;
    for (const el of ordered) moves.push({ el, before: firstUnselected });
  } else if (op === 'forward') {
    // Each selected element jumps over the next unselected sibling (topmost first).
    const order = [...sibs];
    for (let i = order.length - 2; i >= 0; i--) {
      if (sel.has(order[i]) && !sel.has(order[i + 1])) {
        [order[i], order[i + 1]] = [order[i + 1], order[i]];
        const el = order[i + 1];
        moves.push({ el, before: order[i + 2] ?? null });
      }
    }
  } else {
    const order = [...sibs];
    for (let i = 1; i < order.length; i++) {
      if (sel.has(order[i]) && !sel.has(order[i - 1])) {
        [order[i - 1], order[i]] = [order[i], order[i - 1]];
        moves.push({ el: order[i - 1], before: order[i] });
      }
    }
  }
  return moves;
}

/** Inheritable presentation properties a group can pass down to its children. */
const INHERITED = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'font-family', 'font-size', 'font-style', 'font-weight',
  'text-anchor', 'color', 'visibility', 'cursor', 'letter-spacing', 'word-spacing', 'paint-order', 'clip-rule',
]);
/** Group attributes that are pure bookkeeping and can be dropped on ungroup. */
const DROPPABLE = new Set(['id', 'class', 'transform', 'style', 'data-name', 'inkscape:label', 'inkscape:groupmode']);

/** Why a group cannot be ungrouped without changing how it renders (null = fine). */
export function ungroupBlocker(g: Element): string | null {
  if (g.localName !== 'g') return `<${g.localName}> is not a plain group`;
  for (const a of Array.from(g.attributes)) {
    if (a.name.startsWith('xmlns') || DROPPABLE.has(a.name) || INHERITED.has(a.name) || a.name === 'opacity') continue;
    if (a.name.startsWith('data-') || a.name.startsWith('aria-')) continue;
    return `the group has ${a.name}`;
  }
  for (const d of parseStyle(g.getAttribute('style'))) {
    if (!INHERITED.has(d.prop) && d.prop !== 'opacity') return `the group style has ${d.prop}`;
  }
  return null;
}

/**
 * Copies of a group's children with the group's transform and inheritable presentation pushed
 * down: the transform is prepended, inherited properties are added where a child doesn't set them,
 * and group opacity multiplies into each child's opacity.
 */
export function ungroupChildren(g: Element): Element[] {
  const T = g.getAttribute('transform')?.trim();
  const groupStyle = new Map<string, string>();
  for (const a of Array.from(g.attributes)) if (INHERITED.has(a.name) || a.name === 'opacity') groupStyle.set(a.name, a.value);
  for (const d of parseStyle(g.getAttribute('style'))) groupStyle.set(d.prop, d.value);
  const out: Element[] = [];
  for (const child of Array.from(g.children)) {
    const c = child.cloneNode(true) as Element;
    if (T) { const ct = c.getAttribute('transform')?.trim(); c.setAttribute('transform', ct ? `${T} ${ct}` : T); }
    const childStyle = new Set(parseStyle(c.getAttribute('style')).map((d) => d.prop));
    for (const [k, v] of groupStyle) {
      if (k === 'opacity') {
        const mine = parseFloat(c.getAttribute('opacity') ?? '1');
        const val = (Number.isFinite(mine) ? mine : 1) * parseFloat(v);
        if (Number.isFinite(val) && val < 1) c.setAttribute('opacity', String(Math.round(val * 1000) / 1000));
        continue;
      }
      if (!c.hasAttribute(k) && !childStyle.has(k)) c.setAttribute(k, v);
    }
    out.push(c);
  }
  return out;
}
