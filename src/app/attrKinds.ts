// src/app/attrKinds.ts
// Chooses the editor the Attributes tab shows for an attribute, from its name and current value.
// Rich editors only apply when the value fits them (e.g. a unit-less number); anything else
// falls back to plain text, so no attribute is ever uneditable.
import { parsePaint } from '../engine/style';

export type AttrKind =
  | { kind: 'number'; step: number; min?: number; max?: number }
  | { kind: 'color' }
  | { kind: 'enum'; options: string[] }
  | { kind: 'long' }
  | { kind: 'font' }
  | { kind: 'text' };

/** A plain number: no units, percentages or lists. */
export const PLAIN_NUMBER = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i;

const COLOR = new Set(['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color']);
const LONG = new Set(['d', 'points', 'transform', 'style', 'gradientTransform', 'patternTransform', 'values', 'keyTimes', 'keySplines', 'path']);
/** Ids and labels that look numeric but aren't quantities. */
const NOT_NUMERIC = new Set(['id', 'class', 'version', 'baseProfile', 'lang', 'xml:lang', 'tabindex']);
/** Sizes that can't be negative. */
const NON_NEGATIVE = new Set([
  'width', 'height', 'r', 'rx', 'ry', 'fr', 'stroke-width', 'stroke-miterlimit', 'font-size', 'markerWidth', 'markerHeight',
  'stdDeviation', 'pathLength', 'textLength',
]);

export const ENUMS: Record<string, string[]> = {
  'stroke-linecap': ['butt', 'round', 'square'],
  'stroke-linejoin': ['miter', 'round', 'bevel', 'miter-clip', 'arcs'],
  'fill-rule': ['nonzero', 'evenodd'],
  'clip-rule': ['nonzero', 'evenodd'],
  'text-anchor': ['start', 'middle', 'end'],
  'dominant-baseline': ['auto', 'alphabetic', 'middle', 'central', 'hanging', 'ideographic', 'mathematical', 'text-before-edge', 'text-after-edge'],
  'alignment-baseline': ['auto', 'baseline', 'middle', 'central', 'hanging', 'alphabetic', 'ideographic', 'mathematical'],
  'font-style': ['normal', 'italic', 'oblique'],
  'font-weight': ['normal', 'bold', 'bolder', 'lighter'],
  visibility: ['visible', 'hidden', 'collapse'],
  display: ['inline', 'block', 'none'],
  overflow: ['visible', 'hidden', 'auto', 'scroll'],
  'vector-effect': ['none', 'non-scaling-stroke'],
  'shape-rendering': ['auto', 'optimizeSpeed', 'crispEdges', 'geometricPrecision'],
  'text-rendering': ['auto', 'optimizeSpeed', 'optimizeLegibility', 'geometricPrecision'],
  'paint-order': ['normal', 'stroke', 'markers', 'fill markers stroke', 'stroke fill markers'],
  'mix-blend-mode': ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'difference', 'exclusion'],
  preserveAspectRatio: ['none', 'xMidYMid meet', 'xMidYMid slice', 'xMinYMin meet', 'xMaxYMax meet', 'xMinYMid meet', 'xMaxYMid meet'],
  gradientUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  patternUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  clipPathUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  maskUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  spreadMethod: ['pad', 'reflect', 'repeat'],
  'xml:space': ['default', 'preserve'],
};

export function attrKind(name: string, value: string): AttrKind {
  if (COLOR.has(name)) return { kind: 'color' };
  if (name === 'font-family') return { kind: 'font' };
  if (ENUMS[name] && !(name === 'font-weight' && PLAIN_NUMBER.test(value))) return { kind: 'enum', options: ENUMS[name] };
  if (LONG.has(name)) return { kind: 'long' };
  if (!NOT_NUMERIC.has(name) && PLAIN_NUMBER.test(value)) {
    if (name.endsWith('opacity')) return { kind: 'number', step: 0.05, min: 0, max: 1 };
    if (name === 'font-weight') return { kind: 'number', step: 100, min: 1, max: 1000 };
    return NON_NEGATIVE.has(name) ? { kind: 'number', step: 1, min: 0 } : { kind: 'number', step: 1 };
  }
  // Any other attribute holding a hex colour (e.g. data-accent="#f00") gets the colour editor.
  if (/^\s*#[0-9a-f]{3,8}\s*$/i.test(value) && parsePaint(value)?.kind === 'color') return { kind: 'color' };
  return { kind: 'text' };
}

/** Options for an enum select: the known values plus the current one if it's non-standard. */
export function enumOptions(options: string[], value: string): string[] {
  return options.includes(value) ? options : [value, ...options];
}
