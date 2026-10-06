import type { LayerType, PropKey, PropType, PropValue } from './types';

export type PropDisplay = 'px' | 'percent' | 'deg' | 'raw';
export type PropGroup = 'transform' | 'appearance' | 'shape' | 'text';

export interface PropDef {
  label: string;
  type: PropType;
  group: PropGroup;
  default: PropValue;
  min?: number;
  max?: number;
  /** Pas de l'incrément dans l'unité affichée. */
  step?: number;
  display?: PropDisplay;
  /** Arrondir à l'entier lors de l'évaluation (nombre de branches...). */
  integer?: boolean;
}

/** Registre de toutes les propriétés animables. */
export const PROP_DEFS: Record<PropKey, PropDef> = {
  x: { label: 'Position X', type: 'number', group: 'transform', default: 0, display: 'px' },
  y: { label: 'Position Y', type: 'number', group: 'transform', default: 0, display: 'px' },
  scaleX: { label: 'Échelle X', type: 'number', group: 'transform', default: 1, display: 'percent', step: 1 },
  scaleY: { label: 'Échelle Y', type: 'number', group: 'transform', default: 1, display: 'percent', step: 1 },
  rotation: { label: 'Rotation', type: 'number', group: 'transform', default: 0, display: 'deg' },
  opacity: { label: 'Opacité', type: 'number', group: 'transform', default: 1, min: 0, max: 1, display: 'percent', step: 1 },
  blur: { label: 'Flou', type: 'number', group: 'appearance', default: 0, min: 0, display: 'px' },
  fill: { label: 'Remplissage', type: 'color', group: 'appearance', default: '#1E5EFF' },
  stroke: { label: 'Contour', type: 'color', group: 'appearance', default: '#0A1F4400' },
  strokeWidth: { label: 'Épaisseur', type: 'number', group: 'appearance', default: 0, min: 0, display: 'px' },
  width: { label: 'Largeur', type: 'number', group: 'shape', default: 200, min: 0, display: 'px' },
  height: { label: 'Hauteur', type: 'number', group: 'shape', default: 200, min: 0, display: 'px' },
  radius: { label: 'Rayon', type: 'number', group: 'shape', default: 0, min: 0, display: 'px' },
  innerRadius: { label: 'Rayon intérieur', type: 'number', group: 'shape', default: 0.45, min: 0, max: 1, display: 'percent', step: 1 },
  points: { label: 'Branches', type: 'number', group: 'shape', default: 5, min: 3, max: 64, display: 'raw', integer: true },
  trim: { label: 'Tracé dessiné', type: 'number', group: 'shape', default: 1, min: 0, max: 1, display: 'percent', step: 1 },
  path: { label: 'Tracé SVG', type: 'path', group: 'shape', default: 'M -50 -50 L 50 -50 L 50 50 L -50 50 Z' },
  fontSize: { label: 'Taille', type: 'number', group: 'text', default: 72, min: 1, display: 'px' },
  letterSpacing: { label: 'Interlettrage', type: 'number', group: 'text', default: 0, display: 'px' },
  reveal: { label: 'Révélation', type: 'number', group: 'text', default: 1, min: 0, max: 1, display: 'percent', step: 1 },
  waveAmp: { label: 'Amplitude vague', type: 'number', group: 'text', default: 12, display: 'px' },
};

const TRANSFORM: PropKey[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'blur'];
const PAINT: PropKey[] = ['fill', 'stroke', 'strokeWidth'];

/** Propriétés disponibles pour chaque type de calque. */
export const LAYER_PROPS: Record<LayerType, PropKey[]> = {
  rect: [...TRANSFORM, ...PAINT, 'width', 'height', 'radius'],
  ellipse: [...TRANSFORM, ...PAINT, 'width', 'height'],
  star: [...TRANSFORM, ...PAINT, 'radius', 'innerRadius', 'points'],
  polygon: [...TRANSFORM, ...PAINT, 'radius', 'points'],
  line: [...TRANSFORM, 'stroke', 'strokeWidth', 'width', 'trim'],
  text: [...TRANSFORM, ...PAINT, 'fontSize', 'letterSpacing', 'reveal', 'waveAmp'],
  image: [...TRANSFORM, 'width', 'height', 'radius'],
  path: [...TRANSFORM, ...PAINT, 'path', 'trim'],
  group: [...TRANSFORM],
  precomp: [...TRANSFORM],
};

export const LAYER_TYPE_LABELS: Record<LayerType, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  star: 'Étoile',
  polygon: 'Polygone',
  line: 'Ligne',
  text: 'Texte',
  image: 'Image',
  path: 'Tracé SVG',
  group: 'Groupe',
  precomp: 'Précomposition',
};

export function layerHasProp(type: LayerType, key: PropKey): boolean {
  return LAYER_PROPS[type].includes(key);
}

/** Convertit une valeur interne vers l'unité affichée (ex. 1 → 100 %). */
export function toDisplay(key: PropKey, v: number): number {
  return PROP_DEFS[key].display === 'percent' ? v * 100 : v;
}

export function fromDisplay(key: PropKey, v: number): number {
  return PROP_DEFS[key].display === 'percent' ? v / 100 : v;
}

export function clampProp(key: PropKey, v: number): number {
  const def = PROP_DEFS[key];
  let out = v;
  if (def.min !== undefined) out = Math.max(def.min, out);
  if (def.max !== undefined) out = Math.min(def.max, out);
  return out;
}
