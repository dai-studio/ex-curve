// Path parser / serializer (Task_53) and segment operations (Task_34).
import type { Vec } from '../model';
import { fmt } from '../num';
import {
  arcAt, arcToCenter, cubicAt, fitCubic, lerp, near, quadAt, reflect, splitCubic, splitQuad, sub, type ArcCenter,
} from '../geom';

export type Cmd = 'M' | 'L' | 'H' | 'V' | 'C' | 'S' | 'Q' | 'T' | 'A' | 'Z';

/**
 * Normalised absolute segment (PathSegment, Task_32) plus source-format metadata.
 * points layout: M/L/H/V/T/A: [end]; C: [c1, c2, end]; S: [c2, end]; Q: [c, end]; Z: [].
 */
export interface PathSegment {
  command: Cmd;
  relative: boolean;
  points: Vec[];
  rx: number; ry: number; rotation: number; largeArc: boolean; sweep: boolean;
  subpathIndex: number;
  /** Command letter omitted in source (implicit repeat). */
  implicit: boolean;
  /** Source text of this segment, separators before it, letter and numbers as written. */
  src?: string; lead?: string; srcLetter?: string; srcNums?: number[];
}

export interface ParsedPath { segs: PathSegment[]; tail: string }

const ARGC: Record<Cmd, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const NUM_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

export function seg(command: Cmd, points: Vec[], relative = false, extra: Partial<PathSegment> = {}): PathSegment {
  return { command, relative, points, rx: 0, ry: 0, rotation: 0, largeArc: false, sweep: false, subpathIndex: 0, implicit: false, ...extra };
}

export function parsePath(d: string): ParsedPath {
  const segs: PathSegment[] = [];
  const n = d.length;
  let i = 0;
  let prevLetter: string | null = null;
  let cur: Vec = { x: 0, y: 0 }, start: Vec = { x: 0, y: 0 };
  let sub = -1;
  const skip = () => { while (i < n && /[\s,]/.test(d[i])) i++; };
  const readNum = (): number | null => {
    skip(); NUM_RE.lastIndex = i;
    const m = NUM_RE.exec(d);
    if (!m) return null;
    i = NUM_RE.lastIndex;
    return parseFloat(m[0]);
  };
  const readFlag = (): number | null => {
    skip();
    if (d[i] === '0' || d[i] === '1') return d[i++] === '1' ? 1 : 0;
    return null;
  };
  let tail = '';
  for (;;) {
    const before = i;
    skip();
    const lead = d.slice(before, i);
    if (i >= n) { tail = lead; break; }
    const textStart = i;
    let letter: string, implicit = false;
    if (/[a-zA-Z]/.test(d[i])) {
      letter = d[i++];
      if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(letter)) { tail = d.slice(before); break; }
    } else {
      if (!prevLetter || /[zZ]/.test(prevLetter)) { tail = d.slice(before); break; }
      letter = prevLetter === 'M' ? 'L' : prevLetter === 'm' ? 'l' : prevLetter;
      implicit = true;
    }
    const up = letter.toUpperCase() as Cmd;
    const rel = letter !== up;
    const nums: number[] = [];
    let ok = true;
    for (let k = 0; k < ARGC[up]; k++) {
      const val = up === 'A' && (k === 3 || k === 4) ? readFlag() : readNum();
      if (val == null) { ok = false; break; }
      nums.push(val);
    }
    if (!ok) { i = textStart; tail = d.slice(before); break; }
    const P = (x: number, y: number): Vec => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    const s = seg(up, [], rel, { implicit, src: d.slice(textStart, i), lead, srcLetter: implicit ? undefined : letter, srcNums: nums });
    switch (up) {
      case 'M': s.points = [P(nums[0], nums[1])]; start = s.points[0]; sub++; break;
      case 'L': case 'T': s.points = [P(nums[0], nums[1])]; break;
      case 'H': s.points = [{ x: rel ? cur.x + nums[0] : nums[0], y: cur.y }]; break;
      case 'V': s.points = [{ x: cur.x, y: rel ? cur.y + nums[0] : nums[0] }]; break;
      case 'C': s.points = [P(nums[0], nums[1]), P(nums[2], nums[3]), P(nums[4], nums[5])]; break;
      case 'S': case 'Q': s.points = [P(nums[0], nums[1]), P(nums[2], nums[3])]; break;
      case 'A':
        Object.assign(s, { rx: nums[0], ry: nums[1], rotation: nums[2], largeArc: nums[3] === 1, sweep: nums[4] === 1 });
        s.points = [P(nums[5], nums[6])];
        break;
      case 'Z': s.points = []; break;
    }
    if (sub < 0) sub = 0; // path not starting with M is invalid; be lenient
    s.subpathIndex = sub;
    segs.push(s);
    cur = up === 'Z' ? start : s.points[s.points.length - 1];
    prevLetter = letter;
  }
  return { segs, tail };
}

