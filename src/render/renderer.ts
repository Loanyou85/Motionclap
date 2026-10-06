import { isVisibleColor } from '../engine/color';
import {
  evaluateLayer,
  inheritedOpacity,
  isActiveAt,
  isEffectivelyVisible,
  layerMap,
  maskLayerIds,
  worldMatrix,
} from '../engine/evaluate';
import { multiply, type Mat } from '../engine/matrix';
import { parsePathCached, pathBounds, pathLength } from '../engine/path';
import { ellipsePathD, pointsToPathD, polygonPoints, roundedRectPathD, starPoints } from '../engine/shapes';
import { letterStates } from '../engine/text';
import type { Composition, EvaluatedProps, Layer, Project } from '../engine/types';
import { getImage } from './assets';

type Ctx = CanvasRenderingContext2D;

export interface RenderContext {
  project: Project;
  time: number;
  /** Pixels du canvas par pixel de composition (zoom ou facteur d'export). */
  scale: number;
  depth?: number;
}

const MAX_DEPTH = 6;

// --- Canvas de travail réutilisés (masques, précompositions) -----------------

const scratch = new Map<string, HTMLCanvasElement>();
function scratchCanvas(key: string, w: number, h: number): HTMLCanvasElement {
  let c = scratch.get(key);
  if (!c) {
    c = document.createElement('canvas');
    scratch.set(key, c);
  }
  const W = Math.max(1, Math.ceil(w));
  const H = Math.max(1, Math.ceil(h));
  if (c.width !== W || c.height !== H) {
    c.width = W;
    c.height = H;
  } else {
    const cx = c.getContext('2d')!;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, W, H);
  }
  return c;
}

// --- Mesure du texte ---------------------------------------------------------

