import { parseColor } from '../engine/color';
import { easingToBezier } from '../engine/easing';
import { getNum, layerMap, maskLayerIds } from '../engine/evaluate';
import { normalizeMany, parsePath, type Subpath } from '../engine/path';
import type { Composition, Layer, Project, PropKey } from '../engine/types';
import { shapeD, shapeKeys } from './channels';
import { buildTrack, createContext, evalValues, num, type ExportContext, type Values } from './model';

/* Types minimaux du format Lottie (Bodymovin 5.x) */
type LottieValue = { a: 0; k: number | number[] | LottieShape } | { a: 1; k: LottieKeyframe[] };
interface LottieKeyframe {
  t: number;
  s: number[] | LottieShape[];
  i?: { x: number[]; y: number[] };
  o?: { x: number[]; y: number[] };
  h?: 1;
}
interface LottieShape {
  i: number[][];
  o: number[][];
  v: number[][];
  c: boolean;
}
type Json = Record<string, unknown>;

export interface LottieResult {
  json: Json;
  code: string;
  warnings: string[];
}

interface LottieCtx extends ExportContext {
  fpsRoot: number;
}

const frame = (ctx: LottieCtx, t: number) => num(t * ctx.fpsRoot, 3);

/**
 * Propriété Lottie à partir d'un groupe de propriétés du moteur.
 * `map` convertit les valeurs évaluées en tableau de nombres.
 */
function animatedValue(ctx: LottieCtx, layer: Layer, keys: PropKey[], map: (v: Values) => number[], scalar = false): LottieValue {
  const track = buildTrack(ctx, layer, keys, 0);
  const wrap = (arr: number[]) => (scalar ? arr[0] : arr);
  if (!track) return { a: 0, k: wrap(map(evalValues(layer, keys, 0))) };
  const kfs: LottieKeyframe[] = [];
  for (const s of track.segments) {
    const value = map(s.from);
    const kf: LottieKeyframe = { t: frame(ctx, s.t0), s: value };
    if (s.easing?.type === 'hold') kf.h = 1;
    else {
      const b = (s.easing && easingToBezier(s.easing)) || [0, 0, 1, 1];
      const d = value.length;
      kf.o = { x: Array(d).fill(num(b[0], 4)), y: Array(d).fill(num(b[1], 4)) };
      kf.i = { x: Array(d).fill(num(b[2], 4)), y: Array(d).fill(num(b[3], 4)) };
    }
    kfs.push(kf);
  }
  const last = track.segments[track.segments.length - 1];
  kfs.push({ t: frame(ctx, last.t1), s: map(last.to) });
  return { a: 1, k: kfs };
}

const rgb = (c: string) => {
  const p = parseColor(c);
  return [num(p.r / 255, 4), num(p.g / 255, 4), num(p.b / 255, 4), 1];
};
const alpha = (c: string) => [num(parseColor(c).a * 100, 2)];

/** Convertit un sous-tracé cubique en forme Lottie (tangentes relatives aux sommets). */
export function subpathToLottie(sp: Subpath): LottieShape {
  const n = sp.segs.length;
  const pts: number[][] = [sp.start, ...sp.segs.map((s) => [s[4], s[5]])];
  // Fermé : le dernier point rejoint le départ et n'est pas répété.
  const dup = sp.closed && n > 0 && Math.hypot(pts[n][0] - pts[0][0], pts[n][1] - pts[0][1]) < 1e-6;
  const count = dup ? n : n + 1;
  const v = pts.slice(0, count).map((p) => [num(p[0], 3), num(p[1], 3)]);
  const i = v.map(() => [0, 0]);
  const o = v.map(() => [0, 0]);
  sp.segs.forEach((s, a) => {
    const b = a + 1 === count ? 0 : a + 1;
    o[a] = [num(s[0] - v[a][0], 3), num(s[1] - v[a][1], 3)];
    i[b] = [num(s[2] - v[b][0], 3), num(s[3] - v[b][1], 3)];
  });
  return { i, o, v, c: sp.closed };
}

