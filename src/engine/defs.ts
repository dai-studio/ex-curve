// src/engine/defs.ts
// Definitions: <symbol>s and everything in <defs> (gradients, patterns, markers, clip paths,
// masks, filters, reusable shapes), plus the references to them (url(#id), href="#id").
// Pure helpers used by the editor's definition-editing mode, the Layers "Definitions" section
// and "Go to definition".
import { matMul, parseTransform, type Mat } from './geom';

const I: Mat = [1, 0, 0, 1, 0, 0];
const URL_REF = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g;

/** Containers whose content never renders by itself. */
const DEF_CONTAINERS = 'defs, symbol, linearGradient, radialGradient, pattern, marker, clipPath, mask, filter';

export type DefKind = 'symbol' | 'gradient' | 'pattern' | 'marker' | 'clipPath' | 'mask' | 'filter' | 'style' | 'shape';

export function definitionKind(el: Element): DefKind {
  switch (el.localName) {
    case 'symbol': return 'symbol';
    case 'linearGradient': case 'radialGradient': return 'gradient';
    case 'pattern': return 'pattern';
    case 'marker': return 'marker';
    case 'clipPath': return 'clipPath';
    case 'mask': return 'mask';
    case 'filter': return 'filter';
    case 'style': return 'style';
    default: return 'shape';
  }
}

/** Definitions editable on the canvas through an instance: symbols and reusable shapes/groups. */
export const isCanvasDefinition = (el: Element) => definitionKind(el) === 'symbol' || definitionKind(el) === 'shape';

/** True when `el` lives inside something that never renders by itself (defs, symbol, gradient…). */
export function isDefinitionContent(el: Element): boolean {
  return !!el.closest(DEF_CONTAINERS);
}

/** All definitions in document order: children of every <defs>, plus <symbol>s outside <defs>. */
export function listDefinitions(doc: Element): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  for (const el of Array.from(doc.querySelectorAll('defs > *, symbol'))) {
    if (seen.has(el) || el.localName === 'title' || el.localName === 'desc') continue;
    // A symbol nested in another definition is listed with its parent.
    if (el.localName === 'symbol' && el.parentElement?.localName !== 'defs' && el.parentElement?.closest(DEF_CONTAINERS)) continue;
    seen.add(el);
    out.push(el);
  }
  return out;
}

const idOf = (v: string) => (v.startsWith('#') ? v.slice(1) : null);
const cssEscape = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

export function byId(doc: Element, id: string): Element | null {
  return doc.querySelector(`[id="${cssEscape(id)}"]`);
}

/** The element a <use> (or other href holder) points at. */
export function hrefTarget(doc: Element, el: Element): Element | null {
  const v = el.getAttribute('href') ?? el.getAttribute('xlink:href');
  const id = v ? idOf(v.trim()) : null;
  return id ? byId(doc, id) : null;
}

export interface Reference { id: string; attr: string }

/** Definitions an element references directly: url(#id) in any attribute (incl. style) and #id hrefs. */
export function referencesFrom(el: Element): Reference[] {
  const out: Reference[] = [];
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'href' || a.name === 'xlink:href') {
      const id = idOf(a.value.trim());
      if (id) out.push({ id, attr: a.name });
    } else if (a.value.includes('url(')) {
      for (const m of a.value.matchAll(URL_REF)) {
        // Inside style="", name the property rather than the attribute.
        const prop = a.name === 'style' ? (/([\w-]+)\s*:\s*[^;]*$/.exec(a.value.slice(0, m.index))?.[1] ?? 'style') : a.name;
        out.push({ id: m[1], attr: prop });
      }
    }
  }
  return out;
}

/** Elements that reference `id` (excluding inside the definition itself). */
export function usersOf(doc: Element, id: string): Element[] {
  const def = byId(doc, id);
  return Array.from(doc.querySelectorAll('*')).filter((el) => !(def && (def === el || def.contains(el))) && referencesFrom(el).some((r) => r.id === id));
}

// ---------------------------------------------------------------- instance geometry

export interface Box { x: number; y: number; width: number; height: number }

/** viewBox → viewport mapping (SVG preserveAspectRatio: align + meet/slice, or none). */
export function viewBoxMatrix(vb: Box, w: number, h: number, par = 'xMidYMid meet'): Mat {
  if (!(vb.width > 0 && vb.height > 0)) return I;
  const [align = 'xMidYMid', mode = 'meet'] = par.trim().split(/\s+/);
  let sx = w / vb.width, sy = h / vb.height;
  if (align !== 'none') {
    const s = mode === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = sy = s;
  }
  let tx = -vb.x * sx, ty = -vb.y * sy;
  if (align !== 'none') {
    const fx = align.includes('xMid') ? 0.5 : align.includes('xMax') ? 1 : 0;
    const fy = align.includes('YMid') ? 0.5 : align.includes('YMax') ? 1 : 0;
    tx += (w - vb.width * sx) * fx;
    ty += (h - vb.height * sy) * fy;
  }
  return [sx, 0, 0, sy, tx + 0, ty + 0]; // + 0 turns -0 into 0
}

const num = (el: Element, a: string): number | null => {
  const v = el.getAttribute(a);
  if (v === null || /%/.test(v)) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export function parseViewBox(el: Element): Box | null {
  const n = (el.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  return n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0 ? { x: n[0], y: n[1], width: n[2], height: n[3] } : null;
}

/**
 * Matrix from the referenced element's frame to the instance's local user space (before the
 * instance's own transform): translate(x, y), then for a <symbol> its viewBox fitted into the
 * instance's width × height (falling back to the symbol's own size, then its viewBox size).
 * With no instance, the definition is placed at the origin at its natural size.
 */
export function instanceMatrix(target: Element, use: Element | null): Mat {
  const x = use ? num(use, 'x') ?? 0 : 0, y = use ? num(use, 'y') ?? 0 : 0;
  let m: Mat = [1, 0, 0, 1, x, y];
  if (target.localName === 'symbol') {
    const vb = parseViewBox(target);
    if (vb) {
      const w = (use && num(use, 'width')) ?? num(target, 'width') ?? vb.width;
      const h = (use && num(use, 'height')) ?? num(target, 'height') ?? vb.height;
      m = matMul(m, viewBoxMatrix(vb, w, h, target.getAttribute('preserveAspectRatio') ?? undefined));
    }
  }
  return m;
}

/**
 * Product of transforms from the definition `target` down to `el` (inclusive). A <symbol>'s own
 * transform is not applied (its viewBox mapping is part of instanceMatrix).
 */
export function chainMatrix(target: Element, el: Element): Mat {
  const nodes: Element[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    nodes.unshift(n);
    if (n === target) break;
  }
  let m = I;
  for (const n of nodes) if (!(n === target && n.localName === 'symbol')) m = matMul(m, parseTransform(n.getAttribute('transform')));
  return m;
}

/**
 * Properties a <use> can't change because the definition's own elements set them: inherited
 * values only fill gaps, so a shape's own fill beats the instance's. Returns, per property, how
 * many elements in the definition set it (explicit `inherit` doesn't block). Nested <use>s are
 * not followed.
 */
export function blockedByDefinition(doc: Element, use: Element, props: string[], read: (el: Element, prop: string) => string | null): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(props.map((p) => [p, 0]));
  const target = hrefTarget(doc, use);
  if (!target) return out;
  const els = [...(target.localName === 'symbol' ? [] : [target]), ...Array.from(target.querySelectorAll('*'))];
  for (const el of els) {
    for (const p of props) {
      const v = read(el, p);
      if (v !== null && v.trim() !== 'inherit') out[p]++;
    }
  }
  return out;
}
