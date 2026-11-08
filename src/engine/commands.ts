// Explicit convert commands: Convert to path (Task_40) and Convert to ellipse (SubProcess_3).
// Rule: preserve id, style, transform and all non-geometry attributes in their original order.
import { adapterFor } from './adapters/registry';
import { fmt, num } from './num';

/**
 * Clone `el` as `tag`, replacing `geometry` attributes with `replacement` at the position of
 * the first geometry attribute. Children are moved over (none for basic shapes).
 */
export function replaceGeometry(el: Element, tag: string, geometry: string[], replacement: [string, string][]): Element {
  const out = el.ownerDocument.createElementNS(el.namespaceURI, tag);
  let inserted = false;
  for (const a of Array.from(el.attributes)) {
    if (geometry.includes(a.name)) {
      if (!inserted) { for (const [k, v] of replacement) out.setAttribute(k, v); inserted = true; }
      continue;
    }
    if (a.namespaceURI) out.setAttributeNS(a.namespaceURI, a.name, a.value);
    else out.setAttribute(a.name, a.value);
  }
  if (!inserted) for (const [k, v] of replacement) out.setAttribute(k, v);
  for (const c of Array.from(el.childNodes)) out.appendChild(c.cloneNode(true));
  return out;
}

export function canConvertToPath(el: Element): boolean {
  const a = adapterFor(el);
  return !!a?.toPath && !!a.geometryAttrs && el.localName !== 'path';
}

export function convertToPath(el: Element): Element | null {
  const a = adapterFor(el);
  if (!a?.toPath || !a.geometryAttrs || el.localName === 'path') return null;
  return replaceGeometry(el, 'path', a.geometryAttrs, [['d', a.toPath(el)]]);
}

export function convertToEllipse(el: Element): Element | null {
  if (el.localName !== 'circle') return null;
  const r = fmt(num(el, 'r'));
  // cx / cy stay as they are; r becomes rx = ry = r at r's position.
  return replaceGeometry(el, 'ellipse', ['r'], [['rx', r], ['ry', r]]);
}
