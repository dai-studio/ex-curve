// Path editor points (SubProcess_8).
import type { AttrPatch, EditorPoint, Modifiers, ShapeAdapter, Vec } from '../model';
import { elementId } from '../model';
import {
  add, arcAt, arcToCenter, boxMap, cross, dist, dot, ellipsePoint, matApply, mid, near, norm, rectFromPoints, reflect, rotate, sub,
} from '../geom';
import {
  arcCenter, deleteAnchor, ends, freeze, implicitCtrl, mapSegments, parsePath, pointAt, polyline, serializePath, splitSegment,
  startOf, subpathStartIndex, type ParsedPath, type PathSegment,
} from '../path/path';
import type { ArcCenter } from '../geom';

export type NodeType = 'corner' | 'smooth' | 'symmetric';
const NODE_CYCLE: NodeType[] = ['corner', 'smooth', 'symmetric'];

/** Node types are editor state (not stored in SVG); inferred from geometry until set. */
const nodeTypes = new WeakMap<Element, Map<number, NodeType>>();

const read = (el: Element): ParsedPath => parsePath(el.getAttribute('d') ?? '');
const write = (p: ParsedPath): AttrPatch => ({ d: serializePath(p) });

function parseId(id: string): { k: string; i: number } {
  const [k, i] = id.split(':');
  return k.startsWith('a') && i === undefined ? { k: 'a', i: Number(k.slice(1)) } : { k, i: Number(i) };
}

function startAnchorId(segs: PathSegment[], i: number): string | null {
  if (i <= 0) return null;
  return segs[i - 1].command === 'Z' ? `a${subpathStartIndex(segs, i - 1)}` : `a${i - 1}`;
}

/** Index of the last drawing segment of the subpath starting at M index `m`, if the subpath is closed with Z. */
function closingIndex(segs: PathSegment[], m: number): number | null {
  let k = m + 1;
  while (k < segs.length && segs[k].command !== 'M' && segs[k].command !== 'Z') k++;
  return segs[k]?.command === 'Z' && k - 1 > m ? k - 1 : null;
}

/** Incoming cubic control slot of anchor i (c2 of seg i), outgoing (c1 of seg i+1). */
function incomingSlot(segs: PathSegment[], i: number): [number, number] | null {
  const s = segs[i];
  if (s?.command === 'C') return [i, 1];
  if (s?.command === 'S') return [i, 0];
  return null;
}
function outgoingSlot(segs: PathSegment[], i: number): [number, number] | null {
  return segs[i + 1]?.command === 'C' ? [i + 1, 0] : null;
}

/** Anchor joins two cubic handles (next segment C, or S whose cp1 is the implicit reflection). */
function pairable(segs: PathSegment[], a: number): boolean {
  return !!incomingSlot(segs, a) && (segs[a + 1]?.command === 'C' || segs[a + 1]?.command === 'S');
}

function inferNode(segs: PathSegment[], a: number, e: Vec[]): NodeType {
  if (incomingSlot(segs, a) && segs[a + 1]?.command === 'S') return 'symmetric';
  const inc = incomingSlot(segs, a), out = outgoingSlot(segs, a);
  if (!inc || !out) return 'corner';
  const p = e[a];
  const u = sub(segs[inc[0]].points[inc[1]], p), w = sub(segs[out[0]].points[out[1]], p);
  const lu = Math.hypot(u.x, u.y), lw = Math.hypot(w.x, w.y);
  if (!lu || !lw) return 'corner';
  if (Math.abs(cross(u, w)) / (lu * lw) > 1e-3 || dot(u, w) > 0) return 'corner';
  return Math.abs(lu - lw) < 1e-3 * Math.max(lu, lw) ? 'symmetric' : 'smooth';
}

export function nodeType(el: Element, segs: PathSegment[], a: number): NodeType {
  return nodeTypes.get(el)?.get(a) ?? inferNode(segs, a, ends(segs));
}

