// src/engine/tools/types.ts
// Creation tools (M1). The Editor routes pointer/keyboard input to the active tool and gives it
// a ToolHost: coordinate mapping into the insertion scope, snapping, live preview and a single
// undoable insertion. Tools never touch History directly.
import type { Modifiers, Vec } from '../model';

export type ToolId = 'select' | 'rect' | 'ellipse' | 'line' | 'polygon' | 'star' | 'pen' | 'pencil' | 'text';

export interface ToolEvent {
  /** Screen (overlay) position. */
  s: Vec;
  /** Position in the insertion scope's user space, snapped unless Ctrl is held. */
  p: Vec;
  /** Unsnapped position in scope user space. */
  raw: Vec;
  mods: Modifiers;
  /** The DOM element under the pointer (for the text tool to edit existing text). */
  target: EventTarget | null;
  /** Pointer position in client (viewport) coordinates. */
  client: Vec;
}

export interface ToolOptions {
  polygonSides: number;
  starPoints: number;
  /** Inner radius as a fraction of the outer radius. */
  starInnerRatio: number;
  /** Pencil smoothing tolerance in screen px. */
  pencilTolerance: number;
  fontSize: number;
  fontFamily: string;
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  polygonSides: 6,
  starPoints: 5,
  starInnerRatio: 0.5,
  pencilTolerance: 2,
  fontSize: 32,
  fontFamily: 'system-ui, sans-serif',
};

/** Which default style a new element gets. */
export type StyleKind = 'shape' | 'stroke' | 'text';

export interface ToolHost {
  readonly options: ToolOptions;
  /** Element new shapes are inserted into (document root or entered group). */
  scope(): Element;
  toScreen(p: Vec): Vec;
  toLocal(s: Vec): Vec;
  /** Scope user units per screen pixel (for screen-sized tolerances). */
  unitsPerPx(): number;
  /** Create an SVG element in the document namespace with the default style for `kind`. */
  create(tag: string, attrs: Record<string, string | number>, kind: StyleKind | null): SVGElement;
  /** Show an element in the scope while drawing; not recorded in history. */
  attachPreview(el: Element): void;
  /** Remove a preview element without recording anything. */
  detachPreview(el: Element): void;
  /** Record the insertion of `el` as one undo step, select it and return to the Select tool. */
  commit(el: Element, label: string): void;
  /** Re-render the overlay (calls the tool's overlay hook). */
  render(): void;
  status(msg: string): void;
  /** The HTML element that hosts the canvas (for inline text editing). */
  readonly hostElement: HTMLElement;
  /** Edit the text of an existing <text> element; resolves after commit/cancel. */
  editText(el: SVGTextElement, opts?: { isNew?: boolean; at?: Vec }): void;
}

export interface Tool {
  readonly id: ToolId;
  readonly cursor: string;
  pointerDown(e: ToolEvent): void;
  pointerMove(e: ToolEvent, dragging: boolean): void;
  pointerUp(e: ToolEvent): void;
  /** Return true when the key was handled. */
  keyDown?(e: KeyboardEvent): boolean;
  /** Abandon any work in progress (tool switch, Escape, document load). */
  cancel(): void;
  /** Draw guides in screen space. */
  overlay?(layer: SVGGElement): void;
  /** True while a multi-click construction (pen) is in progress. */
  busy?(): boolean;
  /** Finish (rather than discard) an unfinished construction, e.g. on tool switch. */
  commitPending?(): void;
}
