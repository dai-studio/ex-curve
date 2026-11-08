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
  type Mat,
} from '../geom';
import { Gesture } from './gesture';

const SVGNS = 'http://www.w3.org/2000/svg';
const SHAPES = 'rect,circle,ellipse,line,polyline,polygon,path,text,image,foreignObject,use,svg,g,a,switch';
// Rule "Handles are screen-sized": glyphs 8px (anchor/parameter/move) and 6px (control/ghost); hit area 12px.
const HIT = 6;
const SNAP_RADIUS = 6;
const DRAG_THRESHOLD = 3;
const ROT_OFFSET = 22;
const PRIORITY: Record<string, number> = { anchor: 0, move: 1, parameter: 1, control: 2, ghost: 3, bounding: 4 };

export interface Handle { el: Element; point: EditorPoint; s: Vec }

interface Base { startS: Vec; moved: boolean }
type DragState = Base & (
  | { type: 'point'; el: Element; point: EditorPoint; M: Mat; gesture: Gesture; materialised: boolean; multi: boolean; targets: Vec[] }
  | { type: 'click'; el: Element; point: EditorPoint }
  | { type: 'move'; gesture: Gesture }
  | { type: 'resize'; el: Element; h: BoxHandle; box: Rect; M: Mat; gesture: Gesture; origT: string | null }
  | { type: 'rotate'; el: Element; pivotS: Vec; pivotParent: Vec; a0: number; flip: boolean; gesture: Gesture; origT: string | null }
  | { type: 'pivot'; el: Element; M: Mat }
  | { type: 'marquee'; additive: boolean }
  | { type: 'pan'; v0: { x: number; y: number } }
);

export interface MenuItem { label: string; checked?: boolean; disabled?: boolean; run: () => void }

const linear = (m: Mat): Mat => [m[0], m[1], m[2], m[3], 0, 0];
const mods = (e: MouseEvent | KeyboardEvent): Modifiers => ({ shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey });

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

/** Prepend a transform function, merging with a leading function of the same kind. */
function prependTranslate(orig: string | null, d: Vec): string {
  const m = /^\s*translate\(\s*([-+\d.eE]+)(?:[\s,]+([-+\d.eE]+))?\s*\)\s*(.*)$/.exec(orig ?? '');
  if (m) return `translate(${fmt(+m[1] + d.x)} ${fmt(+(m[2] ?? 0) + d.y)})${m[3] ? ' ' + m[3] : ''}`;
  return `translate(${fmt(d.x)} ${fmt(d.y)})${orig ? ' ' + orig : ''}`;
}

function prependRotate(orig: string | null, a: number, p: Vec): string {
  const m = /^\s*rotate\(\s*([-+\d.eE]+)[\s,]+([-+\d.eE]+)[\s,]+([-+\d.eE]+)\s*\)\s*(.*)$/.exec(orig ?? '');
  if (m && Math.abs(+m[2] - p.x) < 1e-3 && Math.abs(+m[3] - p.y) < 1e-3) {
    return `rotate(${fmt(+m[1] + a)} ${m[2]} ${m[3]})${m[4] ? ' ' + m[4] : ''}`;
  }
  return `rotate(${fmt(a)} ${fmt(p.x)} ${fmt(p.y)})${orig ? ' ' + orig : ''}`;
}

const matrixString = (m: Mat) => `matrix(${m.map((x) => fmt(x, 6)).join(' ')})`;

export class Editor {
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
  settings = { grid: 10, showGrid: false, snapGrid: false, snap: true };
  onChange: () => void = () => {};
  onStatus: (msg: string) => void = () => {};
  onPointer: (docPt: Vec | null) => void = () => {};
  onMenu: (items: MenuItem[], x: number, y: number) => void = () => {};

  private pivots = new WeakMap<Element, Vec>();
  private handles: Handle[] = [];
  private hoverSeg: { el: Element; index: number } | null = null;
  private view = { x: 0, y: 0, zoom: 1 };
  private docSize = { width: 800, height: 600 };
  private drag: DragState | null = null;
  private snapMark: Vec | null = null;
  private marquee: Rect | null = null;
  private spaceDown = false;

