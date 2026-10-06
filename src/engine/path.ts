/**
 * Tracés SVG : analyse, normalisation et morphing.
 * Tout tracé est converti en sous-tracés composés uniquement de cubiques,
 * ce qui permet d'interpoler deux formes quelconques.
 */

export type Pt = [number, number];
/** Segment cubique : point de contrôle 1, point de contrôle 2, point d'arrivée. */
export type CubicSeg = [number, number, number, number, number, number];

export interface Subpath {
  start: Pt;
  segs: CubicSeg[];
  closed: boolean;
}

export type PathData = Subpath[];

const NUM_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;
const CMD_RE = /[MmLlHhVvCcSsQqTtAaZz]/;

function tokenize(d: string): Array<string | number> {
  const out: Array<string | number> = [];
  let i = 0;
  while (i < d.length) {
    const ch = d[i];
    if (CMD_RE.test(ch)) {
      out.push(ch);
      i++;
    } else if (/[\s,]/.test(ch)) {
      i++;
    } else {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(d);
      if (!m || m.index !== i) {
        i++;
        continue;
      }
      out.push(parseFloat(m[0]));
      i += m[0].length;
    }
  }
  return out;
}

const lineSeg = (x0: number, y0: number, x: number, y: number): CubicSeg => [
  x0 + (x - x0) / 3,
  y0 + (y - y0) / 3,
  x0 + ((x - x0) * 2) / 3,
  y0 + ((y - y0) * 2) / 3,
  x,
  y,
];

/** Conversion d'un arc elliptique SVG en cubiques (algorithme de la spec SVG, annexe F.6). */
function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  angle: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
): CubicSeg[] {
  if (rxIn === 0 || ryIn === 0) return [lineSeg(x1, y1, x2, y2)];
  if (x1 === x2 && y1 === y2) return [];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
  const delta = dtheta / n;
  const k = (4 / 3) * Math.tan(delta / 4);
  const segs: CubicSeg[] = [];
  let t = theta1;
  const pointAt = (th: number): Pt => [
    cx + rx * Math.cos(th) * cos - ry * Math.sin(th) * sin,
    cy + rx * Math.cos(th) * sin + ry * Math.sin(th) * cos,
  ];
  const derivAt = (th: number): Pt => [
    -rx * Math.sin(th) * cos - ry * Math.cos(th) * sin,
    -rx * Math.sin(th) * sin + ry * Math.cos(th) * cos,
  ];
  for (let i = 0; i < n; i++) {
    const t2 = t + delta;
    const p1 = pointAt(t);
    const p2 = pointAt(t2);
    const d1 = derivAt(t);
    const d2 = derivAt(t2);
    segs.push([p1[0] + k * d1[0], p1[1] + k * d1[1], p2[0] - k * d2[0], p2[1] - k * d2[1], p2[0], p2[1]]);
    t = t2;
  }
  // Recaler le dernier point exactement sur la cible.
  const last = segs[segs.length - 1];
  last[4] = x2;
  last[5] = y2;
  return segs;
}

