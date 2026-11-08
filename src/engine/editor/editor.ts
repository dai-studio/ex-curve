// Canvas (Task_50) + Overlay layer (Task_51) + the editing flow:
// Element selected -> Resolve adapter -> Render editor points -> Pointer down on handle ->
// Point kind? -> (ghost: Materialise) -> Drag editor point -> Apply attribute patch.
import type { AttrPatch, EditorPoint, Modifiers, Rect, Vec } from '../model';
import { adapterFor, isGroup } from '../adapters/registry';
import { dragBox, handlePos, type BoxHandle } from '../adapters/common';
import { History } from '../history';
import { canConvertToPath, convertToEllipse, convertToPath } from '../commands';
import { fmt } from '../num';
import {
  add, dist, distToSegment, fromDOM, hasRotationOrSkew, matApply, matInvert, matMul, mul, norm, parseTransform, rectFromPoints, sub, boxMap,
  prependRotate, prependTranslate, matrixString,
  type Mat,
} from '../geom';
import { Gesture } from './gesture';
import { Emitter } from '../events';
import { createTools, DEFAULT_TOOL_OPTIONS, type StyleKind, type Tool, type ToolEvent, type ToolHost, type ToolId, type ToolOptions } from '../tools';
import { InlineTextEditor } from './textedit';
import { stylePatch } from '../style';
import { alignDeltas, distributeDeltas, planZOrder, ungroupBlocker, ungroupChildren, unionRect, type AlignEdge } from '../arrange';
import { collectIds, uniquifyIds } from '../ids';
import { describeReport, sanitize } from '../sanitize';
import { buildClip, parseClip, planDefs } from '../clipboard';
import { boxCandidates, snapMove, snapPoint, type GridOpts, type SnapKind } from '../snap';
import {
  byId, chainMatrix, definitionKind, hrefTarget, instanceMatrix, isDefinitionContent, parseViewBox, referencesFrom, usersOf,
  type DefKind,
} from '../defs';
import { applyPatch, type MutateOp } from '../history';

const SVGNS = 'http://www.w3.org/2000/svg';
const SHAPES = 'rect,circle,ellipse,line,polyline,polygon,path,text,image,foreignObject,use,svg,g,a,switch';
// Rule "Handles are screen-sized": glyphs 8px (anchor/parameter/move) and 6px (control/ghost); hit area 12px.
const HIT = 6;
const DRAG_THRESHOLD = 3;
const ROT_OFFSET = 22;
const PRIORITY: Record<string, number> = { anchor: 0, move: 1, parameter: 1, control: 2, ghost: 3, bounding: 4 };

export interface Handle { el: Element; point: EditorPoint; s: Vec }

interface Base { startS: Vec; moved: boolean }
type DragState = Base & (
  | { type: 'point'; el: Element; point: EditorPoint; M: Mat; gesture: Gesture; materialised: boolean; multi: boolean; targets: Vec[] }
  | { type: 'click'; el: Element; point: EditorPoint }
  | { type: 'move'; gesture: Gesture; candidates: Vec[]; targets: Vec[] }
  | { type: 'resize'; el: Element; h: BoxHandle; box: Rect; M: Mat; gesture: Gesture; origT: string | null; targets: Vec[] }
  | { type: 'rotate'; el: Element; pivotS: Vec; pivotParent: Vec; a0: number; flip: boolean; gesture: Gesture; origT: string | null }
  | { type: 'pivot'; el: Element; M: Mat }
  | { type: 'marquee'; additive: boolean }
  | { type: 'pan'; v0: { x: number; y: number } }
);

/** Definition being edited on the canvas (a symbol or reusable shape, through one instance). */
export interface DefinitionEdit {
  target: Element;
  /** The <use> it is edited through; null = placed at the document origin. */
  instance: Element | null;
  /** Definition frame → document user space. */
  placement: Mat;
  kind: DefKind;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;

export interface MenuItem { label: string; checked?: boolean; disabled?: boolean; run: () => void }

export interface EditorEvents {
  /** Anything the UI may show changed (selection, history, view, hover...). */
  change: [];
  /** Document content changed (edit, undo, redo, load). Carries the new history state id. */
  doc: [stateId: number];
  /** Dirty flag flipped. */
  dirty: [dirty: boolean];
  status: [message: string];
  /** Pointer position in document user space (null when outside). */
  pointer: [docPt: Vec | null];
  menu: [items: MenuItem[], clientX: number, clientY: number];
  /** Active tool changed. */
  tool: [id: ToolId];
  /** The visible area (pan / zoom / resize) changed. */
  view: [];
  /** Definition editing started or ended. */
  definition: [];
}

/** Default presentation attributes for new elements, per style kind. */
export type DefaultStyles = Record<StyleKind, Record<string, string>>;

const linear = (m: Mat): Mat => [m[0], m[1], m[2], m[3], 0, 0];
const mods = (e: MouseEvent | KeyboardEvent): Modifiers => ({ shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey });

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}



/** Point in a (convex) quadrilateral, with a tolerance in pixels for thin shapes. */
function pointInQuad(p: Vec, q: Vec[], tol: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(c) < 1e-9) continue;
    const sg = Math.sign(c);
    if (sign && sg !== sign) return q.some((_, j) => distToSegment(p, q[j], q[(j + 1) % 4]) <= tol);
    sign = sg;
  }
  return true;
}

export class Editor extends Emitter<EditorEvents> {
  readonly host: HTMLElement;
  readonly canvas: SVGSVGElement;
  readonly overlay: SVGSVGElement;
  private page: SVGRectElement;
  private wrapper: SVGSVGElement;
  doc: SVGSVGElement | null = null;
  prolog = '';
  readonly history = new History();
  scope: Element | null = null;
  selection: Element[] = [];
  selectedPoints = new Map<Element, Set<string>>();
  /** Attributes written by the last action, for the inspector. */
  lastChanged = new Map<Element, Set<string>>();
  /** `snap` is the master switch; while the grid is shown, snapping includes the grid. */
  settings = { grid: 10, showGrid: false, snap: true };
  private savedStateId = 0;
  private wasDirty = false;
  private abort = new AbortController();
  private resizeObserver: ResizeObserver;

  private pivots = new WeakMap<Element, Vec>();
  private handles: Handle[] = [];
  private hoverSeg: { el: Element; index: number } | null = null;
  private view = { x: 0, y: 0, zoom: 1 };
  private docSize = { width: 800, height: 600 };
  private drag: DragState | null = null;
  private snapMark: { p: Vec; kind: SnapKind } | null = null;
  private marquee: Rect | null = null;
  private spaceDown = false;
  private needsFit = false;

