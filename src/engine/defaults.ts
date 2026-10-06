import { uid } from './id';
import { LAYER_PROPS, LAYER_TYPE_LABELS, PROP_DEFS } from './props';
import type { AnimProp, Composition, Layer, LayerType, Project, PropKey, PropValue } from './types';

export interface FormatPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const FORMATS: FormatPreset[] = [
  { id: '16:9', label: '16:9 — Paysage', width: 1920, height: 1080 },
  { id: '9:16', label: '9:16 — Vertical', width: 1080, height: 1920 },
  { id: '1:1', label: '1:1 — Carré', width: 1080, height: 1080 },
];

export function formatIdOf(comp: Pick<Composition, 'width' | 'height'>): string {
  return FORMATS.find((f) => f.width === comp.width && f.height === comp.height)?.id ?? 'custom';
}

export const prop = (value: PropValue): AnimProp => ({ value, keyframes: [] });

/** Valeurs initiales par type, pensées pour une scène 1920×1080. */
const TYPE_DEFAULTS: Partial<Record<LayerType, Partial<Record<PropKey, PropValue>>>> = {
  rect: { width: 320, height: 200, radius: 16, fill: '#1E5EFF' },
  ellipse: { width: 220, height: 220, fill: '#3B82F6' },
  star: { radius: 140, innerRadius: 0.45, points: 5, fill: '#1E5EFF' },
  polygon: { radius: 140, points: 6, fill: '#3B82F6' },
  line: { width: 400, stroke: '#0A1F44', strokeWidth: 8, trim: 1 },
  text: { fill: '#0A1F44', fontSize: 96, reveal: 1, waveAmp: 12 },
  image: { width: 400, height: 300, radius: 0 },
  path: { fill: '#1E5EFF', trim: 1 },
};

export function createLayer(
  type: LayerType,
  comp: Pick<Composition, 'width' | 'height' | 'duration'>,
  overrides: Partial<Layer> = {},
  values: Partial<Record<PropKey, PropValue>> = {},
): Layer {
  const props: Layer['props'] = {};
  const typeDefaults = TYPE_DEFAULTS[type] ?? {};
  for (const key of LAYER_PROPS[type]) {
    let v: PropValue = PROP_DEFS[key].default;
    if (key === 'x') v = comp.width / 2;
    if (key === 'y') v = comp.height / 2;
    if (typeDefaults[key] !== undefined) v = typeDefaults[key]!;
    if (values[key] !== undefined) v = values[key]!;
    props[key] = prop(v);
  }
  const layer: Layer = {
    id: uid('l'),
    name: LAYER_TYPE_LABELS[type],
    type,
    visible: true,
    locked: false,
    parentId: null,
    maskId: null,
    maskInvert: false,
    inPoint: 0,
    outPoint: comp.duration,
    props,
    ...overrides,
  };
  if (type === 'text') {
    layer.text ??= 'Atelier Motion';
    layer.fontFamily ??= 'Inter';
    layer.fontWeight ??= 700;
    layer.textAlign ??= 'center';
    layer.textMode ??= 'none';
  }
  if (type === 'group') layer.collapsed ??= false;
  return layer;
}

export function createComposition(overrides: Partial<Composition> = {}): Composition {
  return {
    id: uid('c'),
    name: 'Composition principale',
    width: 1920,
    height: 1080,
    duration: 5,
    fps: 30,
    background: '#FFFFFF',
    layers: [],
    audio: null,
    ...overrides,
  };
}

export function createProject(name = 'Projet sans titre', comp?: Composition): Project {
  const c = comp ?? createComposition();
  const now = Date.now();
  return {
    version: 1,
    id: uid('p'),
    name,
    createdAt: now,
    updatedAt: now,
    mainCompId: c.id,
    compositions: [c],
    assets: [],
  };
}

/** Vérifie grossièrement la forme d'un projet importé (JSON). */
export function isProject(data: unknown): data is Project {
  if (!data || typeof data !== 'object') return false;
  const p = data as Partial<Project>;
  return (
    p.version === 1 &&
    typeof p.id === 'string' &&
    typeof p.mainCompId === 'string' &&
    Array.isArray(p.compositions) &&
    p.compositions.every((c) => c && Array.isArray(c.layers)) &&
    Array.isArray(p.assets)
  );
}