/** End point of every segment (Z ends at its subpath start). */
export function ends(segs: PathSegment[]): Vec[] {
  const out: Vec[] = [];
  let start: Vec = { x: 0, y: 0 }, prev: Vec = { x: 0, y: 0 };
  for (const s of segs) {
    // H / V stay axis-aligned with their (possibly moved) start point.
    if (s.command === 'H') s.points[0] = { x: s.points[0].x, y: prev.y };
    if (s.command === 'V') s.points[0] = { x: prev.x, y: s.points[0].y };
    if (s.command === 'M') start = s.points[0];
    prev = s.command === 'Z' ? start : s.points[s.points.length - 1];
    out.push(prev);
  }
  return out;
}

export function startOf(segs: PathSegment[], i: number, e = ends(segs)): Vec {
  return i > 0 ? e[i - 1] : { x: 0, y: 0 };
}

export function endOf(segs: PathSegment[], i: number, e = ends(segs)): Vec { return e[i]; }

/** Index of the M that starts segment i's subpath. */
export function subpathStartIndex(segs: PathSegment[], i: number): number {
  for (let k = i; k >= 0; k--) if (segs[k].command === 'M') return k;
  return 0;
}

/** Implicit (reflected) control of S (cp1) or T (control). */
export function implicitCtrl(segs: PathSegment[], i: number, e = ends(segs)): Vec {
  const s = segs[i], start = startOf(segs, i, e);
  const p = segs[i - 1];
  if (!p) return start;
  if (s.command === 'S') {
    if (p.command === 'C') return reflect(p.points[1], start);
    if (p.command === 'S') return reflect(p.points[0], start);
    return start;
  }
  if (s.command === 'T') {
    if (p.command === 'Q') return reflect(p.points[0], start);
    if (p.command === 'T') return reflect(implicitCtrl(segs, i - 1, e), start);
    return start;
  }
  return start;
}

/** Cubic control points for C/S, or null. */
export function cubicCtrls(segs: PathSegment[], i: number, e = ends(segs)): [Vec, Vec] | null {
  const s = segs[i];
  if (s.command === 'C') return [s.points[0], s.points[1]];
  if (s.command === 'S') return [implicitCtrl(segs, i, e), s.points[0]];
  return null;
}

export function quadCtrl(segs: PathSegment[], i: number, e = ends(segs)): Vec | null {
  const s = segs[i];
  if (s.command === 'Q') return s.points[0];
  if (s.command === 'T') return implicitCtrl(segs, i, e);
  return null;
}

export function arcCenter(segs: PathSegment[], i: number, e = ends(segs)): ArcCenter | null {
  const s = segs[i];
  return arcToCenter(startOf(segs, i, e), e[i], s.rx, s.ry, s.rotation, s.largeArc, s.sweep);
}

export function pointAt(segs: PathSegment[], i: number, t: number, e = ends(segs)): Vec {
  const s = segs[i], p0 = startOf(segs, i, e), p1 = e[i];
  const cc = cubicCtrls(segs, i, e);
  if (cc) return cubicAt(p0, cc[0], cc[1], p1, t);
  const qc = quadCtrl(segs, i, e);
  if (qc) return quadAt(p0, qc, p1, t);
  if (s.command === 'A') {
    const a = arcCenter(segs, i, e);
    return a ? arcAt(a, t) : lerp(p0, p1, t);
  }
  if (s.command === 'M') return p1;
  return lerp(p0, p1, t);
}

export function polyline(segs: PathSegment[], i: number, n = 16, e = ends(segs)): Vec[] {
  const s = segs[i];
  if (s.command === 'M') return [];
  if (s.command === 'L' || s.command === 'H' || s.command === 'V' || s.command === 'Z') return [startOf(segs, i, e), e[i]];
  const out: Vec[] = [];
  for (let k = 0; k <= n; k++) out.push(pointAt(segs, i, k / n, e));
  return out;
}

