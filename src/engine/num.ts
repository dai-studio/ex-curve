// Rule "Numeric precision": at most N decimals (configurable), trailing zeros trimmed.

export const settings = { precision: 3 };

export function fmt(n: number, precision = settings.precision): string {
  if (!Number.isFinite(n)) return '0';
  let s = n.toFixed(precision);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

export function num(el: Element, attr: string, fallback = 0): number {
  const v = el.getAttribute(attr);
  if (v == null || v.trim() === '') return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function has(el: Element, attr: string): boolean {
  const v = el.getAttribute(attr);
  return v != null && v.trim() !== '' && v.trim() !== 'auto';
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
