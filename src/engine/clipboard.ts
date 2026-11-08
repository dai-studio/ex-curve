// src/engine/clipboard.ts
// Clipboard (M4). Copy writes a standalone SVG: the selected elements, the <defs> they reference
// (gradients, patterns, markers, clip paths, symbols…, followed transitively) and, when the
// selection sits inside transformed groups, a wrapper <g> with the accumulated transform, so the
// clip renders identically anywhere. Paste accepts Curve clips and SVG from other apps.
import type { Mat } from './geom';
import { matrixString } from './geom';
import { sanitize, type SanitizeReport } from './sanitize';

const SVGNS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
export const CLIP_ATTR = 'data-curve-clip';

const cssEscape = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

const REF = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g;

/** Ids referenced from an element subtree (url(#id) values and #id hrefs). */
export function referencedIds(roots: Element[]): Set<string> {
  const out = new Set<string>();
  for (const r of roots) {
    for (const el of [r, ...Array.from(r.querySelectorAll('*'))]) {
      for (const a of Array.from(el.attributes)) {
        if ((a.name === 'href' || a.name === 'xlink:href') && a.value.startsWith('#')) out.add(a.value.slice(1));
        else if (a.value.includes('url(')) for (const m of a.value.matchAll(REF)) out.add(m[1]);
      }
    }
  }
  return out;
}

const isIdentity = (m: Mat) => Math.abs(m[0] - 1) + Math.abs(m[1]) + Math.abs(m[2]) + Math.abs(m[3] - 1) + Math.abs(m[4]) + Math.abs(m[5]) < 1e-9;

/**
 * Serialise `els` as a standalone SVG clip. `toRoot` maps the elements' parent space to document
 * user space (null / identity = already at the root).
 */
export function buildClip(els: Element[], doc: Element, toRoot: Mat | null, docToken?: string): string {
  const out = document.createElementNS(SVGNS, 'svg');
  out.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xlink', XLINK);
  // The token identifies the source document, so pasting back into it reuses its definitions.
  out.setAttribute(CLIP_ATTR, docToken ?? '1');
  const vb = doc.getAttribute('viewBox');
  if (vb) out.setAttribute('viewBox', vb);
  for (const a of ['width', 'height']) { const v = doc.getAttribute(a); if (v) out.setAttribute(a, v); }

  // Referenced definitions, followed transitively, excluding ones inside the selection.
  const defs: Element[] = [];
  const seen = new Set<string>();
  let pending = referencedIds(els);
  while (pending.size) {
    const next = new Set<string>();
    for (const id of pending) {
      if (seen.has(id)) continue;
      seen.add(id);
      const def = doc.querySelector(`[id="${cssEscape(id)}"]`);
      if (!def || els.some((e) => e === def || e.contains(def))) continue;
      defs.push(def);
      for (const r of referencedIds([def])) next.add(r);
    }
    pending = next;
  }
  if (defs.length) {
    const d = document.createElementNS(SVGNS, 'defs');
    for (const def of defs) d.appendChild(def.cloneNode(true));
    out.appendChild(d);
  }
  let parent: Element = out;
  if (toRoot && !isIdentity(toRoot)) {
    parent = document.createElementNS(SVGNS, 'g');
    parent.setAttribute('transform', matrixString(toRoot));
    out.appendChild(parent);
  }
  for (const el of els) parent.appendChild(el.cloneNode(true));
  return new XMLSerializer().serializeToString(out);
}

export interface ParsedClip {
  /** Definitions to merge into the document's <defs> (also <style> elements). */
  defs: Element[];
  /** Content to insert. */
  content: Element[];
  /** Came from Curve: coordinates are document user space, paste in place. */
  curve: boolean;
  /** Token of the document the clip was copied from (Curve clips only). */
  docToken: string | null;
  /** For foreign SVG: transform mapping its viewBox to its width/height, if any. */
  transform: string | null;
  report: SanitizeReport;
}

const SKIP = new Set(['metadata', 'title', 'desc', 'namedview', 'script']);

/** Parse clipboard text as SVG; null when it isn't SVG. Content is sanitised. */
export function parseClip(text: string): ParsedClip | null {
  const t = text.trim();
  if (!/<svg[\s>]/i.test(t)) return null;
  const parsed = new DOMParser().parseFromString(t.slice(t.search(/<svg[\s>]/i)), 'image/svg+xml');
  const root = parsed.documentElement;
  if (parsed.getElementsByTagName('parsererror').length || root.localName !== 'svg') return null;
  const report = sanitize(root);
  const defs: Element[] = [], content: Element[] = [];
  for (const el of Array.from(root.children)) {
    if (el.localName === 'defs') defs.push(...Array.from(el.children));
    else if (el.localName === 'style') defs.push(el);
    else if (!SKIP.has(el.localName)) content.push(el);
  }
  const curve = root.hasAttribute(CLIP_ATTR);
  let transform: string | null = null;
  if (!curve) {
    const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
    const w = parseFloat(root.getAttribute('width') ?? ''), h = parseFloat(root.getAttribute('height') ?? '');
    if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
      const sx = Number.isFinite(w) && w > 0 ? w / vb[2] : 1, sy = Number.isFinite(h) && h > 0 ? h / vb[3] : sx;
      const s = Math.min(sx, sy); // preserveAspectRatio="xMidYMid meet" (the default)
      if (Math.abs(s - 1) > 1e-9 || vb[0] || vb[1]) transform = matrixString([s, 0, 0, s, -vb[0] * s, -vb[1] * s]);
    }
  }
  // Adopt into the current document so elements can be inserted directly.
  const adopt = (e: Element) => document.importNode(e, true) as Element;
  const docToken = curve ? root.getAttribute(CLIP_ATTR) : null;
  return { defs: defs.map(adopt), content: content.map(adopt), curve, docToken, transform, report };
}

const markup = (el: Element) => (el as Element & { outerHTML: string }).outerHTML.replace(/\s+/g, ' ').trim();

/**
 * Decide which of a clip's definitions to insert. A definition whose id already exists in the
 * target document is reused (not duplicated) when pasting back into the same document, or when
 * the existing one is identical; a different definition with a clashing id is inserted (and later
 * renamed by uniquifyIds). References to reused ids are left pointing at the existing elements.
 */
export function planDefs(defs: Element[], doc: Element, sameDoc: boolean): { insert: Element[]; reused: string[] } {
  const insert: Element[] = [], reused: string[] = [];
  for (const d of defs) {
    const id = d.getAttribute('id');
    const existing = id ? doc.querySelector(`[id="${cssEscape(id)}"]`) : null;
    if (id && existing && (sameDoc || markup(existing) === markup(d))) reused.push(id);
    else insert.push(d);
  }
  return { insert, reused };
}
