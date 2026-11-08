// Adapter registry (Task_52): tagName -> ShapeAdapter.
import type { ShapeAdapter } from '../model';
import { rectAdapter } from './rect';
import { circleAdapter, ellipseAdapter } from './circle';
import { lineAdapter } from './line';
import { polygonAdapter, polylineAdapter } from './poly';
import { pathAdapter } from './path';
import { boxAdapter, groupAdapter, textAdapter } from './other';

const registry = new Map<string, ShapeAdapter>();
for (const a of [rectAdapter, circleAdapter, ellipseAdapter, lineAdapter, polylineAdapter, polygonAdapter, pathAdapter, textAdapter, boxAdapter, groupAdapter]) {
  for (const t of a.tagNames) registry.set(t, a);
}

export function adapterFor(el: Element | null | undefined): ShapeAdapter | undefined {
  return el ? registry.get(el.localName) : undefined;
}

export const isGroup = (el: Element) => adapterFor(el) === groupAdapter;
