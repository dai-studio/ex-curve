// src/engine/sanitize.ts
// Import safety (M4). Documents render inline in the app's DOM, so everything that enters the
// editor (open, paste, drop) passes through here first. Removed: script-capable elements,
// on* event handlers, javascript:/vbscript:/data:text/html URLs, animations that rewrite links or
// handlers, and @import rules in <style>. Geometry, styles, images and gradients are untouched.

/** Elements that can run code or pull in active documents. */
const BLOCKED = new Set(['script', 'iframe', 'object', 'embed', 'frame', 'frameset', 'applet', 'base', 'meta', 'link', 'portal', 'handler', 'listener']);
const URL_ATTRS = new Set(['href', 'xlink:href', 'src', 'action', 'formaction', 'data', 'from', 'to', 'values', 'by']);
const DANGEROUS_URL = /^\s*(javascript|vbscript|data\s*:\s*text\/html|data\s*:\s*application\/(x-)?(javascript|ecmascript))\s*:?/i;

export interface SanitizeReport {
  removedElements: Record<string, number>;
  removedAttributes: number;
  removedImports: number;
}

export const emptyReport = (): SanitizeReport => ({ removedElements: {}, removedAttributes: 0, removedImports: 0 });

/** Strip unsafe content from `root` (in place) and report what was removed. */
export function sanitize(root: Element, report: SanitizeReport = emptyReport()): SanitizeReport {
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    if (el !== root && !root.contains(el)) continue; // inside an already-removed subtree
    const name = el.localName.toLowerCase();
    const isAnim = name === 'set' || name === 'animate' || name === 'animatetransform' || name === 'animatemotion';
    const target = isAnim ? (el.getAttribute('attributeName') ?? '').toLowerCase() : '';
    if (el !== root && (BLOCKED.has(name) || (isAnim && (target === 'href' || target === 'xlink:href' || target.startsWith('on'))))) {
      report.removedElements[name] = (report.removedElements[name] ?? 0) + 1;
      el.remove();
      continue;
    }
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || (URL_ATTRS.has(n) && DANGEROUS_URL.test(a.value))) {
        el.removeAttributeNode(a);
        report.removedAttributes++;
      }
    }
    if (name === 'style' && el.textContent && /@import/i.test(el.textContent)) {
      el.textContent = el.textContent.replace(/@import[^;]*;?/gi, () => { report.removedImports++; return ''; });
    }
  }
  return report;
}

/** One-line description for the status bar, or '' when nothing was removed. */
export function describeReport(r: SanitizeReport): string {
  const parts: string[] = [];
  for (const [name, n] of Object.entries(r.removedElements)) parts.push(`${n} <${name}>`);
  if (r.removedAttributes) parts.push(`${r.removedAttributes} unsafe attribute${r.removedAttributes > 1 ? 's' : ''}`);
  if (r.removedImports) parts.push(`${r.removedImports} @import`);
  return parts.length ? `Removed for safety: ${parts.join(', ')}.` : '';
}