/** Analyse un attribut d SVG en sous-tracés cubiques absolus. */
export function parsePath(d: string): PathData {
  const tokens = tokenize(d);
  const paths: PathData = [];
  let cur: Subpath | null = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl: Pt | null = null;
  let lastQuad: Pt | null = null;
  let cmd = '';
  let i = 0;
  const num = () => {
    const v = tokens[i++];
    return typeof v === 'number' ? v : 0;
  };
  const hasNum = () => typeof tokens[i] === 'number';
  const ensure = () => {
    if (!cur) {
      cur = { start: [x, y], segs: [], closed: false };
      paths.push(cur);
    }
    return cur;
  };

  while (i < tokens.length) {
    const tok = tokens[i];
    if (typeof tok === 'string') {
      cmd = tok;
      i++;
    } else if (!cmd) {
      i++;
      continue;
    }
    if (cmd.toUpperCase() === 'Z') {
      if (cur) {
        const sp = cur as Subpath;
        if (x !== sx || y !== sy) sp.segs.push(lineSeg(x, y, sx, sy));
        sp.closed = true;
      }
      x = sx;
      y = sy;
      cur = null;
      lastCtrl = lastQuad = null;
      continue;
    }
    if (!hasNum()) continue;
    do {
      // Recalculé à chaque tour : après M, les coordonnées implicites deviennent des L.
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      switch (C) {
        case 'M': {
          const nx = num() + (rel ? x : 0);
          const ny = num() + (rel ? y : 0);
          x = sx = nx;
          y = sy = ny;
          cur = { start: [x, y], segs: [], closed: false };
          paths.push(cur);
          cmd = rel ? 'l' : 'L';
          lastCtrl = lastQuad = null;
          break;
        }
        case 'L': {
          const nx = num() + (rel ? x : 0);
          const ny = num() + (rel ? y : 0);
          ensure().segs.push(lineSeg(x, y, nx, ny));
          x = nx;
          y = ny;
          lastCtrl = lastQuad = null;
          break;
        }
        case 'H': {
          const nx = num() + (rel ? x : 0);
          ensure().segs.push(lineSeg(x, y, nx, y));
          x = nx;
          lastCtrl = lastQuad = null;
          break;
        }
        case 'V': {
          const ny = num() + (rel ? y : 0);
          ensure().segs.push(lineSeg(x, y, x, ny));
          y = ny;
          lastCtrl = lastQuad = null;
          break;
        }
        case 'C': {
          const ox = rel ? x : 0;
          const oy = rel ? y : 0;
          const s: CubicSeg = [num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy];
          ensure().segs.push(s);
          lastCtrl = [s[2], s[3]];
          lastQuad = null;
          x = s[4];
          y = s[5];
          break;
        }
        case 'S': {
          const ox = rel ? x : 0;
          const oy = rel ? y : 0;
          const c1: Pt = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
          const s: CubicSeg = [c1[0], c1[1], num() + ox, num() + oy, num() + ox, num() + oy];
          ensure().segs.push(s);
          lastCtrl = [s[2], s[3]];
          lastQuad = null;
          x = s[4];
          y = s[5];
          break;
        }
        case 'Q':
        case 'T': {
          const ox = rel ? x : 0;
          const oy = rel ? y : 0;
          let q: Pt;
          if (C === 'Q') q = [num() + ox, num() + oy];
          else q = lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
          const ex = num() + ox;
          const ey = num() + oy;
          ensure().segs.push([
            x + (2 / 3) * (q[0] - x),
            y + (2 / 3) * (q[1] - y),
            ex + (2 / 3) * (q[0] - ex),
            ey + (2 / 3) * (q[1] - ey),
            ex,
            ey,
          ]);
          lastQuad = q;
          lastCtrl = null;
          x = ex;
          y = ey;
          break;
        }
        case 'A': {
          const rx = num();
          const ry = num();
          const rot = num();
          const large = num();
          const sweep = num();
          const ex = num() + (rel ? x : 0);
          const ey = num() + (rel ? y : 0);
          ensure().segs.push(...arcToCubics(x, y, rx, ry, rot, large ? 1 : 0, sweep ? 1 : 0, ex, ey));
          x = ex;
          y = ey;
          lastCtrl = lastQuad = null;
          break;
        }
        default:
          i++;
      }
    } while (hasNum());
  }
  return paths.filter((p) => p.segs.length > 0 || paths.length === 1);
}