function setNode(el: Element, a: number, t: NodeType) {
  let m = nodeTypes.get(el);
  if (!m) nodeTypes.set(el, (m = new Map()));
  m.set(a, t);
}

/** Slots [segIndex, pointIndex] moved when anchor a moves: end point, attached controls, coincident closing anchor. */
function anchorSlots(segs: PathSegment[], a: number, e: Vec[]): [number, number][] {
  const out: [number, number][] = [];
  const addAnchor = (i: number) => {
    const s = segs[i];
    out.push([i, s.points.length - 1]);
    const inc = incomingSlot(segs, i);
    if (inc) out.push(inc);
    const o = outgoingSlot(segs, i);
    if (o) out.push(o);
  };
  addAnchor(a);
  const m = subpathStartIndex(segs, a);
  const k = closingIndex(segs, m);
  if (k != null && near(e[k], e[m], 1e-9)) {
    if (a === m) addAnchor(k);
    else if (a === k) addAnchor(m);
  }
  return out;
}

function moveSlots(segs: PathSegment[], slots: [number, number][], d: Vec) {
  const seen = new Set<string>();
  for (const [i, j] of slots) {
    const key = `${i}:${j}`;
    if (seen.has(key)) continue;
    seen.add(key);
    segs[i].points[j] = add(segs[i].points[j], d);
  }
}

function controlTarget(segs: PathSegment[], k: string, i: number): [number, number] | null {
  const s = segs[i];
  if (!s) return null;
  if (k === 'c1' && s.command === 'C') return [i, 0];
  if (k === 'c2' && s.command === 'C') return [i, 1];
  if (k === 'c2' && s.command === 'S') return [i, 0];
  if (k === 'q' && s.command === 'Q') return [i, 0];
  return null;
}

