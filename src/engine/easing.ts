import type { Bezier, Easing, EasingType } from './types';

/**
 * Courbes représentables exactement par une cubic-bezier CSS.
 * « back » utilise les valeurs de référence d'easings.net, ce qui permet
 * un export CSS / Lottie fidèle sans échantillonnage.
 */
export const BEZIER_PRESETS: Partial<Record<EasingType, Bezier>> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.32, 0, 0.67, 0],
  easeOut: [0.33, 1, 0.68, 1],
  easeInOut: [0.65, 0, 0.35, 1],
  backIn: [0.36, 0, 0.66, -0.56],
  backOut: [0.34, 1.56, 0.64, 1],
  backInOut: [0.68, -0.6, 0.32, 1.6],
};

export const EASING_LABELS: Record<EasingType, string> = {
  linear: 'Linéaire',
  easeIn: 'Ease-in (accélère)',
  easeOut: 'Ease-out (ralentit)',
  easeInOut: 'Ease-in-out',
  cubicBezier: 'Cubic-bezier personnalisée',
  backIn: 'Back in (recul)',
  backOut: 'Back out (dépassement)',
  backInOut: 'Back in-out',
  elasticIn: 'Élastique in',
  elasticOut: 'Élastique out',
  bounceIn: 'Rebond in',
  bounceOut: 'Rebond out',
  hold: 'Maintien',
};

export const EASING_TYPES = Object.keys(EASING_LABELS) as EasingType[];

export const DEFAULT_EASING: Easing = { type: 'easeInOut' };

/** Renvoie la bezier équivalente si la courbe est exprimable ainsi, sinon null. */
export function easingToBezier(e: Easing): Bezier | null {
  if (e.type === 'cubicBezier') return e.bezier ?? [0.25, 0.1, 0.25, 1];
  return BEZIER_PRESETS[e.type] ?? null;
}

/**
 * Évalue une cubic-bezier CSS (P0 = 0,0 ; P3 = 1,1) : renvoie y pour x donné.
 * Newton-Raphson puis dichotomie de secours, comme les navigateurs.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-7) return sampleY(t);
    const d = sampleDX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 60; i++) {
    const v = sampleX(t);
    if (Math.abs(v - x) < 1e-7) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}

function bounceOut(p: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) {
    const q = p - 1.5 / d1;
    return n1 * q * q + 0.75;
  }
  if (p < 2.5 / d1) {
    const q = p - 2.25 / d1;
    return n1 * q * q + 0.9375;
  }
  const q = p - 2.625 / d1;
  return n1 * q * q + 0.984375;
}

function elasticOut(p: number): number {
  if (p === 0 || p === 1) return p;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
}

/** Applique une courbe à une progression p ∈ [0, 1]. */
export function applyEasing(e: Easing, p: number): number {
  const t = Math.min(1, Math.max(0, p));
  switch (e.type) {
    case 'linear':
      return t;
    case 'hold':
      return t >= 1 ? 1 : 0;
    case 'elasticOut':
      return elasticOut(t);
    case 'elasticIn':
      return 1 - elasticOut(1 - t);
    case 'bounceOut':
      return bounceOut(t);
    case 'bounceIn':
      return 1 - bounceOut(1 - t);
    default: {
      const b = easingToBezier(e);
      if (!b) return t;
      return cubicBezier(b[0], b[1], b[2], b[3], t);
    }
  }
}

/** Échantillonne une courbe pour l'affichage (éditeur de courbe, timeline). */
export function sampleEasing(e: Easing, steps = 48): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const x = i / steps;
    pts.push([x, applyEasing(e, x)]);
  }
  return pts;
}