const fmt = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Sérialise en chaîne « M … C … Z » (format stable pour l'interpolation numérique). */
export function serializePath(p: PathData): string {
  return p
    .map((sp) => {
      let s = `M ${fmt(sp.start[0])} ${fmt(sp.start[1])}`;
      for (const c of sp.segs) s += ` C ${c.map(fmt).join(' ')}`;
      if (sp.closed) s += ' Z';
      return s;
    })
    .join(' ');
}

/** Coupe un segment cubique en t (de Casteljau). */
export function splitCubic(p0: Pt, seg: CubicSeg, t: number): [CubicSeg, CubicSeg] {
  const [x1, y1, x2, y2, x3, y3] = seg;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const ax = lerp(p0[0], x1), ay = lerp(p0[1], y1);
  const bx = lerp(x1, x2), by = lerp(y1, y2);
  const cx = lerp(x2, x3), cy = lerp(y2, y3);
  const dx = lerp(ax, bx), dy = lerp(ay, by);
  const ex = lerp(bx, cx), ey = lerp(by, cy);
  const fx = lerp(dx, ex), fy = lerp(dy, ey);
  return [
    [ax, ay, dx, dy, fx, fy],
    [ex, ey, cx, cy, x3, y3],
  ];
}

function segStart(sp: Subpath, i: number): Pt {
  if (i === 0) return sp.start;
  const s = sp.segs[i - 1];
  return [s[4], s[5]];
}

function chordLen(p0: Pt, s: CubicSeg): number {
  return Math.hypot(s[4] - p0[0], s[5] - p0[1]) + Math.hypot(s[0] - p0[0], s[1] - p0[1]) * 0.01;
}

/** Ajoute des segments (en coupant les plus longs) jusqu'à atteindre n segments. */
function subdivideTo(sp: Subpath, n: number): Subpath {
  const out: Subpath = { start: [...sp.start] as Pt, segs: sp.segs.map((s) => [...s] as CubicSeg), closed: sp.closed };
  if (out.segs.length === 0) {
    out.segs.push([out.start[0], out.start[1], out.start[0], out.start[1], out.start[0], out.start[1]]);
  }
  while (out.segs.length < n) {
    let best = 0;
    let bestLen = -1;
    for (let i = 0; i < out.segs.length; i++) {
      const l = chordLen(segStart(out, i), out.segs[i]);
      if (l > bestLen) {
        bestLen = l;
        best = i;
      }
    }
    const [a, b] = splitCubic(segStart(out, best), out.segs[best], 0.5);
    out.segs.splice(best, 1, a, b);
  }
  return out;
}

function centroid(sp: Subpath): Pt {
  let x = sp.start[0];
  let y = sp.start[1];
  for (const s of sp.segs) {
    x += s[4];
    y += s[5];
  }
  const n = sp.segs.length + 1;
  return [x / n, y / n];
}

/** Sous-tracé dégénéré (un point) au centre d'un autre : sert à faire « naître » une forme. */
function collapsed(at: Pt, closed: boolean): Subpath {
  return { start: [at[0], at[1]], segs: [[at[0], at[1], at[0], at[1], at[0], at[1]]], closed };
}

/**
 * Pour un sous-tracé fermé, fait tourner le point de départ afin de
 * minimiser la distance avec la forme cible (morphing plus naturel).
 */
function alignClosed(a: Subpath, b: Subpath): Subpath {
  if (!a.closed || !b.closed || a.segs.length !== b.segs.length || a.segs.length < 2) return b;
  const n = b.segs.length;
  const ptsA = a.segs.map((s) => [s[4], s[5]] as Pt);
  let best = 0;
  let bestD = Infinity;
  for (let off = 0; off < n; off++) {
    let d = 0;
    for (let i = 0; i < n; i++) {
      const s = b.segs[(i + off) % n];
      d += (s[4] - ptsA[i][0]) ** 2 + (s[5] - ptsA[i][1]) ** 2;
    }
    if (d < bestD) {
      bestD = d;
      best = off;
    }
  }
  if (best === 0) return b;
  const segs: CubicSeg[] = [];
  for (let i = 0; i < n; i++) segs.push(b.segs[(i + best) % n]);
  const prev = b.segs[(best - 1 + n) % n];
  return { start: [prev[4], prev[5]], segs, closed: true };
}

/** Donne à deux tracés une structure identique (même nombre de sous-tracés et de segments). */
export function normalizePair(a: PathData, b: PathData): [PathData, PathData] {
  const n = Math.max(a.length, b.length);
  const outA: PathData = [];
  const outB: PathData = [];
  for (let i = 0; i < n; i++) {
    let sa = a[i];
    let sb = b[i];
    if (!sa) sa = collapsed(centroid(sb), sb.closed);
    if (!sb) sb = collapsed(centroid(sa), sa.closed);
    const count = Math.max(sa.segs.length, sb.segs.length, 1);
    const na = subdivideTo(sa, count);
    let nb = subdivideTo(sb, count);
    nb = alignClosed(na, nb);
    const closed = na.closed || nb.closed;
    na.closed = closed;
    nb.closed = closed;
    outA.push(na);
    outB.push(nb);
  }
  return [outA, outB];
}

/** Interpole deux tracés de même structure. */
export function lerpPathData(a: PathData, b: PathData, t: number): PathData {
  const l = (x: number, y: number) => x + (y - x) * t;
  return a.map((sa, i) => {
    const sb = b[i];
    return {
      start: [l(sa.start[0], sb.start[0]), l(sa.start[1], sb.start[1])] as Pt,
      segs: sa.segs.map((s, j) => s.map((v, k) => l(v, sb.segs[j][k])) as CubicSeg),
      closed: sa.closed,
    };
  });
}

const parseCache = new Map<string, PathData>();
const pairCache = new Map<string, [PathData, PathData]>();

export function parsePathCached(d: string): PathData {
  let p = parseCache.get(d);
  if (!p) {
    p = parsePath(d);
    if (parseCache.size > 500) parseCache.clear();
    parseCache.set(d, p);
  }
  return p;
}

export function normalizedPairCached(a: string, b: string): [PathData, PathData] {
  const key = `${a}\u0000${b}`;
  let p = pairCache.get(key);
  if (!p) {
    p = normalizePair(parsePathCached(a), parsePathCached(b));
    if (pairCache.size > 200) pairCache.clear();
    pairCache.set(key, p);
  }
  return p;
}

/** Morphing entre deux attributs d : renvoie le tracé intermédiaire. */
export function morphPath(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  if (a === b) return a;
  const [na, nb] = normalizedPairCached(a, b);
  return serializePath(lerpPathData(na, nb, t));
}

/** Point sur une cubique. */
export function cubicPoint(p0: Pt, s: CubicSeg, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * s[0] + c * s[2] + d * s[4], a * p0[1] + b * s[1] + c * s[3] + d * s[5]];
}