export const pathAdapter: ShapeAdapter = {
  tagNames: ['path'],
  geometryAttrs: ['d'],

  getPoints(el) {
    const { segs } = read(el);
    const e = ends(segs);
    const eid = elementId(el);
    const out: EditorPoint[] = [];
    const P = (p: Omit<EditorPoint, 'elementId' | 'attr' | 'constraint'> & Partial<EditorPoint>) =>
      out.push({ elementId: eid, attr: ['d'], constraint: 'none', ...p });
    segs.forEach((s, i) => {
      const start = startOf(segs, i, e), end = e[i];
      const sa = startAnchorId(segs, i);
      if (s.command === 'Z') {
        const m = subpathStartIndex(segs, i);
        if (!near(start, end)) {
          P({ id: `m:${i}`, kind: 'ghost', role: 'insert', ...mid(start, end), segmentIndex: i, linkedPointIds: [...(sa ? [sa] : []), `a${m}`] });
        }
        return;
      }
      P({
        id: `a${i}`, kind: 'anchor', role: s.command === 'M' ? 'start' : 'vertex', ...end, segmentIndex: i,
        constraint: s.command === 'H' ? 'x-axis' : s.command === 'V' ? 'y-axis' : 'none',
      });
      if (s.command === 'M') return;
      const linkedStart = sa ? [sa] : [];
      P({ id: `m:${i}`, kind: 'ghost', role: 'insert', ...pointAt(segs, i, 0.5, e), segmentIndex: i, linkedPointIds: [...linkedStart, `a${i}`] });
      switch (s.command) {
        case 'C':
          P({ id: `c1:${i}`, kind: 'control', role: 'cp', ...s.points[0], segmentIndex: i, linkedPointIds: linkedStart, tangents: [start] });
          P({ id: `c2:${i}`, kind: 'control', role: 'cp', ...s.points[1], segmentIndex: i, linkedPointIds: [`a${i}`], tangents: [end] });
          break;
        case 'S':
          P({ id: `g1:${i}`, kind: 'ghost', role: 'reflect', ...implicitCtrl(segs, i, e), segmentIndex: i, linkedPointIds: linkedStart, tangents: [start] });
          P({ id: `c2:${i}`, kind: 'control', role: 'cp', ...s.points[0], segmentIndex: i, linkedPointIds: [`a${i}`], tangents: [end] });
          break;
        case 'Q':
          P({ id: `q:${i}`, kind: 'control', role: 'cp', ...s.points[0], segmentIndex: i, linkedPointIds: [...linkedStart, `a${i}`], tangents: [start, end] });
          break;
        case 'T':
          P({ id: `gq:${i}`, kind: 'ghost', role: 'reflect', ...implicitCtrl(segs, i, e), segmentIndex: i, linkedPointIds: [...linkedStart, `a${i}`], tangents: [start, end] });
          break;
        case 'A': {
          const ac = arcCenter(segs, i, e);
          if (!ac) break;
          const link = { segmentIndex: i, linkedPointIds: [`a${i}`], tangents: [ac.c] };
          const ang = arcHandleAngles(ac);
          P({ id: `rx:${i}`, kind: 'parameter', role: 'radius', ...ellipsePoint(ac, ang.rx), constraint: 'on-ellipse', ...link });
          P({ id: `ry:${i}`, kind: 'parameter', role: 'radius', ...ellipsePoint(ac, ang.ry), constraint: 'on-ellipse', ...link });
          P({ id: `rot:${i}`, kind: 'parameter', role: 'rotation', ...ellipsePoint(ac, ang.rot), constraint: 'on-ellipse', ...link });
          // Flip ghosts at the midpoints of the alternative arcs; skip alternatives that draw the same arc
          // (radii scaled up to exactly fit: large and small arcs coincide).
          const seen: Vec[] = [arcAt(ac, 0.5)];
          for (const la of [false, true]) for (const sw of [false, true]) {
            if (la === s.largeArc && sw === s.sweep) continue;
            const alt = arcToCenter(start, end, s.rx, s.ry, s.rotation, la, sw);
            if (!alt) continue;
            const m = arcAt(alt, 0.5);
            if (seen.some((q) => near(q, m, 1e-6 * Math.max(1, ac.rx)))) continue;
            seen.push(m);
            P({ id: `flip${+la}${+sw}:${i}`, kind: 'ghost', role: 'flip', ...m, segmentIndex: i, linkedPointIds: [`a${i}`], action: 'click' });
          }
          break;
        }
      }
    });
    return out;
  },

  dragPoint(el, id, t, mods) {
    const p = read(el);
    const { segs } = p;
    const e = ends(segs);
    const { k, i } = parseId(id);
    const s = segs[i];
    if (!s) return {};
    if (k === 'a') {
      const d = sub(t, e[i]);
      if (s.command === 'H') d.y = 0;
      if (s.command === 'V') d.x = 0;
      moveSlots(segs, anchorSlots(segs, i, e), d);
      return write(p);
    }
    const slot = controlTarget(segs, k, i);
    if (slot) {
      segs[slot[0]].points[slot[1]] = t;
      // Keep the paired control collinear for smooth / symmetric nodes; Alt breaks smoothness.
      const a = k === 'c1' ? i - 1 : k === 'c2' ? i : -1;
      if (a >= 0 && segs[a].command !== 'M') {
        const pair = k === 'c1' ? incomingSlot(segs, a) : outgoingSlot(segs, a);
        if (mods.alt) setNode(el, a, 'corner');
        else if (pair) {
          const nt = nodeType(el, read(el).segs, a);
          const anchor = e[a];
          const opp = segs[pair[0]].points[pair[1]];
          if (nt === 'symmetric') segs[pair[0]].points[pair[1]] = reflect(t, anchor);
          else if (nt === 'smooth') segs[pair[0]].points[pair[1]] = add(anchor, mul(norm(sub(anchor, t)), dist(opp, anchor)));
        }
      }
      return write(p);
    }
    if (k === 'rx' || k === 'ry') {
      const ac = arcCenter(segs, i, e);
      if (!ac) return {};
      const axis = rotate(k === 'rx' ? { x: 1, y: 0 } : { x: 0, y: 1 }, ac.phi);
      const v = Math.abs(dot(sub(t, ac.c), axis));
      let rx = ac.rx, ry = ac.ry; // effective (scaled) radii, so the handle never jumps
      if (k === 'rx') { if (mods.shift && rx) ry = (ry * v) / rx; rx = v; if (mods.alt) ry = v; }
      else { if (mods.shift && ry) rx = (rx * v) / ry; ry = v; if (mods.alt) rx = v; }
      Object.assign(s, { rx, ry });
      return write(p);
    }
    if (k === 'rot') {
      const ac = arcCenter(segs, i, e);
      if (!ac) return {};
      // The rotation handle sits at ellipse angle 0 or 180; keep the written rotation continuous.
      const back = arcHandleAngles(ac).rot === 180;
      let a = (Math.atan2(back ? ac.c.y - t.y : t.y - ac.c.y, back ? ac.c.x - t.x : t.x - ac.c.x) * 180) / Math.PI;
      if (mods.shift) a = Math.round(a / 15) * 15;
      s.rotation = ((a % 360) + 360) % 360;
      return write(p);
    }
    return {};
  },

  insertPoint(el, id) {
    const p = read(el);
    const { k, i } = parseId(id);
    if (k === 'm') {
      nodeTypes.delete(el);
      return { patch: write({ ...p, segs: splitSegment(p.segs, i) }), pointId: `a${i}` };
    }
    if (k === 'g1' || k === 'gq') {
      freeze(p.segs, i);
      return { patch: write(p), pointId: k === 'g1' ? `c1:${i}` : `q:${i}` };
    }
    return null;
  },

  clickPoint(el, id) {
    const m = /^flip(\d)(\d):(\d+)$/.exec(id);
    if (!m) return null;
    const p = read(el);
    const s = p.segs[Number(m[3])];
    s.largeArc = m[1] === '1';
    s.sweep = m[2] === '1';
    return write(p);
  },

  deletePoint(el, ids) {
    const p = read(el);
    let segs: PathSegment[] | null = p.segs;
    const idx = ids.map(parseId).filter((x) => x.k === 'a').map((x) => x.i).sort((a, b) => b - a);
    if (!idx.length) return null;
    for (const i of idx) { segs = deleteAnchor(segs, i); if (!segs) return null; }
    nodeTypes.delete(el);
    return write({ ...p, segs });
  },

  movePoints(el, ids, d) {
    const p = read(el);
    const e = ends(p.segs);
    const slots: [number, number][] = [];
    for (const id of ids) {
      const { k, i } = parseId(id);
      if (k === 'a' && p.segs[i]) slots.push(...anchorSlots(p.segs, i, e));
      const c = controlTarget(p.segs, k, i);
      if (c) slots.push(c);
    }
    moveSlots(p.segs, slots, d);
    return write(p);
  },

  translate(el, d) {
    const p = read(el);
    return write({ ...p, segs: mapSegments(p.segs, (q) => add(q, d)) });
  },

  getBBox(el) {
    const { segs } = read(el);
    const e = ends(segs);
    const pts: Vec[] = [];
    segs.forEach((s, i) => { if (s.command === 'M') pts.push(e[i]); else pts.push(...polyline(segs, i, 24, e)); });
    return rectFromPoints(pts);
  },

  resize(el, from, to) {
    const p = read(el);
    const m = boxMap(from, to);
    const sx = m[0], sy = m[3];
    const segs = mapSegments(p.segs, (q) => matApply(m, q));
    for (const s of segs) {
      if (s.command !== 'A') continue;
      const r = ((s.rotation % 180) + 180) % 180;
      if (Math.abs(sx - sy) > 1e-9 && r !== 0 && r !== 90) return null; // needs transform
      const [fx, fy] = r === 90 ? [Math.abs(sy), Math.abs(sx)] : [Math.abs(sx), Math.abs(sy)];
      s.rx *= fx; s.ry *= fy;
      if (sx * sy < 0) s.sweep = !s.sweep;
    }
    return write({ ...p, segs });
  },

  segments(el) {
    const { segs } = read(el);
    const e = ends(segs);
    return segs.map((_, i) => polyline(segs, i, 16, e));
  },

  toPath(el) { return el.getAttribute('d') ?? ''; },

  doubleClickPoint(el, id) {
    const { k, i } = parseId(id);
    if (k !== 'a') return null;
    const p = read(el);
    if (!pairable(p.segs, i)) return null;
    const next = NODE_CYCLE[(NODE_CYCLE.indexOf(nodeType(el, p.segs, i)) + 1) % 3];
    return applyNodeType(el, p, i, next);
  },

  pointMenu(el, id) {
    const { k, i } = parseId(id);
    if (k !== 'a') return [];
    const p = read(el);
    const s = p.segs[i];
    const items: { label: string; checked?: boolean; run: () => AttrPatch | null }[] = [];
    if (s?.command === 'A') {
      items.push(
        { label: 'Large arc', checked: s.largeArc, run: () => { const q = read(el); q.segs[i].largeArc = !q.segs[i].largeArc; return write(q); } },
        { label: 'Sweep', checked: s.sweep, run: () => { const q = read(el); q.segs[i].sweep = !q.segs[i].sweep; return write(q); } },
      );
    }
    if (pairable(p.segs, i)) {
      const cur = nodeType(el, p.segs, i);
      for (const t of NODE_CYCLE) items.push({ label: `Node: ${t}`, checked: cur === t, run: () => applyNodeType(el, read(el), i, t) });
    }
    return items;
  },
};

