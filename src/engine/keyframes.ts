import { DEFAULT_EASING } from './easing';
import { getProp } from './evaluate';
import { uid } from './id';
import { PROP_DEFS } from './props';
import type { AnimProp, Easing, Keyframe, Layer, PropKey, PropValue } from './types';

/**
 * Opérations sur les images clés. Elles modifient l'objet reçu :
 * elles s'utilisent sur un brouillon immer (store) ou sur une copie (tests).
 */

export const TIME_EPS = 1e-3;

export function ensureProp(layer: Layer, key: PropKey): AnimProp {
  let p = layer.props[key];
  if (!p) {
    p = { value: PROP_DEFS[key].default, keyframes: [] };
    layer.props[key] = p;
  }
  return p;
}

export function sortProp(p: AnimProp): void {
  p.keyframes.sort((a, b) => a.time - b.time);
}

/** Ajoute ou met à jour l'image clé au temps t. */
export function upsertKeyframe(p: AnimProp, t: number, value: PropValue, easing?: Easing): Keyframe {
  const existing = p.keyframes.find((k) => Math.abs(k.time - t) <= TIME_EPS);
  if (existing) {
    existing.value = value;
    if (easing) existing.easing = { ...easing };
    return existing;
  }
  // Nouvelle image clé : reprend la courbe de l'image clé précédente si elle existe.
  const prev = [...p.keyframes].reverse().find((k) => k.time < t);
  const kf: Keyframe = { id: uid('k'), time: t, value, easing: { ...(easing ?? prev?.easing ?? DEFAULT_EASING) } };
  p.keyframes.push(kf);
  sortProp(p);
  return kf;
}

/**
 * Modifie une propriété comme le ferait l'utilisateur dans le panneau :
 * si elle est animée, crée/modifie l'image clé au temps courant, sinon change la valeur fixe.
 */
export function setPropValue(layer: Layer, key: PropKey, value: PropValue, t: number): void {
  const p = ensureProp(layer, key);
  if (p.keyframes.length > 0) upsertKeyframe(p, t, value);
  else p.value = value;
}

/** Bascule « chronomètre » : ajoute une image clé à t, ou la supprime si elle existe. */
export function toggleKeyframe(layer: Layer, key: PropKey, t: number): void {
  const p = ensureProp(layer, key);
  const idx = p.keyframes.findIndex((k) => Math.abs(k.time - t) <= TIME_EPS);
  if (idx >= 0) {
    const [removed] = p.keyframes.splice(idx, 1);
    if (p.keyframes.length === 0) p.value = removed.value;
  } else {
    upsertKeyframe(p, t, getProp(layer, key, t));
  }
}

export function removeKeyframes(layer: Layer, ids: Set<string>): void {
  for (const key of Object.keys(layer.props) as PropKey[]) {
    const p = layer.props[key]!;
    const before = p.keyframes.length;
    const kept = p.keyframes.filter((k) => !ids.has(k.id));
    if (kept.length !== before) {
      if (kept.length === 0 && p.keyframes.length > 0) {
        // Conserver la valeur courante comme valeur fixe.
        p.value = p.keyframes[0].value;
      }
      p.keyframes = kept;
    }
  }
}

/** Déplace des images clés de `dt` secondes (bornées à [0, duration]). */
export function shiftKeyframes(layer: Layer, ids: Set<string>, dt: number, duration: number): void {
  for (const key of Object.keys(layer.props) as PropKey[]) {
    const p = layer.props[key]!;
    let changed = false;
    for (const k of p.keyframes) {
      if (ids.has(k.id)) {
        k.time = Math.min(duration, Math.max(0, k.time + dt));
        changed = true;
      }
    }
    if (changed) sortProp(p);
  }
}

export function setKeyframeEasing(layer: Layer, ids: Set<string>, easing: Easing): void {
  for (const key of Object.keys(layer.props) as PropKey[]) {
    for (const k of layer.props[key]!.keyframes) if (ids.has(k.id)) k.easing = { ...easing };
  }
}

/** Toutes les images clés d'un calque, avec la propriété correspondante. */
export function allKeyframes(layer: Layer): Array<{ key: PropKey; kf: Keyframe }> {
  const out: Array<{ key: PropKey; kf: Keyframe }> = [];
  for (const key of Object.keys(layer.props) as PropKey[]) {
    for (const kf of layer.props[key]!.keyframes) out.push({ key, kf });
  }
  return out;
}

export function animatedKeys(layer: Layer): PropKey[] {
  return (Object.keys(layer.props) as PropKey[]).filter((k) => layer.props[k]!.keyframes.length > 0);
}

/** Copie profonde d'un calque avec de nouveaux identifiants d'images clés. */
export function cloneLayerKeyframeIds(layer: Layer): void {
  for (const key of Object.keys(layer.props) as PropKey[]) {
    for (const k of layer.props[key]!.keyframes) k.id = uid('k');
  }
}