  // ---- tools (M1)
  readonly toolOptions: ToolOptions = { ...DEFAULT_TOOL_OPTIONS };
  defaultStyle: DefaultStyles = {
    shape: { fill: '#c7d2fe', stroke: '#4f46e5', 'stroke-width': '2' },
    stroke: { fill: 'none', stroke: '#1e293b', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    text: { fill: '#0f172a' },
  };
  private toolId: ToolId = 'select';
  private tools: Record<Exclude<ToolId, 'select'>, Tool>;
  private toolDown = false;
  private toolTargets: Vec[] | null = null;
  private previews = new Set<Element>();
  private textEditor: InlineTextEditor;
  /** Open preview gesture for continuous inspector edits (colour drags, number scrubbing). */
  private live: { gesture: Gesture; label: string } | null = null;
  /** Editor-only lock state (never written to the document). */
  private locked = new WeakSet<Element>();
  /** Repeated pastes of the same clip are offset so copies don't stack exactly. */
  private lastPaste: { text: string; count: number } | null = null;
  private defEdit: DefinitionEdit | null = null;
  /** Identifies the loaded document in clipboard clips (new on every load). */
  private docToken = '';

  constructor(host: HTMLElement) {
    super();
    this.host = host;
    this.canvas = svg('svg', { class: 'canvas' });
    this.page = svg('rect', { class: 'page' }, this.canvas);
    this.wrapper = svg('svg', { overflow: 'visible' }, this.canvas);
    this.overlay = svg('svg', { class: 'overlay' });
    host.append(this.canvas, this.overlay);
    host.dataset.tool = 'select';
    this.tools = createTools(this.toolHost());
    this.textEditor = new InlineTextEditor(host, {
      screenMat: (el) => this.screenMat(el),
      done: (el, text, isNew) => this.textEdited(el, text, isNew),
    });
    const signal = this.abort.signal;
    host.addEventListener('pointerdown', (e) => this.pointerDown(e), { signal });
    host.addEventListener('pointermove', (e) => this.pointerMove(e), { signal });
    host.addEventListener('pointerup', (e) => this.pointerUp(e), { signal });
    host.addEventListener('pointercancel', (e) => this.pointerUp(e), { signal });
    host.addEventListener('pointerleave', () => this.emit('pointer', null), { signal });
    host.addEventListener('dblclick', (e) => this.doubleClick(e), { signal });
    host.addEventListener('contextmenu', (e) => this.contextMenu(e), { signal });
    host.addEventListener('wheel', (e) => this.wheel(e), { signal, passive: false });
    window.addEventListener('keydown', (e) => this.keyDown(e), { signal });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { this.spaceDown = false; this.host.classList.remove('panning'); } }, { signal });
    this.resizeObserver = new ResizeObserver(() => {
      if (this.needsFit && this.host.clientWidth > 0) { this.zoomToFit(); return; }
      this.applyView(); this.render();
    });
    this.resizeObserver.observe(host);
    this.history.onChange = () => {
      this.toolTargets = null;
      this.syncDocSize();
      this.emit('doc', this.history.stateId);
      this.updateDirty();
      this.emit('change');
    };
  }

  // ---------------------------------------------------------------- document

  /**
   * Load an SVG document. Unsafe content is stripped first (see sanitize.ts); returns a
   * description of what was removed, or '' when the document was clean.
   */
  load(text: string): string {
    this.cancelTool();
    this.live = null;
    this.defEdit = null;
    this.host.classList.remove('def-editing');
    this.docToken = Math.random().toString(36).slice(2, 10);
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = parsed.documentElement;
    if (parsed.getElementsByTagName('parsererror').length || root.localName !== 'svg') {
      throw new Error('Not a valid SVG document');
    }
    const warning = describeReport(sanitize(root));
    const at = text.search(/<svg[\s>]/);
    this.prolog = at > 0 ? text.slice(0, at) : '';
    const doc = document.importNode(root, true) as unknown as SVGSVGElement;
    this.wrapper.replaceChildren(doc);
    this.doc = doc;
    this.syncDocSize();
    this.scope = doc;
    this.selection = [];
    this.selectedPoints.clear();
    this.lastChanged.clear();
    this.history.clear();
    this.savedStateId = this.history.stateId;
    this.updateDirty();
    this.zoomToFit();
    this.emit('change');
    return warning;
  }

  /** Start a blank document of the given size (user units = px). */
  newDocument(width: number, height: number): void {
    const w = fmt(width), h = fmt(height);
    this.load(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"></svg>`);
  }

  /** Document size in px (from width/height, else viewBox). */
  get size(): { width: number; height: number } { return { ...this.docSize }; }

  /**
   * Resize the document canvas as one undo step. The viewBox keeps its origin and is scaled
   * with the size, so content keeps its on-page scale (canvas resize, not content scale).
   */
  setDocSize(width: number, height: number): void {
    const doc = this.doc;
    if (!doc || width <= 0 || height <= 0) return;
    const patch: AttrPatch = { width: fmt(width), height: fmt(height) };
    const vb = doc.getAttribute('viewBox') ? doc.viewBox.baseVal : null;
    if (vb && vb.width > 0 && vb.height > 0) {
      const sx = vb.width / this.docSize.width, sy = vb.height / this.docSize.height;
      patch.viewBox = `${fmt(vb.x)} ${fmt(vb.y)} ${fmt(width * sx)} ${fmt(height * sy)}`;
    }
    const g = new Gesture();
    g.preview(doc, patch);
    this.commit(g, 'Document size');
    this.render();
  }

  /** The root viewBox, or null when the document has none (or it is invalid). */
  getViewBox(): Rect | null {
    const raw = this.doc?.getAttribute('viewBox');
    if (!raw) return null;
    const n = raw.trim().split(/[\s,]+/).map(Number);
    return n.length === 4 && n.every(Number.isFinite) ? { x: n[0], y: n[1], width: n[2], height: n[3] } : null;
  }

  /**
   * Set (or with null, remove) the root viewBox as one undo step. Width and height must be
   * positive. `live` previews it (arrow-key stepping) until the next non-live edit commits.
   */
  setViewBox(vb: Rect | null, live = false): void {
    const doc = this.doc;
    if (!doc || (vb && !(vb.width > 0 && vb.height > 0))) return;
    const value = vb ? `${fmt(vb.x)} ${fmt(vb.y)} ${fmt(vb.width)} ${fmt(vb.height)}` : null;
    this.applyPatches([[doc, { viewBox: value }]], 'Set viewBox', live);
    this.syncDocSize(); // the page size follows the viewBox when width/height are absent
    this.render();
  }

  /** Canvas renders the document unmodified; a fixed-size wrapper resolves percentage sizes. */
  private syncDocSize(): void {
    const doc = this.doc;
    if (!doc) return;
    const vb = doc.getAttribute('viewBox') ? doc.viewBox?.baseVal : null;
    const abs = (a: string) => { const v = doc.getAttribute(a); return v && /^[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : 0; };
    this.docSize = {
      width: abs('width') || (vb && vb.width) || 800,
      height: abs('height') || (vb && vb.height) || 600,
    };
    for (const e of [this.wrapper, this.page]) {
      e.setAttribute('width', String(this.docSize.width));
      e.setAttribute('height', String(this.docSize.height));
    }
  }

  // ---------------------------------------------------------------- dirty tracking

  /** History state id of the current document; pass it back to markSaved() after writing a snapshot. */
  get stateId(): number { return this.history.stateId; }

  get isDirty(): boolean { return this.history.stateId !== this.savedStateId; }

  /** Record that the document as of `stateId` (default: now) has been saved. */
  markSaved(stateId = this.history.stateId): void { this.savedStateId = stateId; this.updateDirty(); }

  /** Force the dirty state (e.g. a document that was never saved to a file). */
  markDirty(): void { this.savedStateId = -1; this.updateDirty(); }

  private updateDirty(): void {
    const d = this.isDirty;
    if (d !== this.wasDirty) { this.wasDirty = d; this.emit('dirty', d); }
  }

  /** Remove listeners and DOM; the editor cannot be used afterwards. */
  destroy(): void {
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.clearListeners();
    this.canvas.remove();
    this.overlay.remove();
    this.doc = null;
  }

  serialize(): string {
    if (!this.doc) return '';
    return this.prolog + new XMLSerializer().serializeToString(this.doc);
  }

  // ---------------------------------------------------------------- view (pan / zoom via viewBox)

  zoomToFit(): void {
    // Not laid out yet (mounted detached / hidden): fit once the host gets a size.
    this.needsFit = !this.host.clientWidth || !this.host.clientHeight;
    const w = this.host.clientWidth || 800, h = this.host.clientHeight || 600;
    const z = Math.min(w / (this.docSize.width + 80), h / (this.docSize.height + 80));
    this.view.zoom = Math.max(0.05, z);
    this.view.x = this.docSize.width / 2 - w / 2 / this.view.zoom;
    this.view.y = this.docSize.height / 2 - h / 2 / this.view.zoom;
    this.applyView();
    this.render();
  }

  zoomBy(f: number, at?: Vec): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const p = at ?? { x: w / 2, y: h / 2 };
    const before = { x: this.view.x + p.x / this.view.zoom, y: this.view.y + p.y / this.view.zoom };
    this.view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.view.zoom * f));
    this.view.x = before.x - p.x / this.view.zoom;
    this.view.y = before.y - p.y / this.view.zoom;
    this.applyView();
    this.render();
  }

  get zoom(): number { return this.view.zoom; }

  /** The visible area in canvas (page) coordinates; the page spans 0,0 → pageRect size. */
  get viewRect(): Rect {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    return { x: this.view.x, y: this.view.y, width: w / this.view.zoom, height: h / this.view.zoom };
  }

  /** The page (document) rectangle in canvas coordinates. */
  get pageRect(): Rect { return { x: 0, y: 0, ...this.docSize }; }

  /** Pan so the visible area starts at (x, y) in canvas coordinates. */
  panTo(x: number, y: number): void {
    this.view.x = x;
    this.view.y = y;
    this.applyView();
    this.render();
  }

  /** Zoom to `z` with the selection centred in view, or the document's centre when nothing is selected. */
  zoomTo(z: number): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const els = this.selection.filter((e) => e.isConnected);
    // Focus point in canvas coordinates (the page spans 0,0 → docSize); it ends up at the view centre.
    let c: Vec = { x: this.docSize.width / 2, y: this.docSize.height / 2 };
    if (els.length) {
      const pts = els.flatMap((el) => {
        const a = adapterFor(el), M = this.screenMat(el);
        if (!a || !M) return [];
        const b = a.getBBox(el);
        return [matApply(M, { x: b.x, y: b.y }), matApply(M, { x: b.x + b.width, y: b.y + b.height })];
      });
      if (pts.length) {
        const r = rectFromPoints(pts); // screen space → canvas coordinates
        c = { x: this.view.x + (r.x + r.width / 2) / this.view.zoom, y: this.view.y + (r.y + r.height / 2) / this.view.zoom };
      }
    }
    this.view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    this.view.x = c.x - w / 2 / this.view.zoom;
    this.view.y = c.y - h / 2 / this.view.zoom;
    this.applyView();
    this.render();
  }

  private applyView(): void {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.canvas.setAttribute('viewBox', `${this.view.x} ${this.view.y} ${w / this.view.zoom} ${h / this.view.zoom}`);
    this.textEditor?.place();
    this.toolTargets = null;
    this.emit('view');
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) this.zoomBy(Math.exp(-e.deltaY * 0.01), this.local(e));
    else {
      this.view.x += e.deltaX / this.view.zoom;
      this.view.y += e.deltaY / this.view.zoom;
      this.applyView();
      this.render();
    }
  }

  // ---------------------------------------------------------------- coordinate mapping (Task_42)

  private local(e: MouseEvent): Vec {
    const r = this.overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Element local user space -> overlay (screen) space. */
  screenMat(el: Element): Mat | null {
    // Inside the definition being edited nothing renders by itself: map through the instance.
    const d = this.defEdit;
    if (d && el !== this.doc) {
      const container = this.defContainer();
      if (d.target === el || d.target.contains(el) || el === container) {
        const D = this.domScreenMat(this.doc!);
        if (!D) return null;
        const base = matMul(D, d.placement);
        return el === container && container !== d.target ? base : matMul(base, chainMatrix(d.target, el));
      }
    }
    return this.domScreenMat(el);
  }

  private domScreenMat(el: Element): Mat | null {
    const m = (el as SVGGraphicsElement).getScreenCTM?.();
    if (!m) return null;
    const r = this.overlay.getBoundingClientRect();
    return matMul([1, 0, 0, 1, -r.left, -r.top], fromDOM(m));
  }

  // ---------------------------------------------------------------- selection helpers

  private pickElement(target: EventTarget | null): Element | null {
    const doc = this.doc;
    if (!doc || !(target instanceof Element) || !doc.contains(target) || target === doc) return null;
    if (!this.scope || !this.scope.isConnected || !this.scope.contains(target) || target === this.scope) this.scope = doc;
    let n: Element = target;
    while (n.parentElement && n.parentElement !== this.scope) n = n.parentElement;
    return n.parentElement === this.scope && adapterFor(n) && !this.isLocked(n) ? n : null;
  }

  select(els: Element[]): void {
    this.selection = els;
    for (const k of [...this.selectedPoints.keys()]) if (!els.includes(k)) this.selectedPoints.delete(k);
    this.render();
    this.emit('change');
  }

  private pruneSelection(): void {
    if (this.defEdit && !this.defEdit.target.isConnected) this.exitDefinition(false);
    this.selection = this.selection.filter((e) => e.isConnected);
    this.selectedPoints.clear();
    if (this.scope && !this.scope.isConnected) this.scope = this.doc;
  }

  private pointCount(): number {
    let n = 0;
    for (const s of this.selectedPoints.values()) n += s.size;
    return n;
  }

  // ---------------------------------------------------------------- rendering

  /** Point visibility rule (Task_49). */
  private visiblePoints(el: Element, pts: EditorPoint[]): EditorPoint[] {
    const sel = this.selectedPoints.get(el) ?? new Set<string>();
    const near = new Set(sel);
    for (const p of pts) if (p.role === 'insert' && p.linkedPointIds?.some((id) => sel.has(id))) p.linkedPointIds.forEach((id) => near.add(id));
    const hover = this.hoverSeg?.el === el ? this.hoverSeg.index : -1;
    return pts.filter((p) => {
      if (p.kind === 'anchor' || p.kind === 'move' || p.role === 'glyph') return true;
      if (p.role === 'insert') return p.segmentIndex === hover || !!p.linkedPointIds?.some((id) => sel.has(id));
      if (!p.linkedPointIds) return true; // shape-level parameters (radius handles)
      return p.linkedPointIds.some((id) => near.has(id));
    });
  }

  private boundingPoints(el: Element, box: Rect, M: Mat): Handle[] {
    const a = adapterFor(el)!;
    const uy = norm(matApply(linear(M), { x: 0, y: 1 }));
    const out: Handle[] = [];
    // Shapes whose own anchors resize them get no duplicate box resize handles (rotation + pivot only).
    const hs: BoxHandle[] = a.hasOwnResize?.(el) ? [] : a.uniformOnly ? ['nw', 'ne', 'se', 'sw'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const eid = '';
    for (const h of hs) {
      const p = handlePos(box, h);
      const s = matApply(M, p); // on the selection outline, like the shape's own corner anchors
      out.push({ el, s, point: { id: `bb-${h}`, elementId: eid, kind: 'bounding', role: 'resize', ...p, attr: [], constraint: 'none' } });
    }
    const top = handlePos(box, 'n');
    out.push({
      el, s: add(matApply(M, top), mul(uy, -ROT_OFFSET)),
      point: { id: 'bb-rot', elementId: eid, kind: 'bounding', role: 'rotate', ...top, attr: ['transform'], constraint: 'none' },
    });
    const pv = this.pivots.get(el) ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    out.push({ el, s: matApply(M, pv), point: { id: 'bb-pivot', elementId: eid, kind: 'bounding', role: 'pivot', ...pv, attr: [], constraint: 'none' } });
    return out;
  }

  render(): void {
    const o = this.overlay;
    o.replaceChildren();
    this.handles = [];
    if (!this.doc) return;
    if (this.defEdit) this.renderDefinition();
    if (this.settings.showGrid) this.renderGrid();
    if (this.scope && this.scope !== this.doc && this.scope.isConnected && adapterFor(this.scope)) this.outline(this.scope, 'scope-box');

    const layers = { box: svg('g', {}, o), tangents: svg('g', {}, o), seg: svg('g', {}, o), handles: svg('g', {}, o) };
    for (const el of this.selection) {
      if (!el.isConnected) continue;
      const a = adapterFor(el);
      const M = this.screenMat(el);
      if (!a || !M) continue;
      const box = a.getBBox(el);
      this.outline(el, 'sel-box', layers.box);
      if (this.hoverSeg?.el === el && a.segments) {
        const poly = a.segments(el)[this.hoverSeg.index];
        if (poly?.length) svg('polyline', { class: 'hover-seg', points: poly.map((p) => { const s = matApply(M, p); return `${s.x},${s.y}`; }).join(' ') }, layers.seg);
      }
      for (const p of this.visiblePoints(el, a.getPoints(el))) {
        const s0 = matApply(M, p);
        const s = p.screenOffset ? add(s0, p.screenOffset) : s0;
        for (const t of p.tangents ?? []) {
          const ts = matApply(M, t);
          svg('line', { class: 'tangent', x1: ts.x, y1: ts.y, x2: s.x, y2: s.y }, layers.tangents);
        }
        this.handles.push({ el, point: p, s });
      }
      if (this.selection.length === 1 && !this.drag?.moved) {
        // A box handle that coincides with one of the shape's own points (e.g. a line endpoint on a
        // bbox corner) is skipped: the shape's point already occupies that corner.
        const own = this.handles.filter((h) => h.el === el);
        for (const h of this.boundingPoints(el, box, M)) {
          if (h.point.role === 'resize' && own.some((o) => dist(o.s, h.s) < HIT)) continue;
          this.handles.push(h);
        }
      }
    }
    // Draw handles, lowest priority first so anchors end up on top.
    const ordered = [...this.handles].sort((a, b) => PRIORITY[b.point.kind] - PRIORITY[a.point.kind]);
    for (const h of ordered) this.glyph(h, layers.handles);
    if (this.marquee) svg('rect', { class: 'marquee', x: this.marquee.x, y: this.marquee.y, width: this.marquee.width, height: this.marquee.height }, o);
    if (this.toolId !== 'select') this.tools[this.toolId].overlay?.(svg('g', { class: 'tool-layer' }, o));
    if (this.snapMark) {
      // Red × for object snaps, a smaller accent + for grid snaps.
      const { p: { x, y }, kind } = this.snapMark;
      const d = kind === 'grid'
        ? `M${x - 4} ${y}H${x + 4}M${x} ${y - 4}V${y + 4}`
        : `M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x - 5} ${y + 5}L${x + 5} ${y - 5}`;
      svg('path', { class: `snap-mark${kind === 'grid' ? ' grid' : ''}`, d }, o);
    }
  }

  private outline(el: Element, cls: string, parent: Element = this.overlay): void {
    const a = adapterFor(el), M = this.screenMat(el);
    if (!a || !M) return;
    const b = a.getBBox(el);
    const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]]
      .map(([x, y]) => matApply(M, { x, y })).map((p) => `${p.x},${p.y}`).join(' ');
    svg('polygon', { class: cls, points: pts }, parent);
  }

  private glyph(h: Handle, parent: Element): void {
    const { point: p, s } = h;
    const selected = this.selectedPoints.get(h.el)?.has(p.id) ? ' selected' : '';
    const cls = `h h-${p.kind} r-${p.role}${selected}`;
    const g = svg('g', { class: cls, transform: `translate(${s.x} ${s.y})` }, parent);
    switch (p.kind) {
      case 'anchor': svg('rect', { x: -4, y: -4, width: 8, height: 8 }, g); break;
      case 'control': svg('circle', { r: 3 }, g); break;
      case 'ghost': svg('circle', { r: 3 }, g); break;
      case 'parameter':
        if (p.role === 'rotation') { svg('circle', { r: 4 }, g); break; }
        svg('rect', { x: -2.83, y: -2.83, width: 5.66, height: 5.66, transform: 'rotate(45)' }, g); break;
      case 'move':
        svg('circle', { r: 4 }, g);
        svg('path', { d: 'M-4 0H4M0 -4V4M-4 0l1.5 -1.5M-4 0l1.5 1.5M4 0l-1.5 -1.5M4 0l-1.5 1.5M0 -4l-1.5 1.5M0 -4l1.5 1.5M0 4l-1.5 -1.5M0 4l1.5 -1.5' }, g);
        break;
      case 'bounding':
        if (p.role === 'rotate') svg('circle', { r: 4 }, g);
        else if (p.role === 'pivot') { svg('circle', { r: 4 }, g); svg('path', { d: 'M-6 0H6M0 -6V6' }, g); }
        else svg('rect', { x: -4, y: -4, width: 8, height: 8 }, g);
        break;
    }
  }

  private renderGrid(): void {
    const M = this.doc && this.screenMat(this.doc);
    if (!M) return;
    const step = this.settings.grid * Math.hypot(M[0], M[1]);
    if (step < 6) return;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const inv = matInvert(M);
    const tl = matApply(inv, { x: 0, y: 0 }), br = matApply(inv, { x: w, y: h });
    const g = this.settings.grid;
    let d = '';
    for (let x = Math.floor(tl.x / g) * g; x <= br.x; x += g) { const s = matApply(M, { x, y: 0 }).x; d += `M${s} 0V${h}`; }
    for (let y = Math.floor(tl.y / g) * g; y <= br.y; y += g) { const s = matApply(M, { x: 0, y }).y; d += `M0 ${s}H${w}`; }
    svg('path', { class: 'grid', d }, this.overlay);
  }

  // ---------------------------------------------------------------- hit testing

  private hitHandle(s: Vec): Handle | null {
    let best: Handle | null = null, bestKey = Infinity;
    for (const h of this.handles) {
      if (Math.abs(h.s.x - s.x) > HIT || Math.abs(h.s.y - s.y) > HIT) continue;
      // Nearest handle wins; kind priority only breaks near-ties (anchors over controls over ghosts).
      const key = dist(h.s, s) + PRIORITY[h.point.kind] * 1.5;
      if (key < bestKey) { best = h; bestKey = key; }
    }
    return best;
  }

  private updateHover(s: Vec): void {
    let found: { el: Element; index: number } | null = null, best = 8;
    for (const el of this.selection) {
      const a = adapterFor(el), M = this.screenMat(el);
      if (!a?.segments || !M) continue;
      a.segments(el).forEach((poly, index) => {
        for (let k = 1; k < poly.length; k++) {
          const d = distToSegment(s, matApply(M, poly[k - 1]), matApply(M, poly[k]));
          if (d < best) { best = d; found = { el, index }; }
        }
      });
    }
    const f = found as { el: Element; index: number } | null;
    const changed = f?.el !== this.hoverSeg?.el || f?.index !== this.hoverSeg?.index;
    this.hoverSeg = f;
    if (changed) this.render();
  }

  // ---------------------------------------------------------------- snapping (Task_43)

  /**
   * Screen-space snap targets: anchors, segment midpoints and bbox points of every shape.
   * `exclude` drops individual points (the ones being dragged); `excludeEls` drops whole elements
   * and their descendants (the shapes being moved or resized).
   */
  private snapTargets(exclude: Map<Element, Set<string>>, excludeEls: Element[] = []): Vec[] {
    const out: Vec[] = [];
    if (!this.doc) return out;
    const els = Array.from(this.doc.querySelectorAll(SHAPES)).slice(0, 2000);
    for (const el of els) {
      if (this.previews.has(el) || excludeEls.some((x) => x === el || x.contains(el))) continue;
      // Definition content has no position of its own, except the definition being edited.
      if (isDefinitionContent(el) && !(this.defEdit && (this.defEdit.target === el || this.defEdit.target.contains(el)))) continue;
      const a = adapterFor(el), M = this.screenMat(el);
      if (!a || !M) continue;
      const ex = exclude.get(el);
      if (!isGroup(el)) {
        for (const p of a.getPoints(el)) if (p.kind === 'anchor' && !ex?.has(p.id)) out.push(matApply(M, p));
        if (!ex) for (const poly of a.segments?.(el) ?? []) {
          if (poly.length < 2) continue;
          const m = poly.length % 2 ? poly[(poly.length - 1) / 2] : { x: (poly[poly.length / 2 - 1].x + poly[poly.length / 2].x) / 2, y: (poly[poly.length / 2 - 1].y + poly[poly.length / 2].y) / 2 };
          out.push(matApply(M, m));
        }
      }
      if (!ex) {
        const b = a.getBBox(el);
        for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) out.push(matApply(M, { x: b.x + b.width * fx, y: b.y + b.height * fy }));
      }
    }
    return out;
  }

  /** Grid snapping is on while snapping is on and the grid is shown. */
  private gridOpts(): GridOpts | null {
    if (!this.settings.showGrid || !this.doc) return null;
    const M = this.screenMat(this.doc);
    return M ? { toScreen: M, toDoc: matInvert(M), size: this.settings.grid } : null;
  }

  private snapEnabled(m: Modifiers): boolean { return this.settings.snap && !m.ctrl; } // hold Ctrl to bypass

  /** Snap a screen point; records the marker for both object and grid snaps. */
  private snap(s: Vec, targets: Vec[], m: Modifiers): Vec {
    this.snapMark = null;
    if (!this.snapEnabled(m)) return s;
    const r = snapPoint(s, targets, { grid: this.gridOpts() });
    if (r.kind) this.snapMark = { p: r.p, kind: r.kind };
    return r.p;
  }

  // ---------------------------------------------------------------- pointer flow

  private pointerDown(e: PointerEvent): void {
    if (e.button === 2 || !this.doc) return;
    this.host.focus();
    const s = this.local(e);
    try { this.host.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    if (e.button === 1 || this.spaceDown) {
      this.drag = { type: 'pan', startS: s, moved: false, v0: { x: this.view.x, y: this.view.y } };
      return;
    }
    if (this.toolId !== 'select') {
      e.preventDefault(); // no compatibility mousedown: it would move focus away from inline text editing
      if (this.textEditor.editing) { this.textEditor.commit(); if (this.toolId === 'text') return; }
      this.toolDown = true;
      this.tools[this.toolId].pointerDown(this.toolEvent(e, s));
      this.render();
      return;
    }
    if (this.textEditor.editing) this.textEditor.commit();
    const h = this.hitHandle(s);
    if (h) { this.beginHandle(h, s, e); return; }
    const el = this.pickFrom(e.target, s);
    if (el) {
      if (e.shiftKey) this.selection = this.selection.includes(el) ? this.selection.filter((x) => x !== el) : [...this.selection, el];
      else if (!this.selection.includes(el)) { this.selection = [el]; this.selectedPoints.clear(); }
      if (!e.shiftKey) this.selectedPoints.clear();
      this.drag = { type: 'move', startS: s, moved: false, gesture: new Gesture(), ...this.moveSnapState() };
    } else {
      this.drag = { type: 'marquee', startS: s, moved: false, additive: e.shiftKey };
    }
    this.render();
    this.emit('change');
  }

  /** Gateway "Point kind?" — decided on pointerdown. */
  private beginHandle(h: Handle, s: Vec, e: PointerEvent): void {
    const { el, point } = h;
    const a = adapterFor(el)!;
    const M = this.screenMat(el)!;
    if (point.kind === 'bounding') {
      const box = a.getBBox(el);
      const origT = el.getAttribute('transform');
      const gesture = new Gesture();
      if (point.role === 'resize') {
        this.drag = { type: 'resize', startS: s, moved: false, el, h: point.id.slice(3) as BoxHandle, box, M, gesture, origT, targets: this.snapTargets(new Map(), [el]) };
      } else if (point.role === 'rotate') {
        const pv = this.pivots.get(el) ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const pivotS = matApply(M, pv);
        const P = el.parentElement ? this.screenMat(el.parentElement) : null;
        this.drag = {
          type: 'rotate', startS: s, moved: false, el, gesture, origT,
          pivotS, pivotParent: matApply(parseTransform(origT), pv),
          a0: Math.atan2(s.y - pivotS.y, s.x - pivotS.x), flip: !!P && P[0] * P[3] - P[1] * P[2] < 0,
        };
      } else {
        this.drag = { type: 'pivot', startS: s, moved: false, el, M };
      }
      return;
    }
    if (point.action === 'click') { this.drag = { type: 'click', startS: s, moved: false, el, point }; return; }

    const gesture = new Gesture();
    let p = point, materialised = false;
    if (point.kind === 'ghost') {
      // Materialise ghost: insert vertex / convert S->C, T->Q, then drag the real point.
      const r = a.insertPoint?.(el, point.id);
      if (!r) return;
      gesture.apply(el, r.patch);
      const np = a.getPoints(el).find((q) => q.id === r.pointId);
      if (!np) { gesture.cancel(); return; }
      p = np; materialised = true;
      this.selectedPoints = new Map([[el, new Set([p.id])]]);
    } else {
      const sel = this.selectedPoints.get(el);
      if (e.shiftKey) {
        const set = sel ?? new Set<string>();
        if (set.has(p.id)) set.delete(p.id); else set.add(p.id);
        this.selectedPoints.set(el, set);
      } else if (!sel?.has(p.id)) {
        this.selectedPoints = new Map([[el, new Set([p.id])]]);
      }
    }
    const multi = !materialised && this.pointCount() > 1 && !!this.selectedPoints.get(el)?.has(p.id);
    const exclude = multi ? this.selectedPoints : new Map([[el, new Set([p.id])]]);
    this.drag = { type: 'point', startS: s, moved: false, el, point: p, M, gesture, materialised, multi, targets: this.snapTargets(exclude) };
    this.render();
    this.emit('change');
  }

  private pointerMove(e: PointerEvent): void {
    const s = this.local(e);
    if (this.doc) {
      const D = this.screenMat(this.doc);
      this.emit('pointer', D ? matApply(matInvert(D), s) : null);
    }
    const d = this.drag;
    if (!d && this.toolId !== 'select') {
      this.tools[this.toolId].pointerMove(this.toolEvent(e, s), this.toolDown);
      this.render();
      return;
    }
    if (!d) { this.updateHover(s); return; }
    if (!d.moved && dist(s, d.startS) < DRAG_THRESHOLD) return;
    d.moved = true;
    const m = mods(e);
    let dS = sub(s, d.startS);
    switch (d.type) {
      case 'pan':
        this.view.x = d.v0.x - dS.x / this.view.zoom;
        this.view.y = d.v0.y - dS.y / this.view.zoom;
        this.applyView();
        break;
      case 'point': {
        const p0s = matApply(d.M, d.point);
        dS = sub(this.snap(add(p0s, dS), d.targets, m), p0s);
        if (!d.multi) {
          const a = adapterFor(d.el)!;
          const target = matApply(matInvert(d.M), add(p0s, dS));
          d.gesture.reset(d.el);
          const patch = a.dragPoint(d.el, d.point.id, target, m);
          const stray = Object.keys(patch).filter((k) => !d.point.attr.includes(k));
          if (stray.length) console.warn(`[curve] ${d.point.id} wrote unlisted attributes`, stray);
          d.gesture.preview(d.el, patch);
        } else {
          for (const [el, ids] of this.selectedPoints) this.movePointsBy(d.gesture, el, [...ids], dS);
        }
        break;
      }
      case 'move': {
        this.snapMark = null;
        if (this.snapEnabled(m)) {
          const r = snapMove(d.candidates, dS, d.targets, { grid: this.gridOpts() });
          dS = r.dS;
          if (r.kind && r.mark) this.snapMark = { p: r.mark, kind: r.kind };
        }
        for (const el of this.selection) this.translateBy(d.gesture, el, dS);
        break;
      }
      case 'resize': this.resizeTo(d, s, m); break;
      case 'rotate': {
        let a = ((Math.atan2(s.y - d.pivotS.y, s.x - d.pivotS.x) - d.a0) * 180) / Math.PI;
        if (d.flip) a = -a;
        if (m.shift) a = Math.round(a / 15) * 15;
        d.gesture.reset(d.el);
        d.gesture.preview(d.el, { transform: prependRotate(d.origT, a, d.pivotParent) });
        break;
      }
      case 'pivot': this.pivots.set(d.el, matApply(matInvert(d.M), s)); break;
      case 'marquee':
        this.marquee = rectFromPoints([d.startS, s]);
        break;
      case 'click': break;
    }
    this.render();
    if (d.type !== 'pan' && d.type !== 'marquee' && d.type !== 'pivot') this.emit('change');
  }

  /** Reference points (selection box) and targets (everything else) for snapping a move. */
  private moveSnapState(): { candidates: Vec[]; targets: Vec[] } {
    const els = this.selection.filter((e) => e.isConnected && e.parentElement);
    const P = els[0]?.parentElement && this.screenMat(els[0].parentElement);
    if (!els.length || !P) return { candidates: [], targets: [] };
    const box = unionRect(els.map((e) => this.getBox(e)?.box ?? { x: 0, y: 0, width: 0, height: 0 }));
    return { candidates: boxCandidates(box, P), targets: this.snapTargets(new Map(), els) };
  }

  private movePointsBy(g: Gesture, el: Element, ids: string[], dS: Vec): void {
    const a = adapterFor(el), M = this.screenMat(el);
    if (!a?.movePoints || !M) return;
    g.reset(el);
    g.preview(el, a.movePoints(el, ids, matApply(matInvert(linear(M)), dS)));
  }

  private translateBy(g: Gesture, el: Element, dS: Vec): void {
    const a = adapterFor(el), M = this.screenMat(el);
    if (!a || !M) return;
    g.reset(el);
    const native = a.translate?.(el, matApply(matInvert(linear(M)), dS));
    if (native) { g.preview(el, native); return; }
    const P = el.parentElement && this.screenMat(el.parentElement);
    if (!P) return;
    g.preview(el, { transform: prependTranslate(el.getAttribute('transform'), matApply(matInvert(linear(P)), dS)) });
  }

  /** Bounding box resize (Task_41): native attributes when possible, otherwise transform. */
  private resizeTo(d: Extract<DragState, { type: 'resize' }>, s: Vec, m: Modifiers): void {
    const a = adapterFor(d.el)!;
    const isCorner = d.h.length === 2;
    const toTransform = !a.resize || hasRotationOrSkew(d.origT) || (a.edgeResizeUsesTransform && !isCorner);
    const uniform = a.uniformOnly || (a.edgeResizeUsesTransform && isCorner);
    // Snap the moving handle (not the pointer), so the box edge lands on the target or grid.
    const h0 = matApply(d.M, handlePos(d.box, d.h));
    const hs = this.snap(add(h0, sub(s, d.startS)), d.targets, m);
    const target = matApply(matInvert(d.M), hs);
    const box = dragBox(d.box, d.h, target, { shift: m.shift || !!uniform, alt: m.alt });
    d.gesture.reset(d.el);
    let patch: AttrPatch | null = null;
    if (!toTransform) patch = a.resize!(d.el, d.box, box);
    if (!patch) patch = { transform: matrixString(matMul(parseTransform(d.origT), boxMap(d.box, box))) };
    d.gesture.preview(d.el, patch);
  }

  private pointerUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.snapMark = null;
    if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);
    if (this.toolDown) {
      this.toolDown = false;
      if (this.toolId !== 'select') this.tools[this.toolId].pointerUp(this.toolEvent(e, this.local(e)));
      this.snapMark = null;
      this.render();
      this.emit('change');
      return;
    }
    if (!d) return;
    switch (d.type) {
      case 'point':
        if (d.moved) this.commit(d.gesture, d.materialised ? 'Insert point' : 'Drag point');
        else if (d.materialised) { d.gesture.cancel(); this.selectedPoints.delete(d.el); } // click without movement cancels
        break;
      case 'click':
        if (!d.moved) {
          const patch = adapterFor(d.el)?.clickPoint?.(d.el, d.point.id);
          if (patch) { const g = new Gesture(); g.preview(d.el, patch); this.commit(g, 'Toggle arc flags'); }
        }
        break;
      case 'move': case 'resize': case 'rotate':
        if (d.moved) this.commit(d.gesture, d.type === 'move' ? 'Move' : d.type === 'resize' ? 'Resize' : 'Rotate');
        break;
      case 'marquee': {
        const r = this.marquee;
        this.marquee = null;
        if (!d.moved || !r) {
          if (!d.additive) { this.selection = []; this.selectedPoints.clear(); }
          break;
        }
        this.marqueeSelect(r, d.additive);
        break;
      }
      default: break;
    }
    this.render();
    this.emit('change');
  }

  private marqueeSelect(r: Rect, additive: boolean): void {
    const inside = (p: Vec) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
    if (!additive) this.selectedPoints.clear();
    let found = 0;
    for (const el of this.selection) {
      const a = adapterFor(el), M = this.screenMat(el);
      if (!a || !M) continue;
      const ids = a.getPoints(el).filter((p) => p.kind === 'anchor' && inside(matApply(M, p))).map((p) => p.id);
      if (!ids.length) continue;
      const set = this.selectedPoints.get(el) ?? new Set();
      ids.forEach((id) => set.add(id));
      this.selectedPoints.set(el, set);
      found += ids.length;
    }
    if (found) return;
    const scope = this.scope ?? this.doc!;
    const hits: Element[] = [];
    for (const el of Array.from(scope.children)) {
      if (this.isLocked(el)) continue;
      const a = adapterFor(el), M = this.screenMat(el);
      if (!a || !M) continue;
      const b = a.getBBox(el);
      const sb = rectFromPoints([[0, 0], [1, 0], [1, 1], [0, 1]].map(([fx, fy]) => matApply(M, { x: b.x + b.width * fx, y: b.y + b.height * fy })));
      if (sb.x < r.x + r.width && sb.x + sb.width > r.x && sb.y < r.y + r.height && sb.y + sb.height > r.y) hits.push(el);
    }
    this.selection = additive ? [...new Set([...this.selection, ...hits])] : hits;
  }

  private commit(g: Gesture, label: string): void {
    this.lastChanged = g.commit(this.history, label);
  }

  private doubleClick(e: MouseEvent): void {
    const s = this.local(e);
    const h = this.hitHandle(s);
    if (h && h.point.kind !== 'bounding') {
      const patch = adapterFor(h.el)?.doubleClickPoint?.(h.el, h.point.id);
      if (patch) { const g = new Gesture(); g.preview(h.el, patch); this.commit(g, 'Node type'); }
      this.render(); this.emit('change');
      return;
    }
    if (this.toolId !== 'select') return;
    // The pointer is captured by the host on pointerdown, so click/dblclick are retargeted to it:
    // hit-test the element actually under the pointer instead of using e.target.
    const under = this.host.ownerDocument.elementFromPoint(e.clientX, e.clientY);
    const el = this.pickFrom(under, s);
    if (el?.localName === 'text') { this.editText(el as SVGTextElement, { at: { x: e.clientX, y: e.clientY } }); return; }
    if (el?.localName === 'use' && !this.defEdit) { this.editDefinitionOf(el); return; }
    if (!el && this.defEdit) { this.exitDefinition(); return; } // double-click outside: done
    if (el && isGroup(el)) {
      // Enter the group so child shapes expose their editor points.
      this.scope = el;
      const child = this.pickFrom(under, s);
      this.selection = child ? [child] : [];
      this.selectedPoints.clear();
      this.render(); this.emit('change');
    }
  }

  // ---------------------------------------------------------------- tools (M1)

  get tool(): ToolId { return this.toolId; }

  /** True while a tool has unfinished work (e.g. a pen path being built). */
  get toolBusy(): boolean { return this.toolId !== 'select' && !!this.tools[this.toolId].busy?.(); }

  setTool(id: ToolId): void {
    if (id === this.toolId) return;
    // Switching away from an unfinished construction keeps it (pen path), like Enter would.
    if (this.toolId !== 'select') this.tools[this.toolId].commitPending?.();
    if (id === this.toolId) return;
    this.cancelTool();
    this.toolId = id;
    this.host.dataset.tool = id;
    this.hoverSeg = null;
    this.render();
    this.emit('tool', id);
    this.emit('change');
  }

  /** Abandon in-progress tool work and inline text editing. */
  cancelTool(): void {
    this.textEditor?.commit();
    if (this.toolId !== 'select') this.tools[this.toolId].cancel();
    this.toolDown = false;
  }

  /** Edit an existing <text> inline (Select double-click, Text tool click). */
  editText(el: SVGTextElement, opts: { isNew?: boolean; at?: Vec } = {}): void {
    if (!opts.isNew && Array.from(el.childNodes).some((n) => n.nodeType === Node.ELEMENT_NODE)) {
      this.emit('status', 'This text has <tspan> children; edit it in the attribute inspector.');
      return;
    }
    this.selection = opts.isNew ? [] : [el];
    this.selectedPoints.clear();
    this.render();
    this.textEditor.open(el, !!opts.isNew, opts.at);
    this.emit('change');
  }

  private textEdited(el: SVGTextElement, text: string | null, isNew: boolean): void {
    if (isNew) {
      this.previews.delete(el);
      if (!text || !text.trim()) { el.remove(); this.render(); this.emit('change'); return; }
      el.textContent = text;
      el.remove();
      this.insertElement(el, 'Add text', this.scopeElement());
      this.setTool('select');
      return;
    }
    if (text === null || text === (el.textContent ?? '')) { this.render(); this.emit('change'); return; }
    if (!text.trim()) {
      this.history.replace('Delete text', [[el, null]]);
      this.selection = [];
    } else {
      const next = el.cloneNode(false) as SVGTextElement;
      next.textContent = text;
      this.history.replace('Edit text', [[el, next]]);
      this.selection = [next];
    }
    this.render();
    this.emit('change');
  }

  private scopeElement(): Element {
    if (!this.scope || !this.scope.isConnected) this.scope = this.doc;
    return this.scope!;
  }

  private toolEvent(e: PointerEvent, s: Vec): ToolEvent {
    const M = this.screenMat(this.scopeElement());
    const inv = M ? matInvert(M) : null;
    const toLocal = (q: Vec) => (inv ? matApply(inv, q) : q);
    const m = mods(e);
    let snapped = s;
    if (this.settings.snap) {
      this.toolTargets ??= this.snapTargets(new Map());
      snapped = this.snap(s, this.toolTargets, m);
    }
    return { s, p: toLocal(snapped), raw: toLocal(s), mods: m, target: e.target, client: { x: e.clientX, y: e.clientY } };
  }

  /** Insert `el` at the top of `parent` as one undo step and select it. */
  private insertElement(el: Element, label: string, parent: Element): void {
    this.history.replace(label, [[null, el, parent]]);
    this.selection = [el];
    this.selectedPoints.clear();
    this.lastChanged = new Map([[el, new Set(Array.from(el.attributes).map((a) => a.name))]]);
  }

  private toolHost(): ToolHost {
    const ed = this;
    return {
      options: this.toolOptions,
      get hostElement() { return ed.host; },
      scope: () => this.scopeElement(),
      toScreen: (p) => { const M = this.screenMat(this.scopeElement()); return M ? matApply(M, p) : p; },
      toLocal: (q) => { const M = this.screenMat(this.scopeElement()); return M ? matApply(matInvert(M), q) : q; },
      unitsPerPx: () => {
        const M = this.screenMat(this.scopeElement());
        const det = M ? Math.abs(M[0] * M[3] - M[1] * M[2]) : 1;
        return det ? 1 / Math.sqrt(det) : 1;
      },
      create: (tag, attrs, kind) => {
        const el = document.createElementNS(this.doc?.namespaceURI ?? SVGNS, tag) as SVGElement;
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, typeof v === 'number' ? fmt(v) : v);
        if (kind) for (const [k, v] of Object.entries(this.defaultStyle[kind])) el.setAttribute(k, v);
        return el;
      },
      attachPreview: (el) => { this.previews.add(el); this.scopeElement().appendChild(el); },
      detachPreview: (el) => { this.previews.delete(el); el.remove(); },
      commit: (el, label) => {
        this.previews.delete(el);
        el.remove();
        this.insertElement(el, label, this.scopeElement());
        this.toolId = 'select'; // setTool would cancel the (finished) tool again
        this.host.dataset.tool = 'select';
        this.render();
        this.emit('tool', 'select');
        this.emit('change');
      },
      render: () => this.render(),
      status: (msg) => this.emit('status', msg),
      editText: (el, opts) => this.editText(el, opts),
    };
  }

  // ---------------------------------------------------------------- definitions (symbols, defs)

  /** The definition being edited on the canvas, if any. */
  get definition(): DefinitionEdit | null { return this.defEdit; }

  /** Root of the layer tree while editing a definition (the symbol / group, or a shape's parent). */
  get definitionScope(): Element | null { return this.defContainer(); }

  /** Where shapes live while editing a definition: the symbol/group itself, or a shape's parent. */
  private defContainer(): Element | null {
    const d = this.defEdit;
    if (!d) return null;
    return d.kind === 'symbol' || isGroup(d.target) ? d.target : d.target.parentElement;
  }

  /** Pick a shape at a screen point. Inside a definition the DOM can't hit-test (clicks land on the <use>). */
  private pickFrom(target: EventTarget | null, s: Vec): Element | null {
    const d = this.defEdit;
    if (!d) return this.pickElement(target);
    const container = this.defContainer()!;
    if (!this.scope || !(this.scope === container || container.contains(this.scope))) this.scope = container;
    const candidates = container === d.target || this.scope !== container ? Array.from(this.scope.children) : [d.target];
    for (let i = candidates.length - 1; i >= 0; i--) {
      const el = candidates[i];
      const a = adapterFor(el), M = this.screenMat(el);
      if (!a || !M || this.isLocked(el) || this.isHidden(el)) continue;
      const b = a.getBBox(el);
      const q = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([fx, fy]) => matApply(M, { x: b.x + b.width * fx, y: b.y + b.height * fy }));
      if (pointInQuad(s, q, Math.max(3, HIT / 2))) return el;
    }
    return null;
  }

  /** Edit the definition a <use> points at, through that instance. */
  editDefinitionOf(use: Element): boolean {
    const target = this.doc && hrefTarget(this.doc, use);
    if (!target) { this.emit('status', 'This <use> doesn\u2019t point at an element in this document.'); return false; }
    this.editDefinition(target, use);
    return true;
  }

  /**
   * Edit a symbol or reusable shape on the canvas. With an instance, its shapes appear where that
   * instance is; without one, at the document origin. Every instance updates live.
   */
  editDefinition(target: Element, instance: Element | null = null): void {
    const doc = this.doc;
    if (!doc || !doc.contains(target)) return;
    this.commitLive();
    this.cancelTool();
    if (this.defEdit) this.exitDefinition(false);
    // Instance local space → document user space (identity without an instance: placed at the origin).
    let toDoc: Mat = [1, 0, 0, 1, 0, 0];
    if (instance) {
      const D = this.domScreenMat(doc), U = this.domScreenMat(instance);
      if (D && U) toDoc = matMul(matInvert(D), U);
    }
    this.defEdit = { target, instance, placement: matMul(toDoc, instanceMatrix(target, instance)), kind: definitionKind(target) };
    this.host.classList.add('def-editing');
    const container = this.defContainer()!;
    this.scope = container;
    this.selection = container === target ? [] : [target];
    this.selectedPoints.clear();
    const n = usersOf(doc, target.id).length;
    this.emit('status', `Editing #${target.id}${n > 1 ? ` \u2014 all ${n} instances update` : ''}. Esc when done.`);
    this.emit('definition');
    this.done();
  }

  exitDefinition(selectInstance = true): void {
    const d = this.defEdit;
    if (!d) return;
    this.defEdit = null;
    this.host.classList.remove('def-editing');
    const inst = d.instance && d.instance.isConnected ? d.instance : null;
    this.scope = (inst?.parentElement as Element | null) ?? this.doc;
    this.selection = selectInstance && inst ? [inst] : [];
    this.selectedPoints.clear();
    this.emit('status', '');
    this.emit('definition');
    this.done();
  }

  /** Dim the drawing and redraw the edited definition, at its instance, above it. */
  private renderDefinition(): void {
    const d = this.defEdit!, doc = this.doc!;
    const D = this.domScreenMat(doc);
    if (!D || !d.target.id) return;
    const use = svg('use', { href: `#${d.target.id}`, class: 'def-instance' }, this.overlay);
    if (d.instance) {
      const U = this.domScreenMat(d.instance);
      if (U) use.setAttribute('transform', matrixString(U));
      for (const a of ['x', 'y', 'width', 'height']) { const v = d.instance.getAttribute(a); if (v !== null) use.setAttribute(a, v); }
    } else {
      use.setAttribute('transform', matrixString(D));
      const vb = d.target.localName === 'symbol' ? parseViewBox(d.target) : null;
      if (vb) { use.setAttribute('width', String(vb.width)); use.setAttribute('height', String(vb.height)); }
    }
  }

  /** Select a definition (gradient, stop, filter…) for the inspector; it has no canvas handles. */
  inspect(el: Element): void {
    if (!this.doc?.contains(el)) return;
    this.commitLive();
    if (this.defEdit && !(this.defEdit.target === el || this.defEdit.target.contains(el))) this.exitDefinition(false);
    this.selection = [el];
    this.selectedPoints.clear();
    this.done();
  }

  /** Definitions an element references, existing ones only. */
  definitionRefs(el: Element): { id: string; attr: string }[] {
    return this.doc ? referencesFrom(el).filter((r) => byId(this.doc!, r.id)) : [];
  }

  /**
   * Go to what `el` references: a <use> enters its definition; a url(#…) paint, filter, clip path,
   * marker or mask selects that definition. `id` picks one when there are several.
   */
  goToDefinition(el: Element | null = this.selection[0] ?? null, id?: string): boolean {
    const doc = this.doc;
    if (!doc || !el) return false;
    if (el.localName === 'use' && (!id || hrefTarget(doc, el)?.id === id) && hrefTarget(doc, el)) return this.editDefinitionOf(el);
    const ref = this.definitionRefs(el).find((r) => !id || r.id === id);
    const def = ref && byId(doc, ref.id);
    if (!def) { this.emit('status', 'Nothing to go to: this element references no definition.'); return false; }
    if (definitionKind(def) === 'symbol' || (definitionKind(def) === 'shape' && adapterFor(def))) this.editDefinition(def, null);
    else this.inspect(def);
    return true;
  }

  // ---------------------------------------------------------------- arrange (M3)

  /** Selected elements that are still in the document, in document order. */
  private ordered(): Element[] {
    return this.selection
      .filter((e) => e.isConnected && e.parentElement && e !== this.doc)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }

  private done(): void { this.selectedPoints.clear(); this.render(); this.emit('change'); }

  isLocked(el: Element): boolean {
    for (let n: Element | null = el; n && n !== this.doc; n = n.parentElement) if (this.locked.has(n)) return true;
    return false;
  }

  unlockAll(): void {
    if (!this.doc) return;
    for (const el of [this.doc, ...Array.from(this.doc.querySelectorAll('*'))]) this.locked.delete(el);
    this.done();
  }

  setLocked(els: Element[], locked: boolean): void {
    for (const el of els) { if (locked) this.locked.add(el); else this.locked.delete(el); }
    if (locked) this.selection = this.selection.filter((e) => !this.isLocked(e));
    this.done();
  }

  setHidden(els: Element[], hidden: boolean): void {
    this.applyPatches(() => els.map((el) => [el, stylePatch(el, 'display', hidden ? 'none' : null)]), hidden ? 'Hide' : 'Show');
  }

  isHidden(el: Element): boolean {
    return el.getAttribute('display') === 'none' || /(^|;)\s*display\s*:\s*none/i.test(el.getAttribute('style') ?? '');
  }

  /** Select an element anywhere in the document, entering its parent group. */
  selectElement(el: Element, additive = false): void {
    if (!this.doc || !this.doc.contains(el) || el === this.doc) return;
    const c = this.defContainer();
    if (this.defEdit && c && !(el === this.defEdit.target || this.defEdit.target.contains(el) || c.contains(el))) this.exitDefinition(false);
    const parent = el.parentElement!;
    if (parent !== this.scope) { this.scope = parent; this.selection = []; }
    this.selection = additive ? (this.selection.includes(el) ? this.selection.filter((e) => e !== el) : [...this.selection, el]) : [el];
    this.done();
  }

  selectAll(): void {
    const scope = this.scopeElement();
    this.selection = Array.from(scope.children).filter((e) => adapterFor(e) && !this.isLocked(e) && !this.isHidden(e));
    this.done();
  }

  zOrder(op: 'forward' | 'backward' | 'front' | 'back'): void {
    const els = this.ordered();
    if (!els.length || els.some((e) => e.parentElement !== els[0].parentElement)) return;
    const parent = els[0].parentElement!;
    const moves = planZOrder(els, op);
    const labels = { forward: 'Bring forward', backward: 'Send backward', front: 'Bring to front', back: 'Send to back' };
    this.history.mutate(labels[op], moves.flatMap((m): MutateOp[] => [{ type: 'remove', el: m.el }, { type: 'insert', el: m.el, parent, before: m.before }]));
    this.done();
  }

  /** Move elements to `parent` before `before` (layers drag and drop) as one undo step. */
  moveElements(els: Element[], parent: Element, before: Node | null): void {
    const list = els.filter((e) => e !== parent && !e.contains(parent) && e !== before);
    if (!list.length) return;
    this.history.mutate('Move in layers', list.flatMap((el): MutateOp[] => [{ type: 'remove', el }, { type: 'insert', el, parent, before }]));
    this.done();
  }

  group(): void {
    const els = this.ordered();
    if (!els.length || els.some((e) => e.parentElement !== els[0].parentElement)) return;
    const parent = els[0].parentElement!;
    const g = document.createElementNS(this.doc?.namespaceURI ?? SVGNS, 'g');
    const ops: MutateOp[] = [{ type: 'insert', el: g, parent, before: els[els.length - 1].nextSibling }];
    for (const el of els) ops.push({ type: 'remove', el }, { type: 'insert', el, parent: g, before: null });
    this.history.mutate('Group', ops);
    this.selection = [g];
    this.done();
  }

  ungroup(): void {
    const groups = this.ordered().filter((e) => isGroup(e));
    const ops: MutateOp[] = [];
    const next: Element[] = [];
    for (const g of groups) {
      const why = ungroupBlocker(g);
      if (why) { this.emit('status', `Can't ungroup: ${why}.`); continue; }
      const kids = ungroupChildren(g);
      for (const k of kids) ops.push({ type: 'insert', el: k, parent: g.parentNode!, before: g });
      ops.push({ type: 'remove', el: g });
      next.push(...kids);
    }
    if (!ops.length) return;
    this.history.mutate('Ungroup', ops);
    this.selection = [...this.selection.filter((e) => e.isConnected), ...next];
    this.done();
  }

  canUngroup(): boolean { return this.selection.some((e) => isGroup(e)); }

  /** Patch that moves `el` by `d` in its parent's user space (native when possible). */
  private translatePatch(el: Element, d: Vec): AttrPatch | null {
    if (Math.abs(d.x) < 1e-9 && Math.abs(d.y) < 1e-9) return null;
    const a = adapterFor(el);
    const T = parseTransform(el.getAttribute('transform'));
    const native = a?.translate?.(el, matApply(matInvert(linear(T)), d));
    return native ?? { transform: prependTranslate(el.getAttribute('transform'), d) };
  }

  private moveBy(els: Element[], deltas: Vec[], label: string): void {
    this.applyPatches(() => els.flatMap((el, i) => { const p = this.translatePatch(el, deltas[i]); return p ? [[el, p] as [Element, AttrPatch]] : []; }), label);
  }

  duplicate(): void {
    const els = this.ordered();
    if (!els.length || !this.doc) return;
    const P = els[0].parentElement && this.screenMat(els[0].parentElement);
    const det = P ? Math.abs(P[0] * P[3] - P[1] * P[2]) : 1;
    const off = 10 / Math.sqrt(det || 1);
    const clones = els.map((el) => el.cloneNode(true) as Element);
    uniquifyIds(clones, collectIds(this.doc));
    const ops: MutateOp[] = [];
    clones.forEach((c, i) => {
      const p = this.translatePatch(c, { x: off, y: off });
      if (p) applyPatch(c, p);
      ops.push({ type: 'insert', el: c, parent: els[i].parentNode!, before: els[i].nextSibling });
    });
    this.history.mutate('Duplicate', ops);
    this.selection = clones;
    this.done();
  }

  /** The page (viewBox) rectangle in `parent`'s user space. */
  private pageIn(parent: Element): Rect {
    const doc = this.doc!;
    const vb = doc.getAttribute('viewBox') ? doc.viewBox.baseVal : null;
    const page = vb && vb.width ? { x: vb.x, y: vb.y, width: vb.width, height: vb.height } : { x: 0, y: 0, ...this.docSize };
    if (parent === doc) return page;
    const D = this.screenMat(doc), Pm = this.screenMat(parent);
    if (!D || !Pm) return page;
    const M = matMul(matInvert(Pm), D);
    return rectFromPoints([[0, 0], [1, 0], [1, 1], [0, 1]].map(([fx, fy]) => matApply(M, { x: page.x + page.width * fx, y: page.y + page.height * fy })));
  }

  /** Align to the selection bounds, or to the page when one element is selected (or `toPage`). */
  align(edge: AlignEdge, toPage = false): void {
    const els = this.ordered();
    if (!els.length) return;
    const boxes = els.map((e) => this.getBox(e)?.box ?? { x: 0, y: 0, width: 0, height: 0 });
    const target = toPage || els.length === 1 ? this.pageIn(els[0].parentElement!) : unionRect(boxes);
    this.moveBy(els, alignDeltas(boxes, edge, target), `Align ${edge}`);
  }

  distribute(axis: 'x' | 'y'): void {
    const els = this.ordered();
    if (els.length < 3) return;
    const boxes = els.map((e) => this.getBox(e)?.box ?? { x: 0, y: 0, width: 0, height: 0 });
    this.moveBy(els, distributeDeltas(boxes, axis), axis === 'x' ? 'Distribute horizontally' : 'Distribute vertically');
  }

  /** Mirror the selection about its centre (prepends a matrix to each transform). */
  flip(axis: 'x' | 'y'): void {
    const els = this.ordered();
    if (!els.length) return;
    const u = unionRect(els.map((e) => this.getBox(e)?.box ?? { x: 0, y: 0, width: 0, height: 0 }));
    const c = { x: u.x + u.width / 2, y: u.y + u.height / 2 };
    const m = axis === 'x' ? `matrix(-1 0 0 1 ${fmt(2 * c.x)} 0)` : `matrix(1 0 0 -1 0 ${fmt(2 * c.y)})`;
    this.applyPatches(() => els.map((el) => {
      const t = el.getAttribute('transform')?.trim();
      return [el, { transform: t ? `${m} ${t}` : m }];
    }), axis === 'x' ? 'Flip horizontal' : 'Flip vertical');
  }

  /** Rename an element id (empty removes it). Returns an error message or null. */
  setId(el: Element, id: string): string | null {
    const v = id.trim();
    if (v && !/^[A-Za-z_][\w.:-]*$/.test(v)) return 'Ids start with a letter and contain no spaces';
    if (v && v !== el.id && this.doc?.querySelector(`[id="${CSS.escape(v)}"]`)) return `#${v} is already used`;
    this.applyPatches([[el, { id: v || null }]], 'Rename');
    return null;
  }

  // ---------------------------------------------------------------- clipboard (M4)

  /** Matrix from `el`'s user space to document user space. */
  private toRoot(el: Element): Mat | null {
    const D = this.doc && this.screenMat(this.doc), E = this.screenMat(el);
    return D && E ? matMul(matInvert(D), E) : null;
  }

  /** The selection as a standalone SVG clip, or null when nothing is selected. */
  copySelection(): string | null {
    const els = this.ordered();
    if (!els.length || !this.doc) return null;
    const parent: Element = els[0].parentElement!;
    return buildClip(els, this.doc, parent === this.doc ? null : this.toRoot(parent), this.docToken);
  }

  /** Centre of the visible canvas in `parent`'s user space. */
  private viewCenter(parent: Element): Vec {
    const M = this.screenMat(parent);
    const c = { x: this.host.clientWidth / 2, y: this.host.clientHeight / 2 };
    return M ? matApply(matInvert(M), c) : c;
  }

  /** Paste SVG markup into the current scope as one undo step. Returns false when it isn't SVG. */
  paste(text: string): boolean {
    const doc = this.doc;
    if (!doc) return false;
    const clip = parseClip(text);
    if (!clip || !clip.content.length) return false;
    this.commitLive();
    this.cancelTool();
    const scope = this.scopeElement();
    // Definitions the document already has are reused (a pasted <use> points at the existing
    // symbol); only missing or different ones are added. Then clashing ids are renamed.
    const sameDoc = !!clip.docToken && clip.docToken === this.docToken;
    const plan = planDefs(clip.defs, doc, sameDoc);
    clip.defs = plan.insert;
    uniquifyIds([...clip.defs, ...clip.content], collectIds(doc));

    // Curve clips are in document user space: map them into the scope when it is transformed.
    let items = clip.content;
    const wrapT = clip.curve ? (scope === doc ? null : matInvert(this.toRoot(scope)!)) : null;
    if (!clip.curve || wrapT) {
      const g = document.createElementNS(doc.namespaceURI, 'g');
      if (wrapT) g.setAttribute('transform', matrixString(wrapT));
      else if (clip.transform) g.setAttribute('transform', clip.transform);
      for (const el of items) g.appendChild(el);
      items = [g];
    }

    const ops: MutateOp[] = [];
    if (clip.defs.length) {
      let defs = Array.from(doc.children).find((c) => c.localName === 'defs') ?? null;
      if (!defs) {
        defs = document.createElementNS(doc.namespaceURI, 'defs');
        ops.push({ type: 'insert', el: defs, parent: doc, before: doc.firstChild });
      }
      for (const d of clip.defs) ops.push({ type: 'insert', el: d, parent: defs, before: null });
    }
    for (const el of items) ops.push({ type: 'insert', el, parent: scope, before: null });
    this.history.mutate('Paste', ops);

    // Placement: clips copied from this document paste in place; anything else (another
    // document, other apps) goes to the centre of the view. Repeated pastes step down-right.
    const repeat = this.lastPaste?.text === text ? this.lastPaste.count + 1 : 0;
    this.lastPaste = { text, count: repeat };
    let d: Vec = { x: 0, y: 0 };
    if (!sameDoc) {
      const u = unionRect(items.map((e) => this.getBox(e)?.box ?? { x: 0, y: 0, width: 0, height: 0 }));
      const c = this.viewCenter(scope);
      d = { x: c.x - (u.x + u.width / 2), y: c.y - (u.y + u.height / 2) };
    }
    if (repeat) {
      const M = this.screenMat(scope);
      const off = (10 * repeat) / Math.sqrt(Math.abs(M ? M[0] * M[3] - M[1] * M[2] : 1) || 1);
      d = { x: d.x + off, y: d.y + off };
    }
    // The inserted nodes are the history entry's own objects, so these edits persist through undo/redo.
    for (const el of items) { const p = this.translatePatch(el, d); if (p) applyPatch(el, p); }

    this.selection = items;
    const warning = describeReport(clip.report);
    this.emit('status', warning || `Pasted ${clip.content.length} element${clip.content.length > 1 ? 's' : ''}`);
    this.done();
    return true;
  }

  /** Paste a raster image (data URL) as <image>, fitted inside the view and centred. */
  pasteImage(href: string, width: number, height: number): void {
    const doc = this.doc;
    if (!doc) return;
    const scope = this.scopeElement();
    const M = this.screenMat(scope);
    const unit = M ? 1 / Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]) || 1) : 1;
    const maxW = this.host.clientWidth * 0.8 * unit, maxH = this.host.clientHeight * 0.8 * unit;
    const s = Math.min(1, maxW / width, maxH / height);
    const w = width * s, h = height * s;
    const c = this.viewCenter(scope);
    const img = document.createElementNS(doc.namespaceURI, 'image');
    for (const [k, v] of Object.entries({ x: c.x - w / 2, y: c.y - h / 2, width: w, height: h })) img.setAttribute(k, fmt(v));
    img.setAttribute('href', href);
    this.insertElement(img, 'Paste image', scope);
    this.done();
  }

  // ---------------------------------------------------------------- commands

  deleteSelection(): void {
    if (this.pointCount()) {
      const g = new Gesture();
      let refused = false;
      for (const [el, ids] of this.selectedPoints) {
        const a = adapterFor(el);
        const anchors = [...ids].filter((id) => a?.getPoints(el).find((p) => p.id === id)?.kind === 'anchor');
        if (!anchors.length || !a?.deletePoint) continue;
        const patch = a.deletePoint(el, anchors);
        if (patch) g.preview(el, patch); else refused = true;
      }
      if (refused) this.emit('status', 'Deletion refused: the shape would have too few points.');
      this.commit(g, 'Delete points');
      this.selectedPoints.clear();
    } else if (this.selection.length) {
      this.history.replace('Delete', this.selection.map((el) => [el, null] as [Element, null]));
      this.selection = [];
    }
    this.render(); this.emit('change');
  }

  convert(kind: 'path' | 'ellipse'): void {
    const pairs: [Element, Element][] = [];
    for (const el of this.selection) {
      const n = kind === 'path' ? convertToPath(el) : convertToEllipse(el);
      if (n) pairs.push([el, n]);
    }
    if (!pairs.length) return;
    this.history.replace(kind === 'path' ? 'Convert to path' : 'Convert to ellipse', pairs);
    this.selection = this.selection.map((el) => pairs.find((p) => p[0] === el)?.[1] ?? el);
    this.selectedPoints.clear();
    this.render(); this.emit('change');
  }

  canConvert(kind: 'path' | 'ellipse'): boolean {
    return this.selection.some((el) => (kind === 'path' ? canConvertToPath(el) : el.localName === 'circle'));
  }

  undo(): void { this.commitLive(); this.history.undo(); this.pruneSelection(); this.lastChanged.clear(); this.render(); this.emit('change'); }
  redo(): void { this.commitLive(); this.history.redo(); this.pruneSelection(); this.lastChanged.clear(); this.render(); this.emit('change'); }

  // ---------------------------------------------------------------- inspector edits (M2)

  /**
   * Apply attribute patches. With `live`, the change stays an open preview (e.g. while a colour
   * picker is dragged) until commitLive(); all previews with the same label become one undo step.
   */
  applyPatches(patches: [Element, AttrPatch][] | (() => [Element, AttrPatch][]), label: string, live = false): void {
    if (this.live && this.live.label !== label) this.commitLive();
    const g = (this.live ??= { gesture: new Gesture(), label }).gesture;
    // Patches computed by `patches()` see the pre-gesture state (open previews are reset first),
    // so a patch is always relative to the document before this edit began.
    if (typeof patches === 'function') { for (const el of g.elements) g.reset(el); patches = patches(); }
    for (const [el, patch] of patches) g.preview(el, patch);
    if (!live) this.commitLive();
    else { this.render(); this.emit('change'); }
  }

  /** Record the open live preview as one undo step. */
  commitLive(): void {
    const l = this.live;
    if (!l) return;
    this.live = null;
    this.commit(l.gesture, l.label);
    this.render();
    this.emit('change');
  }

  /** Set a presentation property on elements, editing it where each element defines it. */
  setStyle(els: Element[], prop: string, value: string | null, live = false): void {
    this.applyPatches(() => els.map((el) => [el, stylePatch(el, prop, value)]), `Set ${prop}`, live);
  }

  /** Element box in its parent's user space, plus rotation (degrees) from its transform. */
  getBox(el: Element): { box: Rect; rotation: number; rotated: boolean } | null {
    const a = adapterFor(el);
    if (!a) return null;
    const T = parseTransform(el.getAttribute('transform'));
    const b = a.getBBox(el);
    const box = rectFromPoints([[0, 0], [1, 0], [1, 1], [0, 1]].map(([fx, fy]) => matApply(T, { x: b.x + b.width * fx, y: b.y + b.height * fy })));
    return { box, rotation: (Math.atan2(T[1], T[0]) * 180) / Math.PI, rotated: hasRotationOrSkew(el.getAttribute('transform')) };
  }

  /**
   * Move / resize an element to `to` (parent user space). Unrotated shapes are resized natively
   * where the adapter can; rotated or skewed shapes can only move (a translate is prepended).
   */
  setBox(el: Element, to: Rect, live = false): void {
    this.applyPatches(() => {
      const p = this.boxPatch(el, to);
      return p ? [[el, p]] : [];
    }, 'Move / resize', live);
  }

  private boxPatch(el: Element, to: Rect): AttrPatch | null {
    const a = adapterFor(el), cur = this.getBox(el);
    if (!a || !cur) return null;
    const origT = el.getAttribute('transform');
    let patch: AttrPatch | null = null;
    if (cur.rotated) {
      const d = { x: to.x - cur.box.x, y: to.y - cur.box.y };
      if (Math.abs(d.x) < 1e-9 && Math.abs(d.y) < 1e-9) return null;
      patch = { transform: prependTranslate(origT, d) };
    } else {
      const inv = matInvert(parseTransform(origT));
      const local = rectFromPoints([matApply(inv, { x: to.x, y: to.y }), matApply(inv, { x: to.x + to.width, y: to.y + to.height })]);
      const from = a.getBBox(el);
      patch = a.resize?.(el, from, local) ?? null;
      if (!patch) patch = { transform: matrixString(matMul(parseTransform(origT), boxMap(from, local))) };
    }
    return patch;
  }

  /** Rotate an element about its box centre to an absolute angle (degrees). */
  setRotation(el: Element, deg: number, live = false): void {
    this.applyPatches(() => {
      const cur = this.getBox(el);
      if (!cur) return [];
      const d = deg - cur.rotation;
      if (Math.abs(d) < 1e-9) return [];
      const c = { x: cur.box.x + cur.box.width / 2, y: cur.box.y + cur.box.height / 2 };
      return [[el, { transform: prependRotate(el.getAttribute('transform'), d, c) }]];
    }, 'Rotate', live);
  }

  /** Arrow-key nudge: 1 screen pixel (Shift = 10), mapped to local space (Task_44). */
  nudge(dS: Vec): void {
    const g = new Gesture();
    if (this.pointCount()) for (const [el, ids] of this.selectedPoints) this.movePointsBy(g, el, [...ids], dS);
    else for (const el of this.selection) this.translateBy(g, el, dS);
    this.commit(g, 'Nudge');
    this.render(); this.emit('change');
  }

  private keyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (cmd && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
    if (e.code === 'Space') { this.spaceDown = true; this.host.classList.add('panning'); e.preventDefault(); return; }
    if (!this.doc) return;
    if (this.toolId !== 'select' && !cmd) {
      const tool = this.tools[this.toolId];
      if (tool.keyDown?.(e)) { e.preventDefault(); this.render(); this.emit('change'); return; }
      if (e.key === 'Escape') { e.preventDefault(); this.setTool('select'); return; }
    }
    switch (e.key) {
      case 'Delete': case 'Backspace': e.preventDefault(); this.deleteSelection(); break;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        if (!this.selection.length) return;
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1;
        this.nudge({ x: e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, y: e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0 });
        break;
      }
      case 'Escape':
        if (this.pointCount()) this.selectedPoints.clear();
        else if (this.defEdit && this.scope === this.defContainer()) {
          // First Esc clears the selection inside the definition, the next one leaves it.
          if (this.selection.length && this.defContainer() === this.defEdit.target) this.selection = [];
          else { this.exitDefinition(); return; }
        }
        else if (this.scope && this.scope !== this.doc) { this.selection = [this.scope]; this.scope = (this.scope.parentNode as Element | null) ?? this.doc; }
        else this.selection = [];
        this.render(); this.emit('change');
        break;
    }
  }

  private contextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (!this.doc) return;
    const s = this.local(e);
    const items: MenuItem[] = [];
    const run = (patch: AttrPatch | null, el: Element, label: string) => {
      if (!patch) return;
      const g = new Gesture(); g.preview(el, patch); this.commit(g, label); this.render(); this.emit('change');
    };
    const h = this.hitHandle(s);
    if (h && h.point.kind !== 'bounding') {
      const a = adapterFor(h.el)!;
      if (!this.selectedPoints.get(h.el)?.has(h.point.id)) { this.selectedPoints = new Map([[h.el, new Set([h.point.id])]]); this.render(); }
      for (const it of a.pointMenu?.(h.el, h.point.id) ?? []) items.push({ label: it.label, checked: it.checked, run: () => run(it.run(), h.el, it.label) });
      if (h.point.kind === 'anchor' && a.deletePoint) items.push({ label: 'Delete point', run: () => this.deleteSelection() });
    } else {
      const el = this.pickFrom(e.target, s);
      if (el && !this.selection.includes(el)) { this.selection = [el]; this.selectedPoints.clear(); this.render(); this.emit('change'); }
      if (!this.selection.length) {
        if (this.defEdit) items.push({ label: 'Done editing definition', run: () => this.exitDefinition() });
        if (items.length) this.emit('menu', items, e.clientX, e.clientY);
        return;
      }
      const one = this.selection.length === 1 ? this.selection[0] : null;
      if (one?.localName === 'use' && this.doc && hrefTarget(this.doc, one)) {
        items.push({ label: `Edit ${definitionKind(hrefTarget(this.doc, one)!) === 'symbol' ? 'symbol' : 'definition'} #${hrefTarget(this.doc, one)!.id}`, run: () => this.editDefinitionOf(one) });
      }
      if (one) for (const r of this.definitionRefs(one)) {
        if (one.localName === 'use' && (r.attr === 'href' || r.attr === 'xlink:href')) continue;
        items.push({ label: `Go to #${r.id} (${r.attr})`, run: () => this.goToDefinition(one, r.id) });
      }
      if (this.defEdit) items.push({ label: 'Done editing definition', run: () => this.exitDefinition() });
      items.push({ label: 'Duplicate', run: () => this.duplicate() });
      items.push({ label: 'Bring to front', run: () => this.zOrder('front') });
      items.push({ label: 'Send to back', run: () => this.zOrder('back') });
      items.push({ label: 'Group', run: () => this.group() });
      if (this.canUngroup()) items.push({ label: 'Ungroup', run: () => this.ungroup() });
      items.push({ label: 'Convert to path', disabled: !this.canConvert('path'), run: () => this.convert('path') });
      if (this.selection.some((x) => x.localName === 'circle')) items.push({ label: 'Convert to ellipse', run: () => this.convert('ellipse') });
      if (this.selection.length === 1 && isGroup(this.selection[0])) {
        const g = this.selection[0];
        items.push({ label: 'Enter group', run: () => { this.scope = g; this.selection = []; this.render(); this.emit('change'); } });
      }
      items.push({ label: 'Delete', run: () => this.deleteSelection() });
    }
    if (items.length) this.emit('menu', items, e.clientX, e.clientY);
  }

  applyAttr(el: Element, patch: AttrPatch, label: string): void {
    const g = new Gesture(); g.preview(el, patch); this.commit(g, label); this.render(); this.emit('change');
  }

  /** Points of a selected element, for the inspector. */
  pointsOf(el: Element): EditorPoint[] { return adapterFor(el)?.getPoints(el) ?? []; }
}