const isDrawing = (s?: PathSegment) => !!s && s.command !== 'M' && s.command !== 'Z';
const isStraight = (s: PathSegment) => s.command === 'L' || s.command === 'H' || s.command === 'V';

/** Convert S -> C and T -> Q in place so the segment no longer depends on its predecessor. */
export function freeze(segs: PathSegment[], i: number): void {
  const s = segs[i];
  if (!s) return;
  if (s.command === 'S') {
    const c1 = implicitCtrl(segs, i);
    segs[i] = { ...s, command: 'C', points: [c1, ...s.points], implicit: false };
  } else if (s.command === 'T') {
    const c = implicitCtrl(segs, i);
    segs[i] = { ...s, command: 'Q', points: [c, ...s.points], implicit: false };
  }
}

/** Split segment i at t, preserving the shape. Returns the new array; the new anchor is end of segment i. */
export function splitSegment(input: PathSegment[], i: number, t = 0.5): PathSegment[] {
  const segs = input.map((s) => ({ ...s }));
  const s = segs[i];
  if (s.command === 'M') return segs;
  if (s.command === 'Z') {
    const e = ends(segs);
    const m = lerp(startOf(segs, i, e), e[i], t);
    segs.splice(i, 0, seg('L', [m], s.relative, { subpathIndex: s.subpathIndex }));
    return segs;
  }
  freeze(segs, i + 1);
  freeze(segs, i);
  const e = ends(segs);
  const cur = segs[i], p0 = startOf(segs, i, e), p1 = e[i];
  const second = { ...cur, implicit: false, src: undefined, lead: undefined, srcLetter: undefined, srcNums: undefined };
  switch (cur.command) {
    case 'L': case 'H': case 'V': {
      const m = lerp(p0, p1, t);
      cur.points = [m];
      second.points = [p1];
      break;
    }
    case 'C': {
      const [a, b] = splitCubic(p0, cur.points[0], cur.points[1], p1, t);
      cur.points = [a[1], a[2], a[3]];
      second.points = [b[1], b[2], b[3]];
      break;
    }
    case 'Q': {
      const [a, b] = splitQuad(p0, cur.points[0], p1, t);
      cur.points = [a[1], a[2]];
      second.points = [b[1], b[2]];
      break;
    }
    case 'A': {
      const a = arcCenter(segs, i, e);
      if (!a) { cur.points = [lerp(p0, p1, t)]; second.points = [p1]; break; }
      const m = arcAt(a, t);
      const d1 = a.dtheta * t, d2 = a.dtheta * (1 - t);
      Object.assign(cur, { rx: a.rx, ry: a.ry, largeArc: Math.abs(d1) > 180, points: [m] });
      Object.assign(second, { rx: a.rx, ry: a.ry, largeArc: Math.abs(d2) > 180, points: [p1] });
      break;
    }
  }
  segs.splice(i + 1, 0, second);
  return segs;
}

/** Delete the anchor at the end of segment i, merging neighbours (Task_34). null = refused. */
export function deleteAnchor(input: PathSegment[], i: number): PathSegment[] | null {
  let segs = input.map((s) => ({ ...s }));
  const s = segs[i];
  if (!s || s.command === 'Z') return null;
  const next = segs[i + 1];
  if (s.command === 'M') {
    if (isDrawing(next)) {
      freeze(segs, i + 2);
      const e = ends(segs);
      segs[i + 1] = seg('M', [e[i + 1]], s.relative, { subpathIndex: s.subpathIndex, lead: s.lead, src: undefined });
      segs.splice(i, 1);
    } else {
      segs.splice(i, next?.command === 'Z' ? 2 : 1);
    }
  } else if (isDrawing(next)) {
    freeze(segs, i + 2);
    freeze(segs, i + 1);
    freeze(segs, i);
    const e = ends(segs);
    const a = segs[i], b = segs[i + 1];
    const p0 = startOf(segs, i, e), p1 = e[i + 1];
    let merged: PathSegment;
    const keep = { relative: a.relative, implicit: a.implicit, lead: a.lead, src: a.src, srcLetter: a.srcLetter, srcNums: a.srcNums, subpathIndex: a.subpathIndex };
    const ca = a.command === 'A' ? arcCenter(segs, i, e) : null;
    const cb = b.command === 'A' ? arcCenter(segs, i + 1, e) : null;
    if (isStraight(a) && isStraight(b)) {
      merged = seg('L', [p1], a.relative, keep);
    } else if (ca && cb && a.sweep === b.sweep && Math.abs(ca.rx - cb.rx) < 1e-6 && Math.abs(ca.ry - cb.ry) < 1e-6
      && Math.abs(a.rotation - b.rotation) < 1e-9 && near(ca.c, cb.c, 1e-3)) {
      merged = seg('A', [p1], a.relative, { ...keep, rx: a.rx, ry: a.ry, rotation: a.rotation, sweep: a.sweep, largeArc: Math.abs(ca.dtheta + cb.dtheta) > 180 });
    } else {
      const samples = [...polyline(segs, i, 16, e).slice(1), ...polyline(segs, i + 1, 16, e).slice(1, -1)];
      const t0 = sub(pointAt(segs, i, 1e-3, e), p0);
      const t3 = sub(pointAt(segs, i + 1, 1 - 1e-3, e), p1);
      const [c1, c2] = fitCubic(p0, p1, t0, t3, samples);
      merged = seg('C', [c1, c2, p1], a.relative, keep);
    }
    segs.splice(i, 2, merged);
  } else {
    freeze(segs, i + 1);
    segs.splice(i, 1);
  }
  segs = dropEmptySubpaths(segs);
  if (!segs.some(isDrawing)) return null;
  return segs;
}

