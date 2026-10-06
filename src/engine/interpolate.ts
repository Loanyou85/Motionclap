import { applyEasing } from './easing';
import { lerpColor } from './color';
import { morphPath } from './path';
import type { AnimProp, Keyframe, PropType, PropValue } from './types';

export function interpolateValue(type: PropType, a: PropValue, b: PropValue, t: number): PropValue {
  switch (type) {
    case 'number':
      return (a as number) + ((b as number) - (a as number)) * t;
    case 'color':
      // Les courbes back/élastiques peuvent dépasser [0,1] : on borne pour la couleur.
      return lerpColor(String(a), String(b), Math.min(1, Math.max(0, t)));
    case 'path':
      return morphPath(String(a), String(b), Math.min(1, Math.max(0, t)));
  }
}

/** Images clés triées (copie). */
export function sortedKeyframes(kfs: Keyframe[]): Keyframe[] {
  return [...kfs].sort((a, b) => a.time - b.time);
}

/** Trouve le segment actif à l'instant t. */
export function findSegment(kfs: Keyframe[], t: number): { k0: Keyframe; k1: Keyframe | null } {
  if (t <= kfs[0].time) return { k0: kfs[0], k1: null };
  for (let i = 0; i < kfs.length - 1; i++) {
    if (t < kfs[i + 1].time) return { k0: kfs[i], k1: kfs[i + 1] };
  }
  return { k0: kfs[kfs.length - 1], k1: null };
}

/**
 * Valeur d'une propriété à l'instant t.
 * Les images clés sont supposées triées par temps (invariant du store).
 */
export function evaluateProp(prop: AnimProp, type: PropType, t: number): PropValue {
  const kfs = prop.keyframes;
  if (kfs.length === 0) return prop.value;
  if (kfs.length === 1) return kfs[0].value;
  const { k0, k1 } = findSegment(kfs, t);
  if (!k1) return k0.value;
  const span = k1.time - k0.time;
  const p = span <= 0 ? 1 : (t - k0.time) / span;
  const eased = applyEasing(k0.easing, p);
  return interpolateValue(type, k0.value, k1.value, eased);
}

export function isAnimated(prop: AnimProp | undefined): boolean {
  return !!prop && prop.keyframes.length > 0;
}

/** Image clé située (à une demi-image près) au temps t. */
export function keyframeAt(prop: AnimProp | undefined, t: number, tolerance = 1e-3): Keyframe | undefined {
  return prop?.keyframes.find((k) => Math.abs(k.time - t) <= tolerance);
}
