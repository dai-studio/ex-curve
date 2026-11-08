import { fmt } from './num';
import type { Rect, Vec } from './model';

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const mid = (a: Vec, b: Vec): Vec => lerp(a, b, 0.5);
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const reflect = (p: Vec, about: Vec): Vec => ({ x: 2 * about.x - p.x, y: 2 * about.y - p.y });
export const norm = (a: Vec): Vec => { const l = len(a); return l ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }; };
export const near = (a: Vec, b: Vec, eps = 1e-6): boolean => dist(a, b) <= eps;
export const rotate = (a: Vec, deg: number): Vec => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};

/** Snap the vector `p - origin` to `stepDeg` increments. */
export function snapAngle(p: Vec, origin: Vec, stepDeg = 15): Vec {
  const d = sub(p, origin);
  const l = len(d);
  const a = Math.round(Math.atan2(d.y, d.x) / ((stepDeg * Math.PI) / 180)) * ((stepDeg * Math.PI) / 180);
  return { x: origin.x + l * Math.cos(a), y: origin.y + l * Math.sin(a) };
}

// ---------- Bezier ----------

export function cubicAt(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

export function quadAt(p0: Vec, p1: Vec, p2: Vec, t: number): Vec {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}

/** de Casteljau split of a cubic. */
export function splitCubic(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): [Vec[], Vec[]] {
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
  const d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t);
  return [[p0, a, d, f], [f, e, c, p3]];
}

export function splitQuad(p0: Vec, p1: Vec, p2: Vec, t: number): [Vec[], Vec[]] {
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(a, b, t);
  return [[p0, a, c], [c, b, p2]];
}

/**
 * Best-fit cubic through sample points with fixed end tangents (one Schneider
 * least-squares step with chord-length parameterisation).
 */
export function fitCubic(p0: Vec, p3: Vec, t0: Vec, t3: Vec, samples: Vec[]): [Vec, Vec] {
  const pts = [p0, ...samples, p3];
  const u: number[] = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + dist(pts[i], pts[i - 1]));
  const total = u[u.length - 1] || 1;
  const t1 = norm(t0), t2 = norm(t3);
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i] / total, s = 1 - t;
    const b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const chord = dist(p0, p3);
  let a = chord / 3, b = chord / 3;
  if (Math.abs(det) > 1e-12) {
    a = (x0 * c11 - x1 * c01) / det;
    b = (c00 * x1 - c01 * x0) / det;
  }
  if (!(a > 1e-6) || !(b > 1e-6)) { a = chord / 3; b = chord / 3; }
  return [add(p0, mul(t1, a)), add(p3, mul(t2, b))];
}

// ---------- Elliptical arcs (SVG spec F.6.5 / F.6.6) ----------

export interface ArcCenter {
  c: Vec; rx: number; ry: number; phi: number; // degrees
  theta1: number; dtheta: number; // degrees
}

/** Endpoint -> centre parameterisation, including radius scale-up. null = straight line. */
export function arcToCenter(p1: Vec, p2: Vec, rx0: number, ry0: number, phiDeg: number, largeArc: boolean, sweep: boolean): ArcCenter | null {
  let rx = Math.abs(rx0), ry = Math.abs(ry0);
  if (rx === 0 || ry === 0 || near(p1, p2, 1e-12)) return null;
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p1.x - p2.x) / 2, dy = (p1.y - p2.y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cx1 = (coef * rx * y1) / ry, cy1 = (-coef * ry * x1) / rx;
  const c = { x: cos * cx1 - sin * cy1 + (p1.x + p2.x) / 2, y: sin * cx1 + cos * cy1 + (p1.y + p2.y) / 2 };
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return (a * 180) / Math.PI;
  };
  const theta1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dtheta = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dtheta > 0) dtheta -= 360;
  if (sweep && dtheta < 0) dtheta += 360;
  return { c, rx, ry, phi: phiDeg, theta1, dtheta };
}

export function ellipsePoint(a: ArcCenter, thetaDeg: number): Vec {
  const t = (thetaDeg * Math.PI) / 180;
  return add(a.c, rotate({ x: a.rx * Math.cos(t), y: a.ry * Math.sin(t) }, a.phi));
}

export function arcAt(a: ArcCenter, t: number): Vec {
  return ellipsePoint(a, a.theta1 + a.dtheta * t);
}

// ---------- Matrices ----------

export type Mat = [number, number, number, number, number, number]; // a b c d e f

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function matMul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function matApply(m: Mat, p: Vec): Vec {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function matInvert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [
    m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function fromDOM(m: DOMMatrix | SVGMatrix): Mat {
  return [m.a, m.b, m.c, m.d, m.e, m.f];
}

/** Map box `from` onto box `to`. */
export function boxMap(from: Rect, to: Rect): Mat {
  const sx = from.width ? to.width / from.width : 1;
  const sy = from.height ? to.height / from.height : 1;
  return [sx, 0, 0, sy, to.x - from.x * sx, to.y - from.y * sy];
}

export function rectFromPoints(pts: Vec[]): Rect {
  if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Distance from p to segment ab. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return dist(p, add(a, mul(ab, t)));
}

/** Parse a transform attribute into a matrix. */
export function parseTransform(s: string | null): Mat {
  let m: Mat = [...IDENTITY];
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(s))) {
    const a = r[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n: Mat = [...IDENTITY];
    switch (r[1]) {
      case 'matrix': n = [a[0], a[1], a[2], a[3], a[4], a[5]]; break;
      case 'translate': n = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case 'scale': n = [a[0], 0, 0, a[1] ?? a[0], 0, 0]; break;
      case 'rotate': {
        const t = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(t), s2 = Math.sin(t);
        const cx = a[1] || 0, cy = a[2] || 0;
        n = matMul(matMul([1, 0, 0, 1, cx, cy], [c, s2, -s2, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX': n = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = matMul(m, n);
  }
  return m;
}

/** True when a transform contains rotation or skew. */
export function hasRotationOrSkew(s: string | null): boolean {
  const m = parseTransform(s);
  return Math.abs(m[1]) > 1e-9 || Math.abs(m[2]) > 1e-9;
}

// ---------------------------------------------------------------- transform attribute strings

/** Prepend a transform function, merging with a leading function of the same kind. */
export function prependTranslate(orig: string | null, d: Vec): string {
  const m = /^\s*translate\(\s*([-+\d.eE]+)(?:[\s,]+([-+\d.eE]+))?\s*\)\s*(.*)$/.exec(orig ?? '');
  if (m) return `translate(${fmt(+m[1] + d.x)} ${fmt(+(m[2] ?? 0) + d.y)})${m[3] ? ' ' + m[3] : ''}`;
  return `translate(${fmt(d.x)} ${fmt(d.y)})${orig ? ' ' + orig : ''}`;
}

export function prependRotate(orig: string | null, a: number, p: Vec): string {
  const m = /^\s*rotate\(\s*([-+\d.eE]+)[\s,]+([-+\d.eE]+)[\s,]+([-+\d.eE]+)\s*\)\s*(.*)$/.exec(orig ?? '');
  if (m && Math.abs(+m[2] - p.x) < 1e-3 && Math.abs(+m[3] - p.y) < 1e-3) {
    return `rotate(${fmt(+m[1] + a)} ${m[2]} ${m[3]})${m[4] ? ' ' + m[4] : ''}`;
  }
  return `rotate(${fmt(a)} ${fmt(p.x)} ${fmt(p.y)})${orig ? ' ' + orig : ''}`;
}

export const matrixString = (m: Mat) => `matrix(${m.map((x) => fmt(x, 6)).join(' ')})`;