/** Longueur approchée d'un tracé (utile pour l'effet « tracé dessiné »). */
export function pathLength(p: PathData, steps = 16): number {
  let len = 0;
  for (const sp of p) {
    for (let i = 0; i < sp.segs.length; i++) {
      let prev = segStart(sp, i);
      const p0 = prev;
      for (let k = 1; k <= steps; k++) {
        const pt = cubicPoint(p0, sp.segs[i], k / steps);
        len += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
        prev = pt;
      }
    }
  }
  return len;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Boîte englobante (approchée par échantillonnage). */
export function pathBounds(p: PathData): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (pt: Pt) => {
    b.minX = Math.min(b.minX, pt[0]);
    b.minY = Math.min(b.minY, pt[1]);
    b.maxX = Math.max(b.maxX, pt[0]);
    b.maxY = Math.max(b.maxY, pt[1]);
  };
  for (const sp of p) {
    add(sp.start);
    for (let i = 0; i < sp.segs.length; i++) {
      const p0 = segStart(sp, i);
      for (let k = 1; k <= 8; k++) add(cubicPoint(p0, sp.segs[i], k / 8));
    }
  }
  if (!isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return b;
}

/** Applique une matrice affine [a b c d e f] à tous les points d'un tracé. */
export function transformPath(p: PathData, m: [number, number, number, number, number, number]): PathData {
  const tx = (x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  return p.map((sp) => ({
    start: tx(sp.start[0], sp.start[1]),
    segs: sp.segs.map((s) => {
      const a = tx(s[0], s[1]);
      const b = tx(s[2], s[3]);
      const c = tx(s[4], s[5]);
      return [a[0], a[1], b[0], b[1], c[0], c[1]] as CubicSeg;
    }),
    closed: sp.closed,
  }));
}

/** Recentre un tracé sur l'origine ; renvoie aussi le décalage appliqué. */
export function centerPath(d: string): { d: string; cx: number; cy: number; width: number; height: number } {
  const p = parsePath(d);
  const b = pathBounds(p);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return {
    d: serializePath(transformPath(p, [1, 0, 0, 1, -cx, -cy])),
    cx,
    cy,
    width: b.maxX - b.minX,
    height: b.maxY - b.minY,
  };
}

/**
 * Donne une structure commune à plusieurs tracés (export CSS / GSAP :
 * l'interpolation numérique directe des chaînes devient alors possible).
 */
export function normalizeMany(paths: PathData[]): PathData[] {
  if (paths.length === 0) return [];
  const n = Math.max(...paths.map((p) => p.length));
  const counts: number[] = [];
  const closed: boolean[] = [];
  for (let i = 0; i < n; i++) {
    counts.push(Math.max(1, ...paths.map((p) => p[i]?.segs.length ?? 0)));
    closed.push(paths.some((p) => p[i]?.closed));
  }
  const result: PathData[] = [];
  paths.forEach((p, k) => {
    const out: PathData = [];
    for (let i = 0; i < n; i++) {
      const ref = p[i] ?? paths.find((q) => q[i])![i];
      const sp = p[i] ?? collapsed(p.length ? centroid(p[p.length - 1]) : centroid(ref), closed[i]);
      let norm = subdivideTo(sp, counts[i]);
      norm.closed = closed[i];
      // Comme le moteur : chaque forme fermée est alignée sur la précédente.
      if (k > 0) norm = alignClosed(result[k - 1][i], norm);
      out.push(norm);
    }
    result.push(out);
  });
  return result;
}
