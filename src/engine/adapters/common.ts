import type { AttrPatch, EditorPoint, Modifiers, Rect, Vec } from '../model';
import { elementId } from '../model';
import { fmt, num } from '../num';

export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const CORNERS: BoxHandle[] = ['nw', 'ne', 'se', 'sw'];
export const EDGES: BoxHandle[] = ['n', 'e', 's', 'w'];

export function handlePos(r: Rect, h: BoxHandle): Vec {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.width : r.x + r.width / 2;
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.height : r.y + r.height / 2;
  return { x, y };
}

/**
 * Resize box `r` by dragging handle `h` to `target`. Corners keep the opposite corner
 * fixed, edges resize one axis. Shift (corners) keeps aspect ratio, Alt resizes from the
 * centre. Dragging past the opposite edge flips, and the result is normalised (positive size).
 */
export function dragBox(r: Rect, h: BoxHandle, target: Vec, mods: Pick<Modifiers, 'shift' | 'alt'>): Rect {
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const hx = h.includes('w') ? -1 : h.includes('e') ? 1 : 0;
  const hy = h.includes('n') ? -1 : h.includes('s') ? 1 : 0;
  // Fixed point: centre (alt) or opposite side.
  const fx = mods.alt ? cx : hx < 0 ? r.x + r.width : r.x;
  const fy = mods.alt ? cy : hy < 0 ? r.y + r.height : r.y;
  let dx = target.x - fx, dy = target.y - fy;
  const baseW = mods.alt ? r.width / 2 : r.width, baseH = mods.alt ? r.height / 2 : r.height;
  if (mods.shift && hx && hy && baseW && baseH) {
    const s = Math.max(Math.abs(dx) / baseW, Math.abs(dy) / baseH);
    dx = Math.sign(dx || hx) * s * baseW;
    dy = Math.sign(dy || hy) * s * baseH;
  }
  let x0 = r.x, x1 = r.x + r.width, y0 = r.y, y1 = r.y + r.height;
  if (hx) { if (mods.alt) { x0 = cx - dx; x1 = cx + dx; } else { x0 = fx; x1 = fx + dx; } }
  if (hy) { if (mods.alt) { y0 = cy - dy; y1 = cy + dy; } else { y0 = fy; y1 = fy + dy; } }
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

export function boxPoints(el: Element, r: Rect, attrsFor: (h: BoxHandle) => string[], corners = true, edges = true): EditorPoint[] {
  const out: EditorPoint[] = [];
  const eid = elementId(el);
  for (const h of [...(corners ? CORNERS : []), ...(edges ? EDGES : [])]) {
    const p = handlePos(r, h);
    const isEdge = h.length === 1;
    out.push({
      id: h, elementId: eid, kind: 'anchor', role: isEdge ? 'edge' : 'corner', x: p.x, y: p.y, attr: attrsFor(h),
      constraint: !isEdge ? 'none' : h === 'n' || h === 's' ? 'y-axis' : 'x-axis',
    });
  }
  return out;
}

/** Attributes written by a box handle on an x/y/width/height element. */
export function rectAttrs(h: BoxHandle): string[] {
  if (h === 'n' || h === 's') return ['y', 'height'];
  if (h === 'e' || h === 'w') return ['x', 'width'];
  return ['x', 'y', 'width', 'height'];
}

/** Build a patch, dropping values that are numerically unchanged (keeps diffs minimal). */
export function changed(el: Element, values: Record<string, number | string | null>): AttrPatch {
  const out: AttrPatch = {};
  for (const [k, val] of Object.entries(values)) {
    const cur = el.getAttribute(k);
    if (val === null) { if (cur !== null) out[k] = null; continue; }
    if (typeof val === 'string') { if (cur !== val) out[k] = val; continue; }
    if (cur !== null && cur.trim() !== '' && Math.abs(parseFloat(cur) - val) < 1e-9 && !/[\s,]/.test(cur.trim())) continue;
    out[k] = fmt(val);
  }
  return out;
}

export function readRect(el: Element): Rect {
  return { x: num(el, 'x'), y: num(el, 'y'), width: num(el, 'width'), height: num(el, 'height') };
}

export function rectPatch(el: Element, r: Rect, only?: string[]): AttrPatch {
  const all: Record<string, number> = { x: r.x, y: r.y, width: r.width, height: r.height };
  if (only) for (const k of Object.keys(all)) if (!only.includes(k)) delete all[k];
  return changed(el, all);
}

export function domBBox(el: Element): Rect {
  try {
    const b = (el as SVGGraphicsElement).getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

export function isBoxHandle(id: string): id is BoxHandle {
  return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].includes(id);
}
