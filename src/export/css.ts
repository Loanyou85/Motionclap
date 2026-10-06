import { easingToBezier } from '../engine/easing';
import { getNum } from '../engine/evaluate';
import { letterStates } from '../engine/text';
import type { Composition, Easing, Layer, Project } from '../engine/types';
import { channelTrack, cssColor, isSvgLayer, nodeChannels, shapeD, shapeKeys, visualChannels, type Channel } from './channels';
import {
  collectItems,
  createContext,
  escapeHtml,
  evalValues,
  num,
  pct,
  sampleTimeline,
  type ExportContext,
  type RenderItem,
  type TrackData,
} from './model';

export interface WebExportOptions {
  loop: boolean;
}

export interface ExportResult {
  code: string;
  warnings: string[];
}

export function timingFunction(e: Easing | null): string {
  if (!e) return 'linear';
  if (e.type === 'hold') return 'step-end';
  if (e.type === 'linear') return 'linear';
  const b = easingToBezier(e);
  return b ? `cubic-bezier(${b.join(', ')})` : 'linear';
}

const decl = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');

interface CssBuilder {
  ctx: ExportContext;
  opts: WebExportOptions;
  keyframes: string[];
  rules: string[];
  /** Classes de nœuds déjà émises (un ancêtre peut servir plusieurs fois). */
  emitted: Set<string>;
}

function animationDecl(b: CssBuilder, name: string): string {
  const iter = b.opts.loop ? 'infinite' : '1';
  return `${name} ${num(b.ctx.duration, 3)}s linear 0s ${iter} both`;
}

/** Transforme une piste en bloc @keyframes. */
function keyframesBlock(b: CssBuilder, name: string, track: TrackData, toCss: (v: TrackData['initial']) => Record<string, string>): string {
  const D = b.ctx.duration;
  const lines: string[] = [];
  const first = track.segments[0];
  if (first.t0 > 1e-6) lines.push(`  0% { ${decl(toCss(first.from))} }`);
  for (const s of track.segments) {
    lines.push(`  ${pct(Math.max(0, s.t0), D)} { ${decl(toCss(s.from))} animation-timing-function: ${timingFunction(s.easing)}; }`);
  }
  const last = track.segments[track.segments.length - 1];
  lines.push(`  ${pct(Math.min(D, last.t1), D)} { ${decl(toCss(last.to))} }`);
  if (last.t1 < D - 1e-6) lines.push(`  100% { ${decl(toCss(last.to))} }`);
  return `@keyframes ${name} {\n${lines.join('\n')}\n}`;
}

/** Règle CSS d'un élément : valeurs fixes + animations des canaux animés. */
function elementRule(b: CssBuilder, selector: string, layer: Layer, channels: Channel[], offset: number, extra: Record<string, string> = {}, extraAnims: string[] = []): string {
  const statics: Record<string, string> = { ...extra };
  const anims: string[] = [...extraAnims];
  const t0 = Math.max(0, -offset);
  for (const ch of channels) {
    const track = channelTrack(b.ctx, layer, ch, offset);
    if (!track) {
      Object.assign(statics, ch.css(evalValues(layer, ch.keys, t0)));
      continue;
    }
    const name = `am-${selector.replace(/^\./, '')}-${ch.name}`;
    b.keyframes.push(keyframesBlock(b, name, track, ch.css));
    anims.push(animationDecl(b, name));
    Object.assign(statics, ch.css(track.initial));
  }
  // Les tracés fixes passent par l'attribut d (compatible partout).
  if (statics.d && !anims.some((a) => a.includes('-d '))) delete statics.d;
  if (anims.length) statics.animation = anims.join(', ');
  return `${selector} { ${decl(statics)} }`;
}

/** Animation de visibilité (points d'entrée et de sortie du calque). */
function visibilityAnim(b: CssBuilder, item: RenderItem): string | null {
  const D = b.ctx.duration;
  const inG = item.layer.inPoint + item.offset;
  const outG = item.layer.outPoint + item.offset;
  if (inG <= 1e-6 && outG >= D - 1e-6) return null;
  const name = `am-i-${item.uid}-vis`;
  const lines = [`  0% { visibility: ${inG <= 1e-6 ? 'visible' : 'hidden'}; }`];
  if (inG > 1e-6 && inG < D) lines.push(`  ${pct(inG, D)} { visibility: visible; }`);
  if (outG < D - 1e-6) lines.push(`  ${pct(Math.max(0, outG), D)} { visibility: hidden; }`);
  b.keyframes.push(`@keyframes ${name} {\n${lines.join('\n')}\n}`);
  return `${name} ${num(D, 3)}s step-end 0s ${b.opts.loop ? 'infinite' : '1'} both`;
}