/** Tracés animés : une forme « sh » par sous-tracé, structure commune à toutes les images clés. */
function pathShapes(ctx: LottieCtx, layer: Layer, keys: PropKey[], toD: (v: Values) => string): Json[] {
  const track = buildTrack(ctx, layer, keys, 0, layer.type !== 'path');
  if (!track) {
    const p = parsePath(toD(evalValues(layer, keys, 0)));
    return p.map((sp, idx) => ({ ty: 'sh', nm: `Tracé ${idx + 1}`, ks: { a: 0, k: subpathToLottie(sp) } }));
  }
  const values = [...track.segments.map((s) => s.from), track.segments[track.segments.length - 1].to];
  const norm = normalizeMany(values.map((v) => parsePath(toD(v))));
  const nSub = norm[0]?.length ?? 0;
  const out: Json[] = [];
  for (let sIdx = 0; sIdx < nSub; sIdx++) {
    const kfs: LottieKeyframe[] = track.segments.map((s, k) => {
      const kf: LottieKeyframe = { t: frame(ctx, s.t0), s: [subpathToLottie(norm[k][sIdx])] };
      if (s.easing?.type === 'hold') kf.h = 1;
      else {
        const b = (s.easing && easingToBezier(s.easing)) || [0, 0, 1, 1];
        kf.o = { x: [num(b[0], 4)], y: [num(b[1], 4)] };
        kf.i = { x: [num(b[2], 4)], y: [num(b[3], 4)] };
      }
      return kf;
    });
    kfs.push({ t: frame(ctx, track.segments[track.segments.length - 1].t1), s: [subpathToLottie(norm[norm.length - 1][sIdx])] });
    out.push({ ty: 'sh', nm: `Tracé ${sIdx + 1}`, ks: { a: 1, k: kfs } });
  }
  return out;
}

function fillShape(ctx: LottieCtx, layer: Layer): Json {
  return {
    ty: 'fl',
    nm: 'Remplissage',
    c: animatedValue(ctx, layer, ['fill'], (v) => rgb(String(v.fill))),
    o: animatedValue(ctx, layer, ['fill'], (v) => alpha(String(v.fill)), true),
    r: 1,
  };
}

function strokeShape(ctx: LottieCtx, layer: Layer, cap: 1 | 2 = 2): Json {
  return {
    ty: 'st',
    nm: 'Contour',
    c: animatedValue(ctx, layer, ['stroke'], (v) => rgb(String(v.stroke))),
    o: animatedValue(ctx, layer, ['stroke'], (v) => alpha(String(v.stroke)), true),
    w: animatedValue(ctx, layer, ['strokeWidth'], (v) => [num(v.strokeWidth, 2)], true),
    lc: cap,
    lj: 2,
    ml: 4,
  };
}

const groupTransform = (): Json => ({
  ty: 'tr',
  p: { a: 0, k: [0, 0] },
  a: { a: 0, k: [0, 0] },
  s: { a: 0, k: [100, 100] },
  r: { a: 0, k: 0 },
  o: { a: 0, k: 100 },
  sk: { a: 0, k: 0 },
  sa: { a: 0, k: 0 },
});

function shapeContents(ctx: LottieCtx, layer: Layer): Json[] {
  const items: Json[] = [];
  const hasStroke = () => getNum(layer, 'strokeWidth', 0) > 0 || (layer.props.strokeWidth?.keyframes.length ?? 0) > 1;
  switch (layer.type) {
    case 'rect':
      items.push({
        ty: 'rc',
        nm: 'Rectangle',
        p: { a: 0, k: [0, 0] },
        s: animatedValue(ctx, layer, ['width', 'height'], (v) => [num(v.width, 2), num(v.height, 2)]),
        r: animatedValue(ctx, layer, ['radius'], (v) => [num(v.radius, 2)], true),
      });
      break;
    case 'ellipse':
      items.push({ ty: 'el', nm: 'Ellipse', p: { a: 0, k: [0, 0] }, s: animatedValue(ctx, layer, ['width', 'height'], (v) => [num(v.width, 2), num(v.height, 2)]) });
      break;
    case 'star':
    case 'polygon':
    case 'path':
      items.push(...pathShapes(ctx, layer, shapeKeys(layer), (v) => shapeD(layer, v)));
      break;
    case 'line':
      items.push(...pathShapes(ctx, layer, ['width'], (v) => `M ${-Number(v.width) / 2} 0 L ${Number(v.width) / 2} 0`));
      break;
  }
  if (layer.type === 'line' || layer.type === 'path') {
    items.push({
      ty: 'tm',
      nm: 'Tracé dessiné',
      s: { a: 0, k: 0 },
      e: animatedValue(ctx, layer, ['trim'], (v) => [num(Number(v.trim) * 100, 2)], true),
      o: { a: 0, k: 0 },
      m: 1,
    });
  }
  if (layer.type !== 'line') items.push(fillShape(ctx, layer));
  if (layer.type === 'line' || hasStroke()) items.push(strokeShape(ctx, layer, layer.type === 'line' ? 2 : 1));
  items.push(groupTransform());
  return [{ ty: 'gr', nm: layer.name, it: items }];
}

