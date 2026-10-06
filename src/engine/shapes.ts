import type { Pt } from './path';

/** Sommets d'une étoile centrée sur l'origine, première branche vers le haut. */
export function starPoints(branches: number, outer: number, innerRatio: number): Pt[] {
  const n = Math.max(3, Math.round(branches));
  const inner = outer * innerRatio;
  const pts: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

/** Sommets d'un polygone régulier, premier sommet vers le haut. */
export function polygonPoints(sides: number, radius: number): Pt[] {
  const n = Math.max(3, Math.round(sides));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return pts;
}

const f = (v: number) => String(Math.round(v * 100) / 100);

export function pointsToPathD(pts: Pt[], closed = true): string {
  if (pts.length === 0) return '';
  const [first, ...rest] = pts;
  return `M ${f(first[0])} ${f(first[1])}` + rest.map((p) => ` L ${f(p[0])} ${f(p[1])}`).join('') + (closed ? ' Z' : '');
}

/** Rectangle centré à coins arrondis, au format d'un attribut d SVG. */
export function roundedRectPathD(w: number, h: number, r: number): string {
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr === 0) return `M ${f(x)} ${f(y)} H ${f(x + w)} V ${f(y + h)} H ${f(x)} Z`;
  return [
    `M ${f(x + rr)} ${f(y)}`,
    `H ${f(x + w - rr)}`,
    `A ${f(rr)} ${f(rr)} 0 0 1 ${f(x + w)} ${f(y + rr)}`,
    `V ${f(y + h - rr)}`,
    `A ${f(rr)} ${f(rr)} 0 0 1 ${f(x + w - rr)} ${f(y + h)}`,
    `H ${f(x + rr)}`,
    `A ${f(rr)} ${f(rr)} 0 0 1 ${f(x)} ${f(y + h - rr)}`,
    `V ${f(y + rr)}`,
    `A ${f(rr)} ${f(rr)} 0 0 1 ${f(x + rr)} ${f(y)}`,
    'Z',
  ].join(' ');
}

export function ellipsePathD(w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  return `M ${f(-rx)} 0 A ${f(rx)} ${f(ry)} 0 1 1 ${f(rx)} 0 A ${f(rx)} ${f(ry)} 0 1 1 ${f(-rx)} 0 Z`;
}
