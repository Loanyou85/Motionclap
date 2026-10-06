import { parseColor, toHex } from '../engine/color';
import { createLayer } from '../engine/defaults';
import { parsePath, pathBounds, serializePath, transformPath } from '../engine/path';
import { normalizeOrder } from '../engine/structure';
import type { Composition, Layer } from '../engine/types';
import { loadAudioBuffer } from '../render/assets';
import { activeComp, useStore } from '../store/store';

export function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 400, height: 300 });
    img.src = src;
  });
}

/** Taille ajustée pour tenir dans 60 % de la composition. */
function fitSize(w: number, h: number, comp: Composition, ratio = 0.6) {
  const s = Math.min(1, (comp.width * ratio) / w, (comp.height * ratio) / h);
  return { width: Math.round(w * s), height: Math.round(h * s), scale: s };
}

export async function importImage(file: File): Promise<void> {
  const src = await readAsDataURL(file);
  const { width, height } = await loadImageSize(src);
  const st = useStore.getState();
  const comp = activeComp(st);
  const assetId = st.addAsset({ name: file.name, kind: 'image', src, width, height });
  const fit = fitSize(width, height, comp);
  st.addLayer('image', { name: file.name.replace(/\.[^.]+$/, ''), assetId }, { width: fit.width, height: fit.height });
}

export async function importAudio(file: File): Promise<void> {
  const src = await readAsDataURL(file);
  const st = useStore.getState();
  const assetId = st.addAsset({ name: file.name, kind: 'audio', src });
  const asset = useStore.getState().project.assets.find((a) => a.id === assetId)!;
  const buffer = await loadAudioBuffer(asset);
  if (buffer) {
    useStore.getState().update((d) => {
      const a = d.assets.find((x) => x.id === assetId);
      if (a) a.duration = buffer.duration;
    });
  }
  useStore.getState().updateComp((c) => {
    c.audio = { assetId, offset: 0, volume: 1, muted: false };
  });
  useStore.getState().notify(`Piste audio « ${file.name} » ajoutée.`);
}

const SHAPE_SELECTOR = 'path, rect, circle, ellipse, line, polyline, polygon';

/** Convertit un élément de forme SVG en attribut d. */
function elementToD(el: Element): string | null {
  const n = (a: string) => parseFloat(el.getAttribute(a) ?? '0') || 0;
  switch (el.tagName.toLowerCase()) {
    case 'path':
      return el.getAttribute('d');
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height');
      let rx = n('rx') || n('ry');
      rx = Math.min(rx, w / 2, h / 2);
      if (!rx) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
      return `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${rx} 0 0 1 ${x + w} ${y + rx} V ${y + h - rx} A ${rx} ${rx} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${rx} 0 0 1 ${x} ${y + h - rx} V ${y + rx} A ${rx} ${rx} 0 0 1 ${x + rx} ${y} Z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = n('cx'), cy = n('cy');
      const rx = el.tagName.toLowerCase() === 'circle' ? n('r') : n('rx');
      const ry = el.tagName.toLowerCase() === 'circle' ? n('r') : n('ry');
      return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy} Z`;
    }
    case 'line':
      return `M ${n('x1')} ${n('y1')} L ${n('x2')} ${n('y2')}`;
    case 'polyline':
    case 'polygon': {
      const pts = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return null;
      let d = `M ${pts[0]} ${pts[1]}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`;
      return el.tagName.toLowerCase() === 'polygon' ? `${d} Z` : d;
    }
  }
  return null;
}

function cssColor(value: string, opacity: number): string {
  if (!value || value === 'none') return '#00000000';
  if (value.startsWith('url(')) return '#1E5EFF';
  const c = parseColor(value);
  return toHex({ ...c, a: c.a * opacity });
}