let measureCtx: Ctx | null = null;
function measurer(): Ctx {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

const widthCache = new Map<string, number>();
function charWidth(font: string, ch: string): number {
  const key = `${font}|${ch}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    const m = measurer();
    m.font = font;
    w = m.measureText(ch).width;
    if (widthCache.size > 5000) widthCache.clear();
    widthCache.set(key, w);
  }
  return w;
}

/** Les polices web se chargent après le premier rendu : on vide le cache à ce moment. */
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.addEventListener?.('loadingdone', () => widthCache.clear());
}

export function fontString(layer: Layer, size: number): string {
  return `${layer.fontWeight ?? 700} ${size}px ${layer.fontFamily ?? 'Inter'}, system-ui, sans-serif`;
}

export interface GlyphLayout {
  char: string;
  index: number;
  x: number; // centre de la lettre
  y: number; // ligne médiane
  w: number;
}

export interface TextLayout {
  glyphs: GlyphLayout[];
  width: number;
  height: number;
}

/** Disposition lettre par lettre d'un texte centré sur l'origine. */
export function layoutText(layer: Layer, fontSize: number, letterSpacing: number): TextLayout {
  const font = fontString(layer, fontSize);
  const lines = (layer.text ?? '').split('\n');
  const lh = fontSize * 1.2;
  const lineWidths = lines.map((line) => {
    const chars = Array.from(line);
    return chars.reduce((s, c) => s + charWidth(font, c), 0) + Math.max(0, chars.length - 1) * letterSpacing;
  });
  const width = Math.max(0, ...lineWidths);
  const height = lines.length * lh;
  const glyphs: GlyphLayout[] = [];
  let index = 0;
  lines.forEach((line, li) => {
    const lw = lineWidths[li];
    let x = layer.textAlign === 'left' ? -width / 2 : layer.textAlign === 'right' ? width / 2 - lw : -lw / 2;
    const y = -height / 2 + lh * (li + 0.5);
    for (const c of Array.from(line)) {
      const w = charWidth(font, c);
      glyphs.push({ char: c, index, x: x + w / 2, y, w });
      x += w + letterSpacing;
      index++;
    }
    index++; // saut de ligne
  });
  return { glyphs, width, height };
}

// --- Géométrie des calques ----------------------------------------------------

/** Tracé local d'une forme (centré sur l'origine du calque). */
export function shapePathD(layer: Layer, v: EvaluatedProps): string | null {
  const n = (k: keyof EvaluatedProps) => Number(v[k]) || 0;
  switch (layer.type) {
    case 'rect':
      return roundedRectPathD(n('width'), n('height'), n('radius'));
    case 'ellipse':
      return ellipsePathD(n('width'), n('height'));
    case 'star':
      return pointsToPathD(starPoints(n('points'), n('radius'), n('innerRadius')));
    case 'polygon':
      return pointsToPathD(polygonPoints(n('points'), n('radius')));
    case 'line': {
      const w = n('width') / 2;
      return `M ${-w} 0 L ${w} 0`;
    }
    case 'path':
      return String(v.path);
    default:
      return null;
  }
}

export interface LocalBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Boîte englobante locale d'un calque (hors groupe). */
export function localBounds(layer: Layer, v: EvaluatedProps, project: Project): LocalBounds | null {
  const n = (k: keyof EvaluatedProps) => Number(v[k]) || 0;
  switch (layer.type) {
    case 'rect':
    case 'ellipse':
    case 'image':
      return { x: -n('width') / 2, y: -n('height') / 2, w: n('width'), h: n('height') };
    case 'star':
    case 'polygon':
      return { x: -n('radius'), y: -n('radius'), w: n('radius') * 2, h: n('radius') * 2 };
    case 'line': {
      const sw = Math.max(n('strokeWidth'), 4);
      return { x: -n('width') / 2, y: -sw / 2, w: n('width'), h: sw };
    }
    case 'path': {
      const b = pathBounds(parsePathCached(String(v.path)));
      return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
    }
    case 'text': {
      const t = layoutText(layer, n('fontSize'), n('letterSpacing'));
      return { x: -t.width / 2, y: -t.height / 2, w: t.width, h: t.height };
    }
    case 'precomp': {
      const c = project.compositions.find((x) => x.id === layer.compId);
      if (!c) return null;
      return { x: -c.width / 2, y: -c.height / 2, w: c.width, h: c.height };
    }
    default:
      return null;
  }
}

const path2DCache = new Map<string, Path2D>();
function getPath2D(d: string): Path2D {
  let p = path2DCache.get(d);
  if (!p) {
    p = new Path2D(d);
    if (path2DCache.size > 400) path2DCache.clear();
    path2DCache.set(d, p);
  }
  return p;
}

const lengthCache = new Map<string, number>();
function cachedLength(d: string): number {
  let l = lengthCache.get(d);
  if (l === undefined) {
    l = pathLength(parsePathCached(d));
    if (lengthCache.size > 400) lengthCache.clear();
    lengthCache.set(d, l);
  }
  return l;
}

// --- Dessin -------------------------------------------------------------------

function ctxMatrix(ctx: Ctx): Mat {
  const m = ctx.getTransform();
  return [m.a, m.b, m.c, m.d, m.e, m.f];
}

function setMatrix(ctx: Ctx, m: Mat) {
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
}

function paintShape(ctx: Ctx, layer: Layer, v: EvaluatedProps, d: string) {
  const path = getPath2D(d);
  const fill = String(v.fill);
  const stroke = String(v.stroke);
  const sw = Number(v.strokeWidth) || 0;
  const trim = layer.type === 'line' || layer.type === 'path' ? Math.min(1, Math.max(0, Number(v.trim))) : 1;
  if (layer.type !== 'line' && isVisibleColor(fill) && trim >= 0.999) {
    ctx.fillStyle = fill;
    ctx.fill(path);
  }
  if (sw > 0 && isVisibleColor(stroke)) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = sw;
    ctx.lineJoin = 'round';
    ctx.lineCap = layer.type === 'line' ? 'round' : 'butt';
    if (trim < 0.999) {
      if (trim <= 0.0005) return;
      const len = cachedLength(d);
      ctx.setLineDash([len * trim, len + 1]);
    }
    ctx.stroke(path);
    ctx.setLineDash([]);
  }
  // Tracé rempli progressivement : le remplissage apparaît en fondu en fin de tracé.
  if (layer.type === 'path' && trim < 0.999 && isVisibleColor(fill) && trim > 0.85) {
    ctx.save();
    ctx.globalAlpha *= (trim - 0.85) / 0.15;
    ctx.fillStyle = fill;
    ctx.fill(path);
    ctx.restore();
  }
}

function paintText(ctx: Ctx, layer: Layer, v: EvaluatedProps, time: number) {
  const size = Number(v.fontSize) || 1;
  const layout = layoutText(layer, size, Number(v.letterSpacing) || 0);
  const states = letterStates(layer.text ?? '', layer.textMode ?? 'none', Number(v.reveal), size, Number(v.waveAmp), time);
  const fill = String(v.fill);
  const stroke = String(v.stroke);
  const sw = Number(v.strokeWidth) || 0;
  const doFill = isVisibleColor(fill);
  const doStroke = sw > 0 && isVisibleColor(stroke);
  ctx.font = fontString(layer, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = sw;
  ctx.lineJoin = 'round';
  const baseAlpha = ctx.globalAlpha;
  for (const g of layout.glyphs) {
    const s = states[g.index];
    if (!s || s.opacity <= 0.001 || g.char === ' ') continue;
    ctx.globalAlpha = baseAlpha * s.opacity;
    if (s.scale !== 1 || s.dy !== 0) {
      ctx.save();
      ctx.translate(g.x, g.y + s.dy);
      ctx.scale(s.scale, s.scale);
      if (doStroke) ctx.strokeText(g.char, 0, 0);
      if (doFill) ctx.fillText(g.char, 0, 0);
      ctx.restore();
    } else {
      if (doStroke) ctx.strokeText(g.char, g.x, g.y);
      if (doFill) ctx.fillText(g.char, g.x, g.y);
    }
  }
  ctx.globalAlpha = baseAlpha;
}

function paintImage(ctx: Ctx, layer: Layer, v: EvaluatedProps, project: Project) {
  const asset = project.assets.find((a) => a.id === layer.assetId);
  const w = Number(v.width) || 0;
  const h = Number(v.height) || 0;
  const r = Number(v.radius) || 0;
  const img = getImage(asset);
  ctx.save();
  if (r > 0) ctx.clip(getPath2D(roundedRectPathD(w, h, r)));
  if (img) ctx.drawImage(img, -w / 2, -h / 2, w, h);
  else {
    ctx.fillStyle = '#DBEAFE';
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

function paintPrecomp(ctx: Ctx, layer: Layer, rc: RenderContext) {
  const comp = rc.project.compositions.find((c) => c.id === layer.compId);
  if (!comp || (rc.depth ?? 0) >= MAX_DEPTH) return;
  const local = rc.time - layer.inPoint;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-comp.width / 2, -comp.height / 2, comp.width, comp.height);
  ctx.clip();
  ctx.translate(-comp.width / 2, -comp.height / 2);
  renderComposition(ctx, comp, { ...rc, time: local, depth: (rc.depth ?? 0) + 1 });
  ctx.restore();
}

/** Dessine le contenu d'un calque dans son repère local (transformation déjà appliquée). */
function paintLayerContent(ctx: Ctx, layer: Layer, v: EvaluatedProps, rc: RenderContext) {
  switch (layer.type) {
    case 'text':
      paintText(ctx, layer, v, rc.time);
      break;
    case 'image':
      paintImage(ctx, layer, v, rc.project);
      break;
    case 'precomp':
      paintPrecomp(ctx, layer, rc);
      break;
    case 'group':
      break;
    default: {
      const d = shapePathD(layer, v);
      if (d) paintShape(ctx, layer, v, d);
    }
  }
}

function drawLayer(
  ctx: Ctx,
  base: Mat,
  layer: Layer,
  map: Map<string, Layer>,
  rc: RenderContext,
  opacityOverride?: number,
) {
  const v = evaluateLayer(layer, rc.time);
  const opacity = opacityOverride ?? inheritedOpacity(layer, map, rc.time);
  if (opacity <= 0.001) return;
  const m = multiply(base, worldMatrix(layer, map, rc.time));
  ctx.save();
  setMatrix(ctx, m);
  ctx.globalAlpha = Math.min(1, opacity);
  const blur = Number(v.blur) || 0;
  if (blur > 0.01) ctx.filter = `blur(${blur * rc.scale}px)`;
  paintLayerContent(ctx, layer, v, rc);
  ctx.restore();
}

/**
 * Dessine une composition. Le contexte doit déjà être placé dans le repère
 * de la composition (0,0 en haut à gauche, unité = pixel de composition).
 */
export function renderComposition(ctx: Ctx, comp: Composition, rc: RenderContext, drawBackground = true): void {
  const base = ctxMatrix(ctx);
  const map = layerMap(comp);
  const masks = maskLayerIds(comp);

  if (drawBackground && isVisibleColor(comp.background)) {
    ctx.save();
    ctx.fillStyle = comp.background;
    ctx.fillRect(0, 0, comp.width, comp.height);
    ctx.restore();
  }

  for (const layer of comp.layers) {
    if (layer.type === 'group' || masks.has(layer.id)) continue;
    if (!isEffectivelyVisible(layer, map) || !isActiveAt(layer, rc.time)) continue;

    const mask = layer.maskId ? map.get(layer.maskId) : undefined;
    if (!mask) {
      drawLayer(ctx, base, layer, map, rc);
      continue;
    }
    // Masque : le calque est rendu à part puis découpé par l'alpha du calque masque.
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const off = scratchCanvas(`mask-${rc.depth ?? 0}`, W, H);
    const octx = off.getContext('2d')!;
    drawLayer(octx, base, layer, map, rc);
    octx.globalCompositeOperation = layer.maskInvert ? 'destination-out' : 'destination-in';
    if (isActiveAt(mask, rc.time)) {
      drawLayer(octx, base, mask, map, rc, 1);
    } else if (!layer.maskInvert) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, W, H);
    }
    octx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }
}

/** Rendu complet d'une composition dans un canvas, mise à l'échelle comprise. */
export function renderToCanvas(canvas: HTMLCanvasElement, project: Project, comp: Composition, time: number): void {
  const ctx = canvas.getContext('2d')!;
  const scale = canvas.width / comp.width;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderComposition(ctx, comp, { project, time, scale });
}
