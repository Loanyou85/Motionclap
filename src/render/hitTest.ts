import {
  descendants,
  evaluateLayer,
  isActiveAt,
  isEffectivelyVisible,
  layerMap,
  maskLayerIds,
  worldMatrix,
} from '../engine/evaluate';
import { apply, invert, type Mat } from '../engine/matrix';
import type { Composition, Layer, Project } from '../engine/types';
import { localBounds, shapePathD, type LocalBounds } from './renderer';

let hitCtx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D {
  if (!hitCtx) hitCtx = document.createElement('canvas').getContext('2d')!;
  return hitCtx;
}

/** Coins d'une boîte locale transformés dans l'espace de la composition. */
export function boundsCorners(b: LocalBounds, m: Mat): Array<[number, number]> {
  return [
    apply(m, b.x, b.y),
    apply(m, b.x + b.w, b.y),
    apply(m, b.x + b.w, b.y + b.h),
    apply(m, b.x, b.y + b.h),
  ];
}

export interface LayerFrame {
  /** Boîte locale du calque (ou boîte englobante en espace monde pour un groupe). */
  bounds: LocalBounds;
  matrix: Mat;
}

/** Cadre de sélection d'un calque à l'instant t. */
export function layerFrame(project: Project, comp: Composition, layer: Layer, t: number): LayerFrame | null {
  const map = layerMap(comp);
  if (layer.type === 'group') {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const child of descendants(comp, layer.id)) {
      if (child.type === 'group') continue;
      const b = localBounds(child, evaluateLayer(child, t), project);
      if (!b) continue;
      for (const [x, y] of boundsCorners(b, worldMatrix(child, map, t))) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (!isFinite(minX)) return null;
    return { bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, matrix: [1, 0, 0, 1, 0, 0] };
  }
  const b = localBounds(layer, evaluateLayer(layer, t), project);
  if (!b) return null;
  return { bounds: b, matrix: worldMatrix(layer, map, t) };
}

/** Le point (espace composition) touche-t-il ce calque ? */
export function hitLayer(project: Project, comp: Composition, layer: Layer, t: number, x: number, y: number, tolerance: number): boolean {
  const map = layerMap(comp);
  const inv = invert(worldMatrix(layer, map, t));
  if (!inv) return false;
  const [lx, ly] = apply(inv, x, y);
  const v = evaluateLayer(layer, t);
  const d = shapePathD(layer, v);
  if (d) {
    const c = ctx();
    c.setTransform(1, 0, 0, 1, 0, 0);
    const p = new Path2D(d);
    const strokeOnly = layer.type === 'line';
    if (!strokeOnly && c.isPointInPath(p, lx, ly)) return true;
    c.lineWidth = Math.max(Number(v.strokeWidth) || 0, tolerance * 2);
    return c.isPointInStroke(p, lx, ly);
  }
  const b = localBounds(layer, v, project);
  if (!b) return false;
  return lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h;
}

/** Calque visible le plus haut sous le point, ou null. */
export function hitTest(project: Project, comp: Composition, t: number, x: number, y: number, tolerance = 6): Layer | null {
  const map = layerMap(comp);
  const masks = maskLayerIds(comp);
  for (let i = comp.layers.length - 1; i >= 0; i--) {
    const l = comp.layers[i];
    if (l.type === 'group' || masks.has(l.id) || l.locked) continue;
    if (!isEffectivelyVisible(l, map) || !isActiveAt(l, t)) continue;
    if (hitLayer(project, comp, l, t, x, y, tolerance)) return l;
  }
  return null;
}