function dropEmptySubpaths(segs: PathSegment[]): PathSegment[] {
  const out: PathSegment[] = [];
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    if (s.command === 'M') {
      let j = k + 1;
      while (j < segs.length && segs[j].command === 'Z') j++;
      const nextIsDrawing = isDrawing(segs[j]);
      if (!nextIsDrawing && segs.slice(k + 1).some(isDrawing)) { k = j - 1; continue; }
    }
    out.push(s);
  }
  return out;
}

// ---------- serialisation ----------

function emitNums(s: PathSegment, start: Vec): number[] {
  const R = (p: Vec) => (s.relative ? [p.x - start.x, p.y - start.y] : [p.x, p.y]);
  const end = s.points[s.points.length - 1];
  switch (s.command) {
    case 'M': case 'L': case 'T': return R(end);
    case 'H': return [s.relative ? end.x - start.x : end.x];
    case 'V': return [s.relative ? end.y - start.y : end.y];
    case 'C': case 'S': case 'Q': return s.points.flatMap(R);
    case 'A': return [s.rx, s.ry, s.rotation, s.largeArc ? 1 : 0, s.sweep ? 1 : 0, ...R(end)];
    case 'Z': return [];
  }
}

const sameNums = (a: number[], b?: number[]) =>
  !!b && a.length === b.length && a.every((x, k) => Math.abs(x - b[k]) <= 1e-7 * Math.max(1, Math.abs(b[k])));

/** Serialise, reusing the source text of every segment whose numbers are unchanged. */
export function serializePath(p: ParsedPath, precision?: number): string {
  const { segs } = p;
  const e = ends(segs);
  let out = '';
  let cont: string | null = null; // letter an implicit segment would repeat
  segs.forEach((s, i) => {
    const letter = s.relative ? s.command.toLowerCase() : s.command;
    const start = i ? e[i - 1] : { x: 0, y: 0 };
    const nums = emitNums(s, start);
    const letterOk = s.implicit ? cont === letter : s.srcLetter === letter;
    const lead = s.lead ?? (i ? ' ' : '');
    if (s.src != null && letterOk && sameNums(nums, s.srcNums)) {
      out += lead + s.src;
    } else {
      const omit = s.implicit && cont === letter;
      const text = nums.map((x, k) => (s.command === 'A' && (k === 3 || k === 4) ? String(x) : fmt(x, precision))).join(' ');
      const body = omit ? text : letter + text;
      const sep = omit && lead === '' && !body.startsWith('-') ? ' ' : lead;
      out += sep + body;
    }
    cont = s.command === 'Z' ? null : letter === 'M' ? 'L' : letter === 'm' ? 'l' : letter;
  });
  return out + p.tail;
}

/** Plain absolute serialisation of fresh segments. */
export function toD(segs: PathSegment[]): string {
  return serializePath({ segs: segs.map((s) => ({ ...s, src: undefined, implicit: false })), tail: '' });
}

/** Translate / affine-map every point. */
export function mapSegments(segs: PathSegment[], f: (p: Vec) => Vec): PathSegment[] {
  return segs.map((s) => ({ ...s, points: s.points.map(f) }));
}
