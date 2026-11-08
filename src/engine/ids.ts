// src/engine/ids.ts
// Element id helpers for duplicate and paste: copies must not clash with ids already in the
// document, and references inside the copy (url(#id), href="#id") must follow the renames.

export function collectIds(root: Element): Set<string> {
  const out = new Set<string>();
  if (root.id) out.add(root.id);
  for (const el of Array.from(root.querySelectorAll('[id]'))) out.add(el.id);
  return out;
}

export function freshId(id: string, taken: Set<string>): string {
  const base = id.replace(/-\d+$/, '') || 'id';
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

const URL_REF = /url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g;

/** Rewrite #id references in one attribute value; returns null when nothing changed. */
export function rewriteRefs(name: string, value: string, map: Map<string, string>): string | null {
  let out = value;
  if (name === 'href' || name === 'xlink:href') {
    const m = /^#(.+)$/.exec(value.trim());
    if (m && map.has(m[1])) out = `#${map.get(m[1])}`;
  } else if (value.includes('url(')) {
    out = value.replace(URL_REF, (all, q: string, id: string) => (map.has(id) ? `url(${q}#${map.get(id)}${q})` : all));
  }
  return out === value ? null : out;
}

/**
 * Rename ids in the given subtrees that clash with `taken` (which is updated), and rewrite the
 * references to them inside the same subtrees. Returns the rename map (old → new).
 */
export function uniquifyIds(roots: Element[], taken: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  const all = roots.flatMap((r) => [r, ...Array.from(r.querySelectorAll('*'))]);
  for (const el of all) {
    const id = el.getAttribute('id');
    if (!id) continue;
    if (taken.has(id) || map.has(id)) {
      const n = freshId(id, taken);
      map.set(id, n);
      el.setAttribute('id', n);
      taken.add(n);
    } else taken.add(id);
  }
  if (map.size) {
    for (const el of all) {
      for (const a of Array.from(el.attributes)) {
        const v = rewriteRefs(a.name, a.value, map);
        if (v !== null) a.value = v;
      }
    }
  }
  return map;
}