/** Animation lettre par lettre : états échantillonnés à la cadence d'export. */
function letterRules(b: CssBuilder, item: RenderItem): string {
  const { layer, offset } = item;
  const chars = Array.from(layer.text ?? '');
  const from = Math.max(0, layer.inPoint);
  const to = Math.min(item.comp.duration, layer.outPoint, b.ctx.duration - offset);
  if (to <= from) return '';
  const cache = new Map<number, ReturnType<typeof letterStates>>();
  const states = (t: number) => {
    let v = cache.get(t);
    if (!v) {
      v = letterStates(layer.text ?? '', layer.textMode ?? 'none', getNum(layer, 'reveal', t), getNum(layer, 'fontSize', t), getNum(layer, 'waveAmp', t), t);
      cache.set(t, v);
    }
    return v;
  };
  const rules: string[] = [];
  const D = b.ctx.duration;
  chars.forEach((c, i) => {
    if (c === '\n') return;
    const series = sampleTimeline(b.ctx, from, to, (t) => {
      const s = states(t)[i];
      return [s.opacity, s.dy, s.scale];
    });
    const name = `am-${item.uid}-c${i}`;
    const frame = (p: { v: number[] }) => `opacity: ${num(p.v[0])}; transform: translateY(${num(p.v[1], 2)}px) scale(${num(p.v[2])});`;
    const lines = series.map((p) => `  ${pct(p.t + offset, D)} { ${frame(p)} }`);
    if (series[0].t + offset > 1e-6) lines.unshift(`  0% { ${frame(series[0])} }`);
    lines.push(`  100% { ${frame(series[series.length - 1])} }`);
    b.keyframes.push(`@keyframes ${name} {\n${lines.join('\n')}\n}`);
    rules.push(`.am-${item.uid}-c${i} { animation: ${animationDecl(b, name)}; }`);
  });
  return rules.join('\n');
}

function visualHtml(b: CssBuilder, item: RenderItem, project: Project): string {
  const { layer, uid } = item;
  const cls = `am-v am-v-${uid}`;
  switch (layer.type) {
    case 'rect':
    case 'ellipse':
    case 'line':
      return `<div class="${cls}"></div>`;
    case 'image': {
      const asset = project.assets.find((a) => a.id === layer.assetId);
      return `<img class="${cls}" src="${asset?.src ?? ''}" alt="${escapeHtml(layer.name)}">`;
    }
    case 'text': {
      const text = layer.text ?? '';
      const animated = (layer.textMode ?? 'none') !== 'none';
      const inner = animated
        ? Array.from(text)
            .map((c, i) => (c === '\n' ? '<br>' : `<span class="am-c am-${uid}-c${i}">${c === ' ' ? '&nbsp;' : escapeHtml(c)}</span>`))
            .join('')
        : escapeHtml(text).replace(/\n/g, '<br>');
      return `<div class="${cls}">${inner}</div>`;
    }
    case 'star':
    case 'polygon':
    case 'path': {
      const d = shapeD(layer, evalValues(layer, shapeKeys(layer), 0));
      const trim = layer.type === 'path' ? ' pathLength="1" stroke-dasharray="1 1"' : '';
      return `<svg class="am-svg ${cls}" width="1" height="1" overflow="visible"><path class="am-p-${uid}" d="${d}"${trim}/></svg>`;
    }
    case 'precomp': {
      const children = item.children ?? [];
      return `<div class="${cls} am-sub">\n${children.map((c) => itemHtml(b, c, project)).join('\n')}\n</div>`;
    }
    default:
      return '';
  }
}