function transform(ctx: LottieCtx, layer: Layer, anchor: [number, number] = [0, 0], sizeScale?: { w: number; h: number }): Json {
  const scaleKeys: PropKey[] = sizeScale ? ['scaleX', 'scaleY', 'width', 'height'] : ['scaleX', 'scaleY'];
  return {
    o: animatedValue(ctx, layer, ['opacity'], (v) => [num(Number(v.opacity) * 100, 2)], true),
    r: animatedValue(ctx, layer, ['rotation'], (v) => [num(v.rotation, 3)], true),
    p: {
      s: true,
      x: animatedValue(ctx, layer, ['x'], (v) => [num(v.x, 3)], true),
      y: animatedValue(ctx, layer, ['y'], (v) => [num(v.y, 3)], true),
    },
    a: { a: 0, k: [anchor[0], anchor[1], 0] },
    s: animatedValue(ctx, layer, scaleKeys, (v) => {
      const fx = sizeScale ? Number(v.width) / sizeScale.w : 1;
      const fy = sizeScale ? Number(v.height) / sizeScale.h : 1;
      return [num(Number(v.scaleX) * fx * 100, 3), num(Number(v.scaleY) * fy * 100, 3), 100];
    }),
  };
}

interface BuildState {
  project: Project;
  assets: Json[];
  warnings: Set<string>;
  compsDone: Set<string>;
  fonts: Map<string, Json>;
}

function textLayerData(ctx: LottieCtx, layer: Layer, st: BuildState): { t: Json; anchor: [number, number] } {
  const fs = getNum(layer, 'fontSize', 0);
  const family = layer.fontFamily ?? 'Inter';
  const weight = layer.fontWeight ?? 700;
  const fName = `${family.replace(/\s+/g, '')}-${weight}`;
  if (st.project.assets.some((a) => a.kind === 'font' && a.family === family))
    st.warnings.add(`Lottie : la police personnalisée « ${family} » doit être installée sur l’appareil de lecture.`);
  st.fonts.set(fName, { fName, fFamily: family, fStyle: weight >= 600 ? 'Bold' : 'Regular', ascent: 72, fWeight: String(weight), origin: 0 });
  if ((layer.props.fontSize?.keyframes.length ?? 0) > 1) st.warnings.add('Lottie : la taille de texte animée est exportée à sa valeur initiale.');
  const lines = (layer.text ?? '').split('\n');
  const fill = parseColor(String(evalValues(layer, ['fill'], 0).fill));
  const justify = layer.textAlign === 'left' ? 0 : layer.textAlign === 'right' ? 1 : 2;
  const animators: Json[] = [];
  if ((layer.textMode ?? 'none') !== 'none') {
    if (layer.textMode !== 'typewriter') st.warnings.add('Lottie : fondu et vague de texte sont exportés comme une révélation lettre par lettre.');
    // Sélecteur de plage : les lettres au-delà de « révélation » restent transparentes.
    animators.push({
      nm: 'Révélation',
      s: {
        t: 0,
        xe: { a: 0, k: 0 },
        ne: { a: 0, k: 0 },
        a: { a: 0, k: 100 },
        b: 1,
        rn: 0,
        sh: 1,
        r: 1,
        s: animatedValue(ctx, layer, ['reveal'], (v) => [num(Number(v.reveal) * 100, 2)], true),
        e: { a: 0, k: 100 },
        o: { a: 0, k: 0 },
      },
      a: { o: { a: 0, k: 0 } },
    });
  }
  return {
    t: {
      d: {
        k: [
          {
            s: {
              s: num(fs, 2),
              f: fName,
              t: lines.join('\r'),
              j: justify,
              tr: num((getNum(layer, 'letterSpacing', 0) / fs) * 1000, 1),
              lh: num(fs * 1.2, 2),
              ls: 0,
              fc: [num(fill.r / 255, 4), num(fill.g / 255, 4), num(fill.b / 255, 4)],
            },
            t: 0,
          },
        ],
      },
      p: {},
      m: { g: 1, a: { a: 0, k: [0, 0] } },
      a: animators,
    },
    // Ancre : centre vertical du bloc de texte par rapport à la première ligne de base.
    anchor: [0, num(-0.35 * fs + (lines.length - 1) * 0.6 * fs, 2)],
  };
}

