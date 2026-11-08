// src/engine/style.ts
// Read and write SVG presentation properties (M2). Rule "Edit style where defined": a property is
// edited where the element already defines it (a declaration in style="" or a presentation
// attribute); otherwise a presentation attribute is written. Nothing is reordered: a style
// declaration keeps its position, other declarations are left byte-for-byte untouched.
import type { AttrPatch } from './model';

export const STYLE_PROPS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor',
] as const;
export type StyleProp = (typeof STYLE_PROPS)[number];

export interface Declaration { prop: string; value: string; important: boolean }

/** Parse a style attribute into declarations, in order. Comments are dropped. */
export function parseStyle(style: string | null): Declaration[] {
  if (!style) return [];
  const out: Declaration[] = [];
  for (const part of style.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    let value = part.slice(i + 1).trim();
    if (!prop || !value) continue;
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/\s*!\s*important$/i, '');
    out.push({ prop, value, important });
  }
  return out;
}

/**
 * Replace (or remove, when value is null) the declaration of `prop` inside a style string,
 * keeping all other text untouched. Returns null when `prop` is not declared.
 */
export function editStyleDeclaration(style: string, prop: string, value: string | null): string | null {
  // Match `prop : value` up to the next ; (values in SVG styles don't contain ';').
  const re = new RegExp(`(^|;)(\\s*)${prop.replace(/[-]/g, '\\-')}(\\s*:\\s*)([^;]*?)(\\s*!\\s*important)?(\\s*)(?=;|$)`, 'i');
  const m = re.exec(style);
  if (!m) return null;
  if (value === null) {
    // Drop the declaration and one adjacent separator.
    const start = m.index + m[1].length, end = m.index + m[0].length;
    let before = style.slice(0, start), after = style.slice(end);
    if (after.startsWith(';')) after = after.slice(1).replace(/^\s+/, before ? ' ' : '');
    else before = before.replace(/;\s*$/, '');
    return (before + after).trim();
  }
  return style.slice(0, m.index) + m[1] + m[2] + prop + m[3] + value + (m[5] ?? '') + m[6] + style.slice(m.index + m[0].length);
}

export type StyleSource = 'style' | 'attribute' | 'inherited';

export interface StyleValue {
  /** The value the element itself declares (style beats attribute), or null. */
  own: string | null;
  source: StyleSource;
  /** Computed value (inherited / default) when available. */
  computed: string | null;
}

export function readStyle(el: Element, prop: string): StyleValue {
  const decl = parseStyle(el.getAttribute('style')).filter((d) => d.prop === prop).pop();
  if (decl) return { own: decl.value, source: 'style', computed: computed(el, prop) };
  const attr = el.getAttribute(prop);
  if (attr !== null) return { own: attr, source: 'attribute', computed: computed(el, prop) };
  return { own: null, source: 'inherited', computed: computed(el, prop) };
}

function computed(el: Element, prop: string): string | null {
  try {
    if (!el.isConnected || typeof getComputedStyle !== 'function') return null;
    return getComputedStyle(el).getPropertyValue(prop).trim() || null;
  } catch {
    return null;
  }
}

/** Attribute patch setting `prop` to `value` (null removes it) following "edit where defined". */
export function stylePatch(el: Element, prop: string, value: string | null): AttrPatch {
  const style = el.getAttribute('style');
  const patch: AttrPatch = {};
  const inStyle = style !== null && parseStyle(style).some((d) => d.prop === prop);
  if (inStyle) {
    const next = editStyleDeclaration(style!, prop, value);
    if (next !== null && next !== style) patch.style = next === '' ? null : next;
    // A presentation attribute below a style declaration is dead; clear it when removing.
    if (value === null && el.hasAttribute(prop)) patch[prop] = null;
    return patch;
  }
  if (value === null) { if (el.hasAttribute(prop)) patch[prop] = null; return patch; }
  if (el.getAttribute(prop) !== value) patch[prop] = value;
  return patch;
}

// ---------------------------------------------------------------- colours

export type Paint =
  | { kind: 'none' }
  | { kind: 'color'; hex: string }
  | { kind: 'url'; ref: string }
  | { kind: 'current' }
  | { kind: 'other'; value: string };

let ctx: CanvasRenderingContext2D | null | undefined;

/** Normalise any CSS colour to #rrggbb (alpha is handled through *-opacity). */
export function toHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(v);
  if (m) return '#' + m[1].slice(0, 3).split('').map((c) => c + c).join('');
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) return '#' + m[1];
  m = /^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/.exec(v);
  if (m && !v.includes('%')) return '#' + [m[1], m[2], m[3]].map((n) => Math.round(Math.min(255, +n)).toString(16).padStart(2, '0')).join('');
  if (v === 'black') return '#000000';
  if (v === 'white') return '#ffffff';
  // Named / hsl / percentages: let the browser normalise.
  if (ctx === undefined) {
    try { ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null; } catch { ctx = null; }
  }
  if (!ctx) return null;
  ctx.fillStyle = '#010203';
  ctx.fillStyle = v;
  const out = String(ctx.fillStyle);
  if (out === '#010203' && v !== '#010203') return null;
  return out.startsWith('#') ? out : toHex(out);
}

export function parsePaint(value: string | null): Paint | null {
  if (value === null) return null;
  const v = value.trim();
  if (v === 'none' || v === 'transparent') return { kind: 'none' };
  if (/^currentcolor$/i.test(v)) return { kind: 'current' };
  const u = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(v);
  if (u) return { kind: 'url', ref: u[1] };
  const hex = toHex(v);
  return hex ? { kind: 'color', hex } : { kind: 'other', value: v };
}

/** Colours used in a document (fill, stroke, stop-color, flood-color), most frequent first. */
export function documentColors(root: Element, limit = 24): string[] {
  const counts = new Map<string, number>();
  const add = (v: string | null) => {
    if (!v) return;
    const p = parsePaint(v);
    if (p?.kind === 'color') counts.set(p.hex, (counts.get(p.hex) ?? 0) + 1);
  };
  const props = ['fill', 'stroke', 'stop-color', 'flood-color'];
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const p of props) add(el.getAttribute(p));
    for (const d of parseStyle(el.getAttribute('style'))) if (props.includes(d.prop)) add(d.value);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c);
}
