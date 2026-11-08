// Core types from the design: EditorPoint (Task_55) and ShapeAdapter (Task_56).

export interface Vec { x: number; y: number }

export interface Rect { x: number; y: number; width: number; height: number }

/** anchor | control | ghost | parameter | move | bounding (Editor point vocabulary). */
export type PointKind = 'anchor' | 'control' | 'ghost' | 'parameter' | 'move' | 'bounding';

export type Constraint = 'none' | 'x-axis' | 'y-axis' | 'radial' | 'on-ellipse';

export interface EditorPoint {
  id: string;
  elementId: string;
  kind: PointKind;
  role: string;
  /** Local user space of the element. */
  x: number;
  y: number;
  /** SVG attributes this point writes (rule: Write native attributes). */
  attr: string[];
  segmentIndex?: number;
  constraint: Constraint;
  /** For controls: the anchors they hang off (tangent lines + visibility). */
  linkedPointIds?: string[];
  /** Local points to draw tangent lines to (controls). */
  tangents?: Vec[];
  /** Screen-space offset so collapsed handles stay grabbable (e.g. r = 0). */
  screenOffset?: Vec;
  /** 'click' points act on click instead of drag (arc flip ghosts). */
  action?: 'drag' | 'click';
}

export interface Modifiers { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean }

export const NO_MODS: Modifiers = { shift: false, alt: false, ctrl: false, meta: false };

/** Attribute patch: value null removes the attribute. */
export type AttrPatch = Record<string, string | null>;

export interface Materialised { patch: AttrPatch; pointId: string }

export interface ShapeAdapter {
  tagNames: string[];
  getPoints(el: Element): EditorPoint[];
  /**
   * Compute the patch for dragging `pointId` to `target` (local space).
   * `el` is always in its drag-start state, so the result is absolute, not incremental.
   */
  dragPoint(el: Element, pointId: string, target: Vec, mods: Modifiers): AttrPatch;
  /** Materialise a ghost point (insert vertex / convert segment). */
  insertPoint?(el: Element, ghostId: string): Materialised | null;
  /** Click action on a click-only ghost (arc flips). */
  clickPoint?(el: Element, pointId: string): AttrPatch | null;
  /** Delete anchors. null = refused. */
  deletePoint?(el: Element, pointIds: string[]): AttrPatch | null;
  /** Move a set of points by a delta (multi-point drag / nudge). */
  movePoints?(el: Element, pointIds: string[], d: Vec): AttrPatch;
  /** Translate the whole element natively. null = use transform. */
  translate?(el: Element, d: Vec): AttrPatch | null;
  /** Local-space bounding box. */
  getBBox(el: Element): Rect;
  /** Native resize from box `from` to `to`. null = cannot, use transform. */
  resize?(el: Element, from: Rect, to: Rect): AttrPatch | null;
  /** The shape's own points already resize it (corner + edge anchors): the bounding box then shows only rotate + pivot. */
  hasOwnResize?(el: Element): boolean;
  /** Bounding box can only scale uniformly (circle). */
  uniformOnly?: boolean;
  /** Bounding handles on edges write transform; corners call resize (text). */
  edgeResizeUsesTransform?: boolean;
  /** Polylines per segment index (for hover ghosts and snapping). */
  segments?(el: Element): Vec[][];
  /** Equivalent path data for Convert to path. */
  toPath?(el: Element): string;
  /** Geometry attributes replaced by Convert to path. */
  geometryAttrs?: string[];
  /** Double-click on a point (path node type cycling). */
  doubleClickPoint?(el: Element, pointId: string): AttrPatch | null;
  /** Context-menu entries for a point. */
  pointMenu?(el: Element, pointId: string): { label: string; checked?: boolean; run: () => AttrPatch | null }[];
}

// Stable runtime ids for elements without touching the document.
const ids = new WeakMap<Element, string>();
let nextId = 1;
export function elementId(el: Element): string {
  let id = ids.get(el);
  if (!id) { id = `e${nextId++}`; ids.set(el, id); }
  return id;
}
