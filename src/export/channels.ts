import { parseColor } from '../engine/color';
import { normalizeMany, parsePath, serializePath } from '../engine/path';
import { pointsToPathD, polygonPoints, starPoints } from '../engine/shapes';
import type { Easing, Layer, PropKey } from '../engine/types';
import { buildTrack, num, type ExportContext, type TrackData, type Values } from './model';

/**
 * Canaux d'animation : regroupement des propriétés du moteur en propriétés CSS / GSAP.
 * Un même canal sert aux deux exports pour garantir le même rendu.
 */

export type ChannelTarget = 'node' | 'visual' | 'shape';

export interface Channel {
  name: string;
  target: ChannelTarget;
  keys: PropKey[];
  css: (v: Values) => Record<string, string>;
  gsap: (v: Values) => Record<string, string | number>;
  /** Forcer l'échantillonnage (valeurs non interpolables directement). */
  bake?: boolean;
}

/** Couleur au format CSS rgba() (interpolable partout, GSAP compris). */
export function cssColor(v: unknown): string {
  const c = parseColor(String(v));
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${num(c.a, 3)})`;
}

const px = (v: unknown) => `${num(v as number, 2)}px`;

export function shapeD(layer: Layer, v: Values): string {
  // Un tracé déjà calculé (normalisé pour l'export) est prioritaire.
  if (typeof v.path === 'string' && v.path) return v.path;
  if (layer.type === 'star') return pointsToPathD(starPoints(Number(v.points), Number(v.radius), Number(v.innerRadius)));
  if (layer.type === 'polygon') return pointsToPathD(polygonPoints(Number(v.points), Number(v.radius)));
  return String(v.path ?? '');
}

/** Propriétés qui déterminent le tracé d'un calque vectoriel. */
export function shapeKeys(layer: Layer): PropKey[] {
  return layer.type === 'star' ? ['radius', 'innerRadius', 'points'] : layer.type === 'polygon' ? ['radius', 'points'] : ['path'];
}

export function isSvgLayer(layer: Layer): boolean {
  return layer.type === 'star' || layer.type === 'polygon' || layer.type === 'path';
}

/** Canaux du nœud de transformation (également utilisés pour les ancêtres). */
export function nodeChannels(layer: Layer): Channel[] {
  const out: Channel[] = [
    {
      name: 'pos',
      target: 'node',
      keys: ['x', 'y'],
      css: (v) => ({ translate: `${px(v.x)} ${px(v.y)}` }),
      gsap: (v) => ({ x: num(v.x, 2), y: num(v.y, 2) }),
    },
    {
      name: 'rot',
      target: 'node',
      keys: ['rotation'],
      css: (v) => ({ rotate: `${num(v.rotation, 2)}deg` }),
      gsap: (v) => ({ rotation: num(v.rotation, 2) }),
    },
    {
      name: 'scl',
      target: 'node',
      keys: ['scaleX', 'scaleY'],
      css: (v) => ({ scale: `${num(v.scaleX, 4)} ${num(v.scaleY, 4)}` }),
      gsap: (v) => ({ scaleX: num(v.scaleX, 4), scaleY: num(v.scaleY, 4) }),
    },
  ];
  if (layer.type === 'group') {
    // L'opacité d'un groupe s'applique à tous ses membres.
    out.push({ name: 'op', target: 'node', keys: ['opacity'], css: (v) => ({ opacity: String(num(v.opacity)) }), gsap: (v) => ({ opacity: num(v.opacity) }) });
  }
  return out;
}

/** Canaux de l'élément visuel selon le type de calque. */
export function visualChannels(layer: Layer): Channel[] {
  const out: Channel[] = [
    { name: 'op', target: 'visual', keys: ['opacity'], css: (v) => ({ opacity: String(num(v.opacity)) }), gsap: (v) => ({ opacity: num(v.opacity) }) },
    {
      name: 'blur',
      target: 'visual',
      keys: ['blur'],
      css: (v) => (Number(v.blur) > 0 ? { filter: `blur(${px(v.blur)})` } : { filter: 'blur(0px)' }),
      gsap: (v) => ({ filter: `blur(${px(v.blur)})` }),
    },
  ];
  const size: Channel = {
    name: 'size',
    target: 'visual',
    keys: ['width', 'height'],
    css: (v) => ({ width: px(v.width), height: px(v.height) }),
    gsap: (v) => ({ width: num(v.width, 2), height: num(v.height, 2) }),
  };
  const outline: Channel = {
    name: 'stroke',
    target: 'visual',
    keys: ['stroke', 'strokeWidth'],
    css: (v) => ({ 'outline-color': cssColor(v.stroke), 'outline-width': px(v.strokeWidth), 'outline-offset': px(-Number(v.strokeWidth) / 2) }),
    gsap: (v) => ({ outlineColor: cssColor(v.stroke), outlineWidth: num(v.strokeWidth, 2), outlineOffset: num(-Number(v.strokeWidth) / 2, 2) }),
  };
  switch (layer.type) {
    case 'rect':
      out.push(
        size,
        { name: 'rad', target: 'visual', keys: ['radius'], css: (v) => ({ 'border-radius': px(v.radius) }), gsap: (v) => ({ borderRadius: num(v.radius, 2) }) },
        { name: 'fill', target: 'visual', keys: ['fill'], css: (v) => ({ 'background-color': cssColor(v.fill) }), gsap: (v) => ({ backgroundColor: cssColor(v.fill) }) },
        outline,
      );
      break;
    case 'ellipse':
      out.push(
        size,
        { name: 'fill', target: 'visual', keys: ['fill'], css: (v) => ({ 'background-color': cssColor(v.fill) }), gsap: (v) => ({ backgroundColor: cssColor(v.fill) }) },
        outline,
      );
      break;
    case 'image':
      out.push(size, { name: 'rad', target: 'visual', keys: ['radius'], css: (v) => ({ 'border-radius': px(v.radius) }), gsap: (v) => ({ borderRadius: num(v.radius, 2) }) });
      break;
    case 'line':
      out.push(
        { name: 'len', target: 'visual', keys: ['width'], css: (v) => ({ width: px(v.width) }), gsap: (v) => ({ width: num(v.width, 2) }) },
        {
          name: 'thick',
          target: 'visual',
          keys: ['strokeWidth'],
          css: (v) => ({ height: px(v.strokeWidth), 'border-radius': px(Number(v.strokeWidth) / 2) }),
          gsap: (v) => ({ height: num(v.strokeWidth, 2), borderRadius: num(Number(v.strokeWidth) / 2, 2) }),
        },
        { name: 'col', target: 'visual', keys: ['stroke'], css: (v) => ({ 'background-color': cssColor(v.stroke) }), gsap: (v) => ({ backgroundColor: cssColor(v.stroke) }) },
        {
          name: 'trim',
          target: 'visual',
          keys: ['trim'],
          css: (v) => ({ 'clip-path': `inset(0% ${num((1 - Number(v.trim)) * 100, 2)}% 0% 0%)` }),
          gsap: (v) => ({ clipPath: `inset(0% ${num((1 - Number(v.trim)) * 100, 2)}% 0% 0%)` }),
        },
      );
      break;
    case 'text':
      out.push(
        { name: 'fs', target: 'visual', keys: ['fontSize'], css: (v) => ({ 'font-size': px(v.fontSize) }), gsap: (v) => ({ fontSize: num(v.fontSize, 2) }) },
        { name: 'ls', target: 'visual', keys: ['letterSpacing'], css: (v) => ({ 'letter-spacing': px(v.letterSpacing) }), gsap: (v) => ({ letterSpacing: num(v.letterSpacing, 2) }) },
        { name: 'col', target: 'visual', keys: ['fill'], css: (v) => ({ color: cssColor(v.fill) }), gsap: (v) => ({ color: cssColor(v.fill) }) },
        {
          name: 'tstroke',
          target: 'visual',
          keys: ['stroke', 'strokeWidth'],
          css: (v) => ({ '-webkit-text-stroke': `${px(v.strokeWidth)} ${cssColor(v.stroke)}` }),
          gsap: (v) => ({ webkitTextStrokeWidth: num(v.strokeWidth, 2), webkitTextStrokeColor: cssColor(v.stroke) }),
        },
      );
      break;
    case 'star':
    case 'polygon':
    case 'path': {
      out.push(
        {
          name: 'd',
          target: 'shape',
          keys: shapeKeys(layer),
          css: (v) => ({ d: `path("${shapeD(layer, v)}")` }),
          gsap: (v) => ({ d: shapeD(layer, v) }),
          bake: layer.type !== 'path',
        },
        { name: 'fill', target: 'shape', keys: ['fill'], css: (v) => ({ fill: cssColor(v.fill) }), gsap: (v) => ({ fill: cssColor(v.fill) }) },
        { name: 'stroke', target: 'shape', keys: ['stroke'], css: (v) => ({ stroke: cssColor(v.stroke) }), gsap: (v) => ({ stroke: cssColor(v.stroke) }) },
        { name: 'sw', target: 'shape', keys: ['strokeWidth'], css: (v) => ({ 'stroke-width': px(v.strokeWidth) }), gsap: (v) => ({ strokeWidth: num(v.strokeWidth, 2) }) },
      );
      if (layer.type === 'path') {
        out.push({
          name: 'trim',
          target: 'shape',
          keys: ['trim'],
          css: (v) => ({ 'stroke-dashoffset': String(num(1 - Number(v.trim), 4)) }),
          gsap: (v) => ({ strokeDashoffset: num(1 - Number(v.trim), 4) }),
        });
      }
      break;
    }
  }
  return out;
}

/**
 * Piste d'un canal. Pour les tracés, toutes les valeurs reçoivent une structure
 * commune afin que CSS et GSAP puissent interpoler les chaînes directement.
 */
export function channelTrack(ctx: ExportContext, layer: Layer, ch: Channel, offset: number, native?: (e: Easing) => boolean): TrackData | null {
  const track = buildTrack(ctx, layer, ch.keys, offset, ch.bake, native);
  if (!track || ch.name !== 'd') return track;
  const all: Values[] = [track.initial, ...track.segments.flatMap((s) => [s.from, s.to])];
  const ds = all.map((v) => shapeD(layer, v));
  const unique = [...new Set(ds)];
  const normalized = normalizeMany(unique.map((d) => parsePath(d))).map(serializePath);
  const map = new Map(unique.map((d, i) => [d, normalized[i]]));
  const withPath = (v: Values): Values => ({ ...v, path: map.get(shapeD(layer, v)) });
  return {
    initial: withPath(track.initial),
    segments: track.segments.map((s) => ({ ...s, from: withPath(s.from), to: withPath(s.to) })),
  };
}