  constructor(host: HTMLElement) {
    this.host = host;
    this.canvas = svg('svg', { class: 'canvas' });
    this.page = svg('rect', { class: 'page' }, this.canvas);
    this.wrapper = svg('svg', { overflow: 'visible' }, this.canvas);
    this.overlay = svg('svg', { class: 'overlay' });
    host.append(this.canvas, this.overlay);
    host.addEventListener('pointerdown', (e) => this.pointerDown(e));
    host.addEventListener('pointermove', (e) => this.pointerMove(e));
    host.addEventListener('pointerup', (e) => this.pointerUp(e));
    host.addEventListener('pointercancel', (e) => this.pointerUp(e));
    host.addEventListener('pointerleave', () => this.onPointer(null));
    host.addEventListener('dblclick', (e) => this.doubleClick(e));
    host.addEventListener('contextmenu', (e) => this.contextMenu(e));
    host.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { this.spaceDown = false; this.host.classList.remove('panning'); } });
    new ResizeObserver(() => { this.applyView(); this.render(); }).observe(host);
    this.history.onChange = () => this.onChange();
  }

  // ---------------------------------------------------------------- document

  load(text: string): void {
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = parsed.documentElement;
    if (parsed.getElementsByTagName('parsererror').length || root.localName !== 'svg') {
      throw new Error('Not a valid SVG document');
    }
    const at = text.search(/<svg[\s>]/);
    this.prolog = at > 0 ? text.slice(0, at) : '';
    const doc = document.importNode(root, true) as unknown as SVGSVGElement;
    this.wrapper.replaceChildren(doc);
    this.doc = doc;
    // Canvas renders the document unmodified; a fixed-size wrapper resolves percentage sizes.
    const vb = doc.viewBox?.baseVal;
    const abs = (a: string) => { const v = doc.getAttribute(a); return v && /^[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : 0; };
    this.docSize = {
      width: abs('width') || (vb && vb.width) || 800,
      height: abs('height') || (vb && vb.height) || 600,
    };
    this.wrapper.setAttribute('width', String(this.docSize.width));
    this.wrapper.setAttribute('height', String(this.docSize.height));
    this.page.setAttribute('width', String(this.docSize.width));
    this.page.setAttribute('height', String(this.docSize.height));
    this.scope = doc;
    this.selection = [];
    this.selectedPoints.clear();
    this.lastChanged.clear();
    this.history.clear();
    this.zoomToFit();
    this.onChange();
  }

  serialize(): string {
    if (!this.doc) return '';
    return this.prolog + new XMLSerializer().serializeToString(this.doc);
  }

  // ---------------------------------------------------------------- view (pan / zoom via viewBox)

  zoomToFit(): void {
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
    this.view.zoom = Math.min(256, Math.max(0.02, this.view.zoom * f));
    this.view.x = before.x - p.x / this.view.zoom;
    this.view.y = before.y - p.y / this.view.zoom;
    this.applyView();
    this.render();
  }

  get zoom(): number { return this.view.zoom; }

  private applyView(): void {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.canvas.setAttribute('viewBox', `${this.view.x} ${this.view.y} ${w / this.view.zoom} ${h / this.view.zoom}`);
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
    return n.parentElement === this.scope && adapterFor(n) ? n : null;
  }

  select(els: Element[]): void {
    this.selection = els;
    for (const k of [...this.selectedPoints.keys()]) if (!els.includes(k)) this.selectedPoints.delete(k);
    this.render();
    this.onChange();
  }

  private pruneSelection(): void {
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
    if (this.settings.showGrid) this.renderGrid();
    if (this.scope && this.scope !== this.doc && this.scope.isConnected) this.outline(this.scope, 'scope-box');

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
    if (this.snapMark) {
      const { x, y } = this.snapMark;
      svg('path', { class: 'snap-mark', d: `M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x - 5} ${y + 5}L${x + 5} ${y - 5}` }, o);
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

  private snapTargets(exclude: Map<Element, Set<string>>): Vec[] {
    const out: Vec[] = [];
    if (!this.doc) return out;
    const els = Array.from(this.doc.querySelectorAll(SHAPES)).slice(0, 2000);
    for (const el of els) {
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
      if (!ex && !this.selection.includes(el)) {
        const b = a.getBBox(el);
        for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) out.push(matApply(M, { x: b.x + b.width * fx, y: b.y + b.height * fy }));
      }
    }
    return out;
  }

  private snap(s: Vec, targets: Vec[], m: Modifiers): Vec {
    this.snapMark = null;
    if (m.ctrl || !this.settings.snap) return s; // hold Ctrl to bypass
    let best: Vec | null = null, bd = SNAP_RADIUS;
    for (const t of targets) { const d = dist(s, t); if (d <= bd) { bd = d; best = t; } }
    if (best) { this.snapMark = best; return best; }
    if (this.settings.snapGrid && this.doc) {
      const M = this.screenMat(this.doc);
      if (M) {
        const g = this.settings.grid;
        const p = matApply(matInvert(M), s);
        return matApply(M, { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g });
      }
    }
    return s;
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
    const h = this.hitHandle(s);
    if (h) { this.beginHandle(h, s, e); return; }
    const el = this.pickElement(e.target);
    if (el) {
      if (e.shiftKey) this.selection = this.selection.includes(el) ? this.selection.filter((x) => x !== el) : [...this.selection, el];
      else if (!this.selection.includes(el)) { this.selection = [el]; this.selectedPoints.clear(); }
      if (!e.shiftKey) this.selectedPoints.clear();
      this.drag = { type: 'move', startS: s, moved: false, gesture: new Gesture() };
    } else {
      this.drag = { type: 'marquee', startS: s, moved: false, additive: e.shiftKey };
    }
    this.render();
    this.onChange();
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
        this.drag = { type: 'resize', startS: s, moved: false, el, h: point.id.slice(3) as BoxHandle, box, M, gesture, origT };
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
    this.onChange();
  }

  private pointerMove(e: PointerEvent): void {
    const s = this.local(e);
    if (this.doc) {
      const D = this.screenMat(this.doc);
      this.onPointer(D ? matApply(matInvert(D), s) : null);
    }
    const d = this.drag;
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
      case 'move':
        for (const el of this.selection) this.translateBy(d.gesture, el, dS);
        break;
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
    if (d.type !== 'pan' && d.type !== 'marquee' && d.type !== 'pivot') this.onChange();
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
    const target = add(handlePos(d.box, d.h), matApply(matInvert(linear(d.M)), sub(s, d.startS)));
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
    this.onChange();
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
      this.render(); this.onChange();
      return;
    }
    const el = this.pickElement(e.target);
    if (el && isGroup(el)) {
      // Enter the group so child shapes expose their editor points.
      this.scope = el;
      const child = this.pickElement(e.target);
      this.selection = child ? [child] : [];
      this.selectedPoints.clear();
      this.render(); this.onChange();
    }
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
      if (refused) this.onStatus('Deletion refused: the shape would have too few points.');
      this.commit(g, 'Delete points');
      this.selectedPoints.clear();
    } else if (this.selection.length) {
      this.history.replace('Delete', this.selection.map((el) => [el, null] as [Element, null]));
      this.selection = [];
    }
    this.render(); this.onChange();
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
    this.render(); this.onChange();
  }

  canConvert(kind: 'path' | 'ellipse'): boolean {
    return this.selection.some((el) => (kind === 'path' ? canConvertToPath(el) : el.localName === 'circle'));
  }

  undo(): void { this.history.undo(); this.pruneSelection(); this.lastChanged.clear(); this.render(); this.onChange(); }
  redo(): void { this.history.redo(); this.pruneSelection(); this.lastChanged.clear(); this.render(); this.onChange(); }

  /** Arrow-key nudge: 1 screen pixel (Shift = 10), mapped to local space (Task_44). */
  nudge(dS: Vec): void {
    const g = new Gesture();
    if (this.pointCount()) for (const [el, ids] of this.selectedPoints) this.movePointsBy(g, el, [...ids], dS);
    else for (const el of this.selection) this.translateBy(g, el, dS);
    this.commit(g, 'Nudge');
    this.render(); this.onChange();
  }

  private keyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (cmd && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
    if (e.code === 'Space') { this.spaceDown = true; this.host.classList.add('panning'); e.preventDefault(); return; }
    if (!this.doc) return;
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
        else if (this.scope && this.scope !== this.doc) { this.selection = [this.scope]; this.scope = (this.scope.parentNode as Element | null) ?? this.doc; }
        else this.selection = [];
        this.render(); this.onChange();
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
      const g = new Gesture(); g.preview(el, patch); this.commit(g, label); this.render(); this.onChange();
    };
    const h = this.hitHandle(s);
    if (h && h.point.kind !== 'bounding') {
      const a = adapterFor(h.el)!;
      if (!this.selectedPoints.get(h.el)?.has(h.point.id)) { this.selectedPoints = new Map([[h.el, new Set([h.point.id])]]); this.render(); }
      for (const it of a.pointMenu?.(h.el, h.point.id) ?? []) items.push({ label: it.label, checked: it.checked, run: () => run(it.run(), h.el, it.label) });
      if (h.point.kind === 'anchor' && a.deletePoint) items.push({ label: 'Delete point', run: () => this.deleteSelection() });
    } else {
      const el = this.pickElement(e.target);
      if (el && !this.selection.includes(el)) { this.selection = [el]; this.selectedPoints.clear(); this.render(); this.onChange(); }
      if (!this.selection.length) return;
      items.push({ label: 'Convert to path', disabled: !this.canConvert('path'), run: () => this.convert('path') });
      if (this.selection.some((x) => x.localName === 'circle')) items.push({ label: 'Convert to ellipse', run: () => this.convert('ellipse') });
      if (this.selection.length === 1 && isGroup(this.selection[0])) {
        const g = this.selection[0];
        items.push({ label: 'Enter group', run: () => { this.scope = g; this.selection = []; this.render(); this.onChange(); } });
      }
      items.push({ label: 'Delete', run: () => this.deleteSelection() });
    }
    if (items.length) this.onMenu(items, e.clientX, e.clientY);
  }

  applyAttr(el: Element, patch: AttrPatch, label: string): void {
    const g = new Gesture(); g.preview(el, patch); this.commit(g, label); this.render(); this.onChange();
  }

  /** Points of a selected element, for the inspector. */
  pointsOf(el: Element): EditorPoint[] { return adapterFor(el)?.getPoints(el) ?? []; }
}
