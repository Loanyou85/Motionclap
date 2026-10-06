import { easingToBezier } from '../engine/easing';
import { getProp, layerMap, maskLayerIds, parentChain } from '../engine/evaluate';
import { PROP_DEFS } from '../engine/props';
import type { Composition, Easing, Layer, Project, PropKey, PropValue } from '../engine/types';

/**
 * Modèle commun aux exports web (CSS, GSAP).
 * Chaque calque visible devient un élément, enveloppé par les transformations
 * de ses parents : l'ordre d'empilement du moteur est ainsi respecté.
 */

export interface RenderItem {
  /** Identifiant unique dans l'export (préfixé pour les précompositions). */
  uid: string;
  layer: Layer;
  /** Ancêtres, du plus lointain au plus proche. */
  ancestors: Layer[];
  /** Décalage temporel (précompositions). */
  offset: number;
  comp: Composition;
  /** Contenu imbriqué d'une précomposition. */
  children?: RenderItem[];
}

export interface ExportContext {
  project: Project;
  root: Composition;
  duration: number;
  fps: number;
  warnings: Set<string>;
}

export function createContext(project: Project, root: Composition): ExportContext {
  return { project, root, duration: root.duration, fps: root.fps, warnings: new Set() };
}

/** Identifiant CSS sûr. */
export const cssId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '');

export function collectItems(ctx: ExportContext, comp: Composition, offset = 0, prefix = '', depth = 0): RenderItem[] {
  const map = layerMap(comp);
  const masks = maskLayerIds(comp);
  const items: RenderItem[] = [];
  for (const layer of comp.layers) {
    if (layer.type === 'group' || masks.has(layer.id)) continue;
    const chain = parentChain(layer, map);
    if (!layer.visible || chain.some((p) => p.type === 'group' && !p.visible)) continue;
    if (layer.maskId) ctx.warnings.add('Les masques ne sont pas exportés en HTML/CSS et GSAP (utilisez Lottie ou la vidéo).');
    const item: RenderItem = {
      uid: cssId(`${prefix}${layer.id}`),
      layer,
      ancestors: chain.reverse(),
      offset,
      comp,
    };
    if (layer.type === 'precomp') {
      const sub = ctx.project.compositions.find((c) => c.id === layer.compId);
      if (sub && depth < 5) item.children = collectItems(ctx, sub, offset + layer.inPoint, `${item.uid}_`, depth + 1);
    }
    items.push(item);
  }
  return items;
}

// --- Segments d'animation ----------------------------------------------------

export type Values = Partial<Record<PropKey, PropValue>>;

export interface Segment {
  t0: number;
  t1: number;
  from: Values;
  to: Values;
  /** null = linéaire (segment échantillonné). */
  easing: Easing | null;
}

export interface TrackData {
  initial: Values;
  segments: Segment[];
}

export function evalValues(layer: Layer, keys: PropKey[], t: number): Values {
  const out: Values = {};
  for (const k of keys) out[k] = getProp(layer, k, t);
  return out;
}

const sameEasing = (a: Easing, b: Easing) =>
  a.type === b.type && (a.type !== 'cubicBezier' || JSON.stringify(a.bezier) === JSON.stringify(b.bezier));

/**
 * Découpe l'animation d'un groupe de propriétés en segments.
 * Les segments dont la courbe n'est pas commune ou pas exprimable en bézier
 * (élastique, rebond) sont échantillonnés à la cadence d'export.
 * Renvoie null si aucune propriété n'est animée.
 */
export function buildTrack(
  ctx: ExportContext,
  layer: Layer,
  keys: PropKey[],
  offset: number,
  forceBake = false,
  /** Courbes que la cible sait jouer telles quelles (ex. elastic de GSAP). */
  native: (e: Easing) => boolean = () => false,
): TrackData | null {
  const animated = keys.filter((k) => (layer.props[k]?.keyframes.length ?? 0) > 1);
  if (animated.length === 0) return null;
  const times = [...new Set(animated.flatMap((k) => layer.props[k]!.keyframes.map((kf) => kf.time)))].sort((a, b) => a - b);
  const toGlobal = (t: number) => t + offset;
  const segments: Segment[] = [];

  for (let i = 0; i < times.length - 1; i++) {
    const a = times[i];
    const b = times[i + 1];
    if (toGlobal(a) >= ctx.duration) break;
    // Courbe commune du segment ?
    let shared: Easing | null | 'none' = 'none';
    let bake = forceBake;
    for (const k of animated) {
      const kfs = layer.props[k]!.keyframes;
      const k0 = kfs.find((kf) => Math.abs(kf.time - a) < 1e-6);
      const k1 = kfs.find((kf) => Math.abs(kf.time - b) < 1e-6);
      const inside = kfs[0].time < b - 1e-6 && kfs[kfs.length - 1].time > a + 1e-6;
      if (!inside) continue; // constante sur ce segment
      if (!k0 || !k1) {
        bake = true;
        break;
      }
      if (shared === 'none') shared = k0.easing;
      else if (shared && !sameEasing(shared, k0.easing)) {
        bake = true;
        break;
      }
    }
    const easing = shared === 'none' ? ({ type: 'linear' } as Easing) : shared;
    if (!bake && easing && (easing.type === 'hold' || easingToBezier(easing) || native(easing))) {
      segments.push({ t0: toGlobal(a), t1: toGlobal(b), from: evalValues(layer, keys, a), to: evalValues(layer, keys, b), easing });
      continue;
    }
    // Échantillonnage linéaire du segment
    const steps = Math.max(2, Math.ceil((b - a) * ctx.fps));
    for (let s = 0; s < steps; s++) {
      const s0 = a + ((b - a) * s) / steps;
      const s1 = a + ((b - a) * (s + 1)) / steps;
      segments.push({ t0: toGlobal(s0), t1: toGlobal(s1), from: evalValues(layer, keys, s0), to: evalValues(layer, keys, s1), easing: null });
    }
  }
  if (segments.length === 0) return null;
  return { initial: evalValues(layer, keys, Math.max(0, -offset)), segments };
}

/** Échantillonnage brut d'une fonction du temps, compressé (points alignés supprimés). */
export function sampleTimeline<T extends number[]>(
  ctx: ExportContext,
  from: number,
  to: number,
  fn: (t: number) => T,
): Array<{ t: number; v: T }> {
  const out: Array<{ t: number; v: T }> = [];
  const steps = Math.max(1, Math.ceil((to - from) * ctx.fps));
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    out.push({ t, v: fn(t) });
  }
  // Suppression des points intermédiaires redondants (interpolation linéaire exacte).
  const kept: Array<{ t: number; v: T }> = [out[0]];
  for (let i = 1; i < out.length - 1; i++) {
    const p = kept[kept.length - 1];
    const c = out[i];
    const n = out[i + 1];
    const r = (c.t - p.t) / (n.t - p.t);
    const collinear = c.v.every((v, j) => Math.abs(p.v[j] + (n.v[j] - p.v[j]) * r - v) < 1e-3);
    if (!collinear) kept.push(c);
  }
  if (out.length > 1) kept.push(out[out.length - 1]);
  return kept;
}

export const num = (v: PropValue | undefined, d = 3) => {
  const n = Number(v) || 0;
  const f = 10 ** d;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

export const pct = (t: number, duration: number) => `${num((t / duration) * 100, 4)}%`;

export function isPropAnimated(layer: Layer, key: PropKey): boolean {
  return (layer.props[key]?.keyframes.length ?? 0) > 1;
}

export function propType(key: PropKey) {
  return PROP_DEFS[key].type;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