function itemRules(b: CssBuilder, item: RenderItem): void {
  const { layer, uid, offset } = item;
  // Nœuds de transformation (ancêtres puis calque)
  for (const node of [...item.ancestors, layer]) {
    const nodeUid = node === layer ? uid : `${uid.slice(0, uid.length - layer.id.length)}${node.id}`;
    const cls = `.am-t-${nodeUid}`;
    if (b.emitted.has(cls)) continue;
    b.emitted.add(cls);
    b.rules.push(elementRule(b, cls, node, nodeChannels(node), offset));
  }
  const vis = visibilityAnim(b, item);
  if (vis) b.rules.push(`.am-i-${uid} { animation: ${vis}; }`);

  const vSel = `.am-v-${uid}`;
  const visual = visualChannels(layer).filter((c) => c.target === 'visual');
  const extra: Record<string, string> = {};
  if (layer.type === 'ellipse') extra['border-radius'] = '50%';
  if (layer.type === 'rect' || layer.type === 'ellipse') extra['outline-style'] = 'solid';
  if (layer.type === 'image') extra['object-fit'] = 'cover';
  if (layer.type === 'text') {
    Object.assign(extra, {
      'font-family': `'${layer.fontFamily ?? 'Inter'}', system-ui, sans-serif`,
      'font-weight': String(layer.fontWeight ?? 700),
      'text-align': layer.textAlign ?? 'center',
      'line-height': '1.2',
      'white-space': 'pre',
    });
  }
  if (layer.type === 'precomp') {
    const sub = b.ctx.project.compositions.find((c) => c.id === layer.compId);
    if (sub) Object.assign(extra, { width: `${sub.width}px`, height: `${sub.height}px`, overflow: 'hidden', background: cssColor(sub.background) });
  }
  b.rules.push(elementRule(b, vSel, layer, visual, offset, extra));

  if (isSvgLayer(layer)) {
    const shape = visualChannels(layer).filter((c) => c.target === 'shape');
    b.rules.push(elementRule(b, `.am-p-${uid}`, layer, shape, offset));
  }
  if (layer.type === 'text' && (layer.textMode ?? 'none') !== 'none') {
    const r = letterRules(b, item);
    if (r) b.rules.push(r);
  }
  for (const c of item.children ?? []) itemRules(b, c);
}

function itemHtml(b: CssBuilder, item: RenderItem, project: Project): string {
  const prefix = item.uid.slice(0, item.uid.length - item.layer.id.length);
  const nodes = [...item.ancestors, item.layer];
  let open = '';
  let close = '';
  nodes.forEach((n, i) => {
    const extra = i === 0 ? ` am-i-${item.uid}` : '';
    open += `<div class="am-t am-t-${prefix}${n.id}${extra}">`;
    close += '</div>';
  });
  return `  <!-- ${escapeHtml(item.layer.name)} -->\n  ${open}${visualHtml(b, item, project)}${close}`;
}

/** @font-face des polices personnalisées utilisées par les calques texte. */
export function fontFaceCss(project: Project): string {
  const used = new Set(project.compositions.flatMap((c) => c.layers.filter((l) => l.type === 'text').map((l) => l.fontFamily)));
  return project.assets
    .filter((a) => a.kind === 'font' && a.family && used.has(a.family))
    .map((a) => `@font-face { font-family: '${a.family}'; src: url(${a.src}); font-display: block; }`)
    .join('\n');
}

const BASE_CSS = (comp: Composition) => `.am-stage { position: relative; width: ${comp.width}px; height: ${comp.height}px; overflow: hidden; background: ${cssColor(comp.background)}; font-family: Inter, system-ui, sans-serif; }
.am-stage *, .am-stage *::before, .am-stage *::after { box-sizing: border-box; }
.am-t { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; }
.am-v { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); display: block; }
.am-svg { position: absolute; left: 0; top: 0; overflow: visible; transform: none; }
.am-sub { position: absolute; }
.am-c { display: inline-block; transform-origin: 50% 50%; }`;

/** Génère la partie CSS et HTML de la scène. */
export function buildWebScene(project: Project, comp: Composition, opts: WebExportOptions): { css: string; html: string; warnings: string[] } {
  const ctx = createContext(project, comp);
  const b: CssBuilder = { ctx, opts, keyframes: [], rules: [], emitted: new Set() };
  const items = collectItems(ctx, comp);
  for (const it of items) itemRules(b, it);
  const html = `<div class="am-stage" role="img" aria-label="${escapeHtml(comp.name)}">\n${items.map((it) => itemHtml(b, it, project)).join('\n')}\n</div>`;
  const css = `${fontFaceCss(project)}\n${BASE_CSS(comp)}\n\n${b.rules.join('\n')}\n\n${b.keyframes.join('\n\n')}`;
  if (items.some((i) => (isSvgLayer(i.layer) && Object.keys(i.layer.props).some((k) => ['path', 'points', 'radius', 'innerRadius'].includes(k) && (i.layer.props[k as 'path']?.keyframes.length ?? 0) > 1))))
    ctx.warnings.add('Le morphing de tracé utilise la propriété CSS « d » : Chrome, Edge et Firefox (pas Safari).');
  return { css, html, warnings: [...ctx.warnings] };
}

/** Page HTML autonome : animation 100 % CSS (@keyframes), sans JavaScript. */
export function exportCss(project: Project, comp: Composition, opts: WebExportOptions = { loop: true }): ExportResult {
  const { css, html, warnings } = buildWebScene(project, comp, opts);
  const code = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(project.name)} — ${escapeHtml(comp.name)}</title>
<!-- Généré par Atelier Motion : animation en CSS pur (@keyframes). -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #F0F6FF; }
${css}
</style>
</head>
<body>
${html}
</body>
</html>
`;
  return { code, warnings };
}