/** Couches Lottie d'une composition (la première est au premier plan). */
function compLayers(st: BuildState, comp: Composition, depth = 0): Json[] {
  const ctx: LottieCtx = { ...createContext(st.project, comp), fpsRoot: comp.fps };
  const map = layerMap(comp);
  const masks = maskLayerIds(comp);
  const ind = new Map<string, number>();
  comp.layers.forEach((l, i) => ind.set(l.id, i + 1));
  let extraInd = comp.layers.length + 1;
  const out: Json[] = [];

  const build = (layer: Layer, overrideInd?: number): Json | null => {
    const base: Json = {
      ddd: 0,
      ind: overrideInd ?? ind.get(layer.id),
      nm: layer.name,
      sr: 1,
      ao: 0,
      ip: frame(ctx, layer.inPoint),
      op: frame(ctx, Math.max(layer.outPoint, layer.inPoint + 1 / comp.fps)),
      st: 0,
      bm: 0,
    };
    if (layer.parentId && map.has(layer.parentId)) base.parent = ind.get(layer.parentId);
    if (!layer.visible) base.hd = true;
    if (getNum(layer, 'blur', 0) > 0 || (layer.props.blur?.keyframes.length ?? 0) > 1) st.warnings.add('Lottie : le flou n’est pas exporté.');
    switch (layer.type) {
      case 'group':
        if ((layer.props.opacity?.keyframes.length ?? 0) > 1 || getNum(layer, 'opacity', 0) < 1)
          st.warnings.add('Lottie : l’opacité des groupes n’est pas transmise aux calques enfants.');
        return { ...base, ty: 3, ks: transform(ctx, layer) };
      case 'image': {
        const asset = st.project.assets.find((a) => a.id === layer.assetId);
        if (!asset) return null;
        const w = asset.width ?? getNum(layer, 'width', 0);
        const h = asset.height ?? getNum(layer, 'height', 0);
        if (!st.assets.some((a) => a.id === asset.id)) st.assets.push({ id: asset.id, w, h, u: '', p: asset.src, e: 1 });
        return { ...base, ty: 2, refId: asset.id, ks: transform(ctx, layer, [w / 2, h / 2], { w, h }) };
      }
      case 'precomp': {
        const sub = st.project.compositions.find((c) => c.id === layer.compId);
        if (!sub || depth > 5) return null;
        if (!st.compsDone.has(sub.id)) {
          st.compsDone.add(sub.id);
          st.assets.push({ id: sub.id, nm: sub.name, layers: compLayers(st, sub, depth + 1) });
        }
        return {
          ...base,
          ty: 0,
          refId: sub.id,
          w: sub.width,
          h: sub.height,
          st: frame(ctx, layer.inPoint),
          ks: transform(ctx, layer, [sub.width / 2, sub.height / 2]),
        };
      }
      case 'text': {
        const td = textLayerData(ctx, layer, st);
        return { ...base, ty: 5, ks: transform(ctx, layer, td.anchor), t: td.t };
      }
      default:
        return { ...base, ty: 4, ks: transform(ctx, layer), shapes: shapeContents(ctx, layer) };
    }
  };

  // Ordre Lottie : du premier plan vers l'arrière-plan.
  for (const layer of [...comp.layers].reverse()) {
    if (masks.has(layer.id)) continue;
    const mask = layer.maskId ? map.get(layer.maskId) : undefined;
    if (mask) {
      // Track matte : une copie du calque masque juste au-dessus du calque masqué.
      const matte = build(mask, extraInd++);
      const target = build(layer);
      if (matte && target) {
        matte.td = 1;
        delete matte.hd;
        target.tt = layer.maskInvert ? 2 : 1;
        out.push(matte, target);
      }
      continue;
    }
    const l = build(layer);
    if (l) out.push(l);
  }
  return out;
}

export function exportLottie(project: Project, comp: Composition): LottieResult {
  const st: BuildState = { project, assets: [], warnings: new Set(), compsDone: new Set([comp.id]), fonts: new Map() };
  const layers = compLayers(st, comp);
  // Fond de la composition : calque « solide » tout en arrière-plan.
  const bg = parseColor(comp.background);
  if (bg.a > 0) {
    const hex = `#${[bg.r, bg.g, bg.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    layers.push({
      ddd: 0,
      ind: 9999,
      ty: 1,
      nm: 'Fond',
      sr: 1,
      ks: {
        o: { a: 0, k: num(bg.a * 100, 2) },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [comp.width / 2, comp.height / 2, 0] },
        a: { a: 0, k: [comp.width / 2, comp.height / 2, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      ao: 0,
      sw: comp.width,
      sh: comp.height,
      sc: hex,
      ip: 0,
      op: num(comp.duration * comp.fps, 3),
      st: 0,
      bm: 0,
    });
  }
  const json: Json = {
    v: '5.7.4',
    fr: comp.fps,
    ip: 0,
    op: num(comp.duration * comp.fps, 3),
    w: comp.width,
    h: comp.height,
    nm: `${project.name} — ${comp.name}`,
    ddd: 0,
    assets: st.assets,
    layers,
    meta: { g: 'Atelier Motion' },
  };
  if (st.fonts.size) {
    json.fonts = { list: [...st.fonts.values()] };
    st.warnings.add('Lottie : les textes utilisent la police installée sur l’appareil de lecture (Inter recommandé).');
  }
  return { json, code: JSON.stringify(json, null, 2), warnings: [...st.warnings] };
}