export interface ImportedShape {
  name: string;
  d: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

/**
 * Analyse un fichier SVG : chaque forme devient un tracé en coordonnées absolues.
 * Le SVG est inséré hors écran pour profiter du calcul des styles et matrices du navigateur.
 */
export function parseSvgShapes(svgText: string): ImportedShape[] {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.querySelector('svg');
  if (!root) throw new Error('Fichier SVG invalide');
  const svg = document.importNode(root, true) as SVGSVGElement;
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width && vb.height) {
    svg.setAttribute('width', String(vb.width));
    svg.setAttribute('height', String(vb.height));
  }
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none';
  host.appendChild(svg);
  document.body.appendChild(host);
  try {
    const shapes: ImportedShape[] = [];
    const rootCTM = svg.getScreenCTM();
    const rootInv = rootCTM ? rootCTM.inverse() : null;
    svg.querySelectorAll(SHAPE_SELECTOR).forEach((node, i) => {
      if (node.closest('defs, clipPath, mask, symbol')) return;
      const d = elementToD(node);
      if (!d) return;
      const g = node as SVGGraphicsElement;
      const style = getComputedStyle(g);
      if (style.display === 'none') return;
      let m: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
      const ctm = g.getScreenCTM();
      if (ctm && rootInv) {
        const rel = rootInv.multiply(ctm);
        m = [rel.a, rel.b, rel.c, rel.d, rel.e, rel.f];
      }
      const opacity = parseFloat(style.opacity || '1');
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      shapes.push({
        name: node.getAttribute('id') || `${node.tagName.toLowerCase()} ${i + 1}`,
        d: serializePath(transformPath(parsePath(d), m)),
        fill: cssColor(style.fill, opacity * parseFloat(style.fillOpacity || '1')),
        stroke: cssColor(style.stroke, opacity * parseFloat(style.strokeOpacity || '1')),
        strokeWidth: style.stroke && style.stroke !== 'none' ? (parseFloat(style.strokeWidth) || 1) * scale : 0,
      });
    });
    return shapes;
  } finally {
    host.remove();
  }
}

/** Importe un SVG : un calque « tracé » par forme, réunis dans un groupe ajusté à la scène. */
export async function importSvg(file: File): Promise<void> {
  const text = await file.text();
  const shapes = parseSvgShapes(text);
  const st = useStore.getState();
  if (shapes.length === 0) {
    st.notify('Aucune forme exploitable dans ce SVG.', 'error');
    return;
  }
  const comp = activeComp(st);
  // Boîte englobante globale pour centrer et ajuster.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    const b = pathBounds(parsePath(s.d));
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  // Ajuste à 60 % de la scène ; les petites icônes sont agrandies (jusqu'à ×4).
  const s = Math.min((comp.width * 0.6) / w, (comp.height * 0.6) / h, Math.max(1, Math.min(4, (comp.width * 0.3) / w)));
  const baseName = file.name.replace(/\.[^.]+$/, '');

  const layers: Layer[] = shapes.map((sh) =>
    createLayer(
      'path',
      comp,
      { name: sh.name },
      {
        x: 0,
        y: 0,
        path: serializePath(transformPath(parsePath(sh.d), [s, 0, 0, s, -cx * s, -cy * s])),
        fill: sh.fill,
        stroke: sh.stroke,
        strokeWidth: sh.strokeWidth * s,
      },
    ),
  );

  if (layers.length === 1) {
    layers[0].name = baseName;
    layers[0].props.x!.value = comp.width / 2;
    layers[0].props.y!.value = comp.height / 2;
  }
  const group = layers.length > 1 ? createLayer('group', comp, { name: baseName }) : null;
  if (group) for (const l of layers) l.parentId = group.id;
  st.updateComp((c) => {
    c.layers.push(...(layers as Layer[]));
    if (group) c.layers.push(group);
    normalizeOrder(c as Composition);
  });
  st.setSelectedLayers([group?.id ?? layers[0].id]);
  st.notify(`SVG importé : ${layers.length} forme${layers.length > 1 ? 's' : ''}.`);
}

/** Aiguille un fichier selon son type. */
export async function importFile(file: File): Promise<void> {
  try {
    if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) await importSvg(file);
    else if (file.type.startsWith('image/')) await importImage(file);
    else if (file.type.startsWith('audio/')) await importAudio(file);
    else useStore.getState().notify(`Format non pris en charge : ${file.name}`, 'error');
  } catch (e) {
    useStore.getState().notify(`Import impossible : ${(e as Error).message}`, 'error');
  }
}
