// src/app/fonts.ts
// Font families for the font picker: CSS font-family list parsing/formatting, the fonts a
// document uses, and installed fonts — from the host (DAI Studio desktop: host.listFonts) or the
// Local Font Access API (Chromium: window.queryLocalFonts, which needs a click and a permission).

export const GENERIC_FAMILIES = ['sans-serif', 'serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'ui-rounded'];
const GENERIC = new Set([...GENERIC_FAMILIES, 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'math', 'emoji', 'fangsong']);

export const isGeneric = (family: string) => GENERIC.has(family.toLowerCase());

/** Split a font-family value into unquoted family names. */
export function parseFamilies(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  const re = /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^,]+))\s*(?:,|$)/g;
  for (const m of value.matchAll(re)) {
    const name = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1').trim().replace(/\s+/g, ' ');
    if (name) out.push(name);
    if (m.index + m[0].length >= value.length) break;
  }
  return out;
}

/** Quote a family name for CSS when it isn't a plain identifier sequence (or is a generic keyword used as a name). */
export function quoteFamily(name: string): string {
  if (isGeneric(name)) return name;
  return /^[A-Za-z_][\w-]*( [A-Za-z_][\w-]*)*$/.test(name) && !/\d/.test(name.split(' ').map((w) => w[0]).join(''))
    ? name
    : `"${name.replace(/(["\\])/g, '\\$1')}"`;
}

export function formatFamilies(names: string[]): string {
  return names.map(quoteFamily).join(', ');
}

/** The family shown for a value: its first family. */
export const primaryFamily = (value: string | null | undefined) => parseFamilies(value)[0] ?? '';

/**
 * The value after picking `family`: the picked family first, keeping the current value's generic
 * fallback (e.g. "Georgia, serif" + pick "Inter" → "Inter, serif"). Picking a generic replaces all.
 */
export function withFamily(current: string | null | undefined, family: string): string {
  if (isGeneric(family)) return family;
  const fallback = parseFamilies(current).find(isGeneric);
  return formatFamilies(fallback ? [family, fallback] : [family]);
}

/** Families used anywhere in a document (font-family attributes and style declarations), first-seen order. */
export function documentFamilies(root: Element): string[] {
  const seen = new Map<string, string>();
  const add = (v: string | null) => { for (const f of parseFamilies(v)) if (!seen.has(f.toLowerCase())) seen.set(f.toLowerCase(), f); };
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    add(el.getAttribute('font-family'));
    const style = el.getAttribute('style');
    if (style) for (const m of style.matchAll(/font-family\s*:\s*([^;]+)/gi)) add(m[1]);
    if (el.localName === 'style' && el.textContent) for (const m of el.textContent.matchAll(/font-family\s*:\s*([^;}]+)/gi)) add(m[1]);
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------- installed fonts

interface LocalFontData { family: string }
type QueryLocalFonts = () => Promise<LocalFontData[]>;

export const canQueryLocalFonts = () => typeof window !== 'undefined' && typeof (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts === 'function';

let installed: string[] | null = null;
let pending: Promise<string[]> | null = null;

/** Installed families loaded so far in this session (null = not loaded yet). */
export const installedFamilies = () => installed;

/**
 * Load installed families. Uses the host's list when given, else queryLocalFonts (call this from a
 * click: the browser asks for permission). Throws with a readable message when refused/unsupported.
 */
export async function loadInstalledFamilies(hostList?: () => Promise<string[]>): Promise<string[]> {
  if (installed) return installed;
  pending ??= (async () => {
    let names: string[];
    if (hostList) names = await hostList();
    else if (canQueryLocalFonts()) {
      try {
        const fonts = await (window as unknown as { queryLocalFonts: QueryLocalFonts }).queryLocalFonts();
        names = fonts.map((f) => f.family);
      } catch (e) {
        const n = (e as Error)?.name;
        throw new Error(n === 'NotAllowedError' || n === 'SecurityError' ? 'Permission to read installed fonts was denied.' : (e as Error)?.message || 'Could not read installed fonts.');
      }
    } else throw new Error('This browser can’t list installed fonts.');
    installed = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return installed;
  })().finally(() => { pending = null; });
  return pending;
}

/** Test hook: forget loaded fonts. */
export function resetInstalledFamilies(): void { installed = null; pending = null; }