/** True when ellipse angle `deg` lies on the drawn arc. */
function onArc(ac: ArcCenter, deg: number): boolean {
  const d = ((((deg - ac.theta1) * Math.sign(ac.dtheta || 1)) % 360) + 360) % 360;
  return d <= Math.abs(ac.dtheta) + 1e-9;
}

/** Radius / rotation handle angles: prefer axis points on the visible arc (away from flip ghosts). */
export function arcHandleAngles(ac: ArcCenter): { rx: number; ry: number; rot: number } {
  const rx = onArc(ac, 0) || !onArc(ac, 180) ? 0 : 180;
  const ry = onArc(ac, 90) || !onArc(ac, 270) ? 90 : 270;
  return { rx, ry, rot: rx === 0 ? 180 : 0 };
}

function mul(a: Vec, s: number): Vec { return { x: a.x * s, y: a.y * s }; }

function applyNodeType(el: Element, p: ParsedPath, a: number, t: NodeType): AttrPatch {
  setNode(el, a, t);
  if (p.segs[a + 1]?.command === 'S') {
    if (t === 'symmetric') return write(p); // S is symmetric by definition
    freeze(p.segs, a + 1); // smooth / corner need an explicit cp1: S -> C
  }
  const inc = incomingSlot(p.segs, a)!, out = outgoingSlot(p.segs, a)!;
  const anchor = ends(p.segs)[a];
  const ci = p.segs[inc[0]].points[inc[1]];
  const co = p.segs[out[0]].points[out[1]];
  if (t === 'symmetric') {
    // Equal length: average of both handle lengths, along the incoming direction.
    const l = (dist(ci, anchor) + dist(co, anchor)) / 2;
    const dir = norm(sub(ci, anchor));
    p.segs[inc[0]].points[inc[1]] = add(anchor, mul(dir, l));
    p.segs[out[0]].points[out[1]] = add(anchor, mul(dir, -l));
  } else if (t === 'smooth') {
    p.segs[out[0]].points[out[1]] = add(anchor, mul(norm(sub(anchor, ci)), dist(co, anchor)));
  }
  return write(p);
}

export type { Modifiers };
