import { evaluateProp } from './interpolate';
import { fromTRS, IDENTITY, multiply, type Mat } from './matrix';
import { PROP_DEFS } from './props';
import type { Composition, EvaluatedProps, Layer, PropKey, PropValue } from './types';

const ALL_KEYS = Object.keys(PROP_DEFS) as PropKey[];

/** Évalue une seule propriété d'un calque (valeur par défaut si absente). */
export function getProp(layer: Layer, key: PropKey, t: number): PropValue {
  const prop = layer.props[key];
  const def = PROP_DEFS[key];
  if (!prop) return def.default;
  const v = evaluateProp(prop, def.type, t);
  if (def.integer && typeof v === 'number') return Math.round(v);
  return v;
}

export function getNum(layer: Layer, key: PropKey, t: number): number {
  const v = getProp(layer, key, t);
  return typeof v === 'number' ? v : Number(v) || 0;
}

/** Évalue toutes les propriétés d'un calque à l'instant t. */
export function evaluateLayer(layer: Layer, t: number): EvaluatedProps {
  const out = {} as EvaluatedProps;
  for (const k of ALL_KEYS) out[k] = getProp(layer, k, t);
  return out;
}

export function localMatrix(layer: Layer, t: number): Mat {
  return fromTRS(
    getNum(layer, 'x', t),
    getNum(layer, 'y', t),
    getNum(layer, 'rotation', t),
    getNum(layer, 'scaleX', t),
    getNum(layer, 'scaleY', t),
  );
}

export function layerMap(comp: Composition): Map<string, Layer> {
  return new Map(comp.layers.map((l) => [l.id, l]));
}

/** Chaîne des parents (du plus proche au plus lointain), protégée contre les cycles. */
export function parentChain(layer: Layer, map: Map<string, Layer>): Layer[] {
  const chain: Layer[] = [];
  const seen = new Set<string>([layer.id]);
  let p = layer.parentId ? map.get(layer.parentId) : undefined;
  while (p && !seen.has(p.id)) {
    chain.push(p);
    seen.add(p.id);
    p = p.parentId ? map.get(p.parentId) : undefined;
  }
  return chain;
}

/** Matrice monde : transformations des parents appliquées successivement. */
export function worldMatrix(layer: Layer, map: Map<string, Layer>, t: number): Mat {
  let m = localMatrix(layer, t);
  for (const p of parentChain(layer, map)) m = multiply(localMatrix(p, t), m);
  return m;
}

/** Les groupes transmettent aussi opacité et visibilité à leurs enfants. */
export function inheritedOpacity(layer: Layer, map: Map<string, Layer>, t: number): number {
  let o = getNum(layer, 'opacity', t);
  for (const p of parentChain(layer, map)) if (p.type === 'group') o *= getNum(p, 'opacity', t);
  return o;
}

export function isEffectivelyVisible(layer: Layer, map: Map<string, Layer>): boolean {
  if (!layer.visible) return false;
  for (const p of parentChain(layer, map)) if (p.type === 'group' && !p.visible) return false;
  return true;
}

/** Le calque est-il actif (entre son point d'entrée et de sortie) ? */
export function isActiveAt(layer: Layer, t: number): boolean {
  return t >= layer.inPoint - 1e-9 && t <= layer.outPoint + 1e-9;
}

/** Ensemble des calques utilisés comme masques (non dessinés directement). */
export function maskLayerIds(comp: Composition): Set<string> {
  const s = new Set<string>();
  for (const l of comp.layers) if (l.maskId) s.add(l.maskId);
  return s;
}

/** Descendants (enfants, petits-enfants…) d'un calque. */
export function descendants(comp: Composition, id: string): Layer[] {
  const out: Layer[] = [];
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    for (const l of comp.layers) {
      if (l.parentId === cur && !seen.has(l.id)) {
        seen.add(l.id);
        out.push(l);
        stack.push(l.id);
      }
    }
  }
  return out;
}

/** Vérifie qu'affecter `parentId` à `id` ne crée pas de cycle. */
export function canParent(comp: Composition, id: string, parentId: string | null): boolean {
  if (!parentId) return true;
  if (parentId === id) return false;
  return !descendants(comp, id).some((l) => l.id === parentId);
}

export { IDENTITY };
