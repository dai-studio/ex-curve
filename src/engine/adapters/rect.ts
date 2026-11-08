// Rect editor points (SubProcess_2).
import type { EditorPoint, ShapeAdapter } from '../model';
import { elementId } from '../model';
import { clamp, fmt, has, num } from '../num';
import { boxPoints, changed, dragBox, handlePos, isBoxHandle, readRect, rectAttrs, rectPatch } from './common';

/** Effective corner radii: SVG auto rule (a missing radius mirrors the other), clamped to half size. */
export function rectRadii(el: Element) {
  const r = readRect(el);
  const rxSet = has(el, 'rx'), rySet = has(el, 'ry');
  let rx = rxSet ? num(el, 'rx') : rySet ? num(el, 'ry') : 0;
  let ry = rySet ? num(el, 'ry') : rxSet ? num(el, 'rx') : 0;
  rx = clamp(rx, 0, r.width / 2);
  ry = clamp(ry, 0, r.height / 2);
  return { rx, ry };
}

export const rectAdapter: ShapeAdapter = {
  tagNames: ['rect'],
  geometryAttrs: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  hasOwnResize: () => true,

  getPoints(el) {
    const r = readRect(el);
    const { rx, ry } = rectRadii(el);
    const eid = elementId(el);
    const pts: EditorPoint[] = boxPoints(el, r, rectAttrs);
    pts.push(
      {
        id: 'rx', elementId: eid, kind: 'parameter', role: 'radius', x: r.x + r.width - rx, y: r.y,
        attr: ['rx', 'ry'], constraint: 'x-axis', screenOffset: rx === 0 ? { x: -14, y: 0 } : undefined,
      },
      {
        id: 'ry', elementId: eid, kind: 'parameter', role: 'radius', x: r.x + r.width, y: r.y + ry,
        attr: ['ry', 'rx'], constraint: 'y-axis', screenOffset: ry === 0 ? { x: 0, y: 14 } : undefined,
      },
    );
    return pts;
  },

  dragPoint(el, id, t, mods) {
    const r = readRect(el);
    if (isBoxHandle(id)) return rectPatch(el, dragBox(r, id, t, mods), rectAttrs(id));
    if (id === 'rx') {
      const v = clamp(r.x + r.width - t.x, 0, r.width / 2);
      return mods.alt ? changed(el, { rx: v, ry: Math.min(v, r.height / 2) }) : changed(el, { rx: v });
    }
    if (id === 'ry') {
      const v = clamp(t.y - r.y, 0, r.height / 2);
      return mods.alt ? changed(el, { ry: v, rx: Math.min(v, r.width / 2) }) : changed(el, { ry: v });
    }
    return {};
  },

  movePoints(el, ids, d) {
    // All corners selected -> translate; otherwise apply each handle in turn.
    if (CORNER_SET.every((c) => ids.includes(c))) return this.translate!(el, d)!;
    let r = readRect(el);
    for (const id of ids) {
      if (!isBoxHandle(id)) continue;
      const p = handlePos(r, id);
      r = dragBox(r, id, { x: p.x + d.x, y: p.y + d.y }, { shift: false, alt: false });
    }
    return rectPatch(el, r);
  },

  translate(el, d) {
    const r = readRect(el);
    return changed(el, { x: r.x + d.x, y: r.y + d.y });
  },

  getBBox: readRect,

  resize(el, _from, to) { return rectPatch(el, to); },

  segments(el) {
    const r = readRect(el);
    const c = [
      { x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height },
    ];
    return c.map((p, i) => [p, c[(i + 1) % 4]]);
  },

  toPath(el) {
    const { x, y, width: w, height: h } = readRect(el);
    const { rx, ry } = rectRadii(el);
    const f = fmt;
    if (!rx || !ry) return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
    const a = (dx: number, dy: number) => `A${f(rx)} ${f(ry)} 0 0 1 ${f(dx)} ${f(dy)}`;
    return `M${f(x + rx)} ${f(y)}H${f(x + w - rx)}${a(x + w, y + ry)}V${f(y + h - ry)}${a(x + w - rx, y + h)}`
      + `H${f(x + rx)}${a(x, y + h - ry)}V${f(y + ry)}${a(x + rx, y)}Z`;
  },
};

const CORNER_SET = ['nw', 'ne', 'se', 'sw'];
